/**
 * POST /api/ai/chat
 *
 * Send a chat message. Body: { threadId?: string, message: string }
 * - If threadId omitted, creates a new thread.
 * - Returns assistant response + threadId.
 *
 * The first 6 messages of a thread are sent as context to Claude.
 * Older messages are summarized away (TODO: implement when threads get long).
 *
 * Admin-only. Other roles get redirected from /dashboard, so this gates
 * at the route level too.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/ai/service-client";
import { callClaude, MODELS } from "@/lib/ai/anthropic";
import { buildChatSnapshot } from "@/lib/ai/context";
import { CHAT_SYSTEM } from "@/lib/ai/prompts";

export const dynamic = "force-dynamic";

interface ChatBody {
  threadId?: string;
  message: string;
}

export async function POST(req: Request) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await userClient
    .from("app_users").select("role").eq("id", user.id).single();
  if (me?.role !== "admin" && me?.role !== "accounts") return NextResponse.json({ error: "Admin or accounts only" }, { status: 403 });

  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.message || typeof body.message !== "string") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  if (body.message.length > 4000) {
    return NextResponse.json({ error: "message too long (max 4000 chars)" }, { status: 400 });
  }

  const db = serviceClient();

  // Get or create thread
  let threadId = body.threadId;
  if (!threadId) {
    const title = body.message.slice(0, 80);
    const { data: thread, error: tErr } = await db
      .from("ai_chat_threads")
      .insert({ user_id: user.id, title })
      .select("id")
      .single();
    if (tErr || !thread) {
      return NextResponse.json({ error: `Could not create thread: ${tErr?.message}` }, { status: 500 });
    }
    threadId = thread.id;
  } else {
    // Verify ownership
    const { data: t } = await db
      .from("ai_chat_threads")
      .select("id, user_id")
      .eq("id", threadId)
      .maybeSingle();
    if (!t || t.user_id !== user.id) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
  }

  // Save user message
  await db.from("ai_chat_messages").insert({
    thread_id: threadId,
    role: "user",
    content: body.message,
  });

  // Load conversation history (last 10 turns, oldest first)
  const { data: history } = await db
    .from("ai_chat_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(20);

  // Build snapshot of business state and prepend as system info
  const snapshot = await buildChatSnapshot(db);
  const systemPrompt = `${CHAT_SYSTEM}

Current business snapshot:
${snapshot}`;

  const messages = (history ?? [])
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Call Claude (Opus for chat — better reasoning)
  let claudeResp;
  try {
    claudeResp = await callClaude({
      model: MODELS.OPUS,
      system: systemPrompt,
      messages,
      maxTokens: 1024,
      temperature: 0.6,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Generation failed" }, { status: 500 });
  }

  // Save assistant message
  await db.from("ai_chat_messages").insert({
    thread_id: threadId,
    role: "assistant",
    content: claudeResp.content,
    model: claudeResp.model,
    prompt_tokens: claudeResp.inputTokens,
    completion_tokens: claudeResp.outputTokens,
    cost_usd: claudeResp.costUsd,
  });

  // Update thread updated_at
  await db
    .from("ai_chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId);

  return NextResponse.json({
    ok: true,
    threadId,
    reply: claudeResp.content,
    costUsd: claudeResp.costUsd,
  });
}
