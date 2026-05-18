/**
 * GET  /api/ai/chat/threads          → list user's threads
 * GET  /api/ai/chat/threads?id=...   → load thread + messages
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/ai/service-client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await userClient
    .from("app_users").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const url = new URL(req.url);
  const threadId = url.searchParams.get("id");
  const db = serviceClient();

  if (threadId) {
    // Single thread + messages
    const { data: thread } = await db
      .from("ai_chat_threads")
      .select("id, title, created_at, updated_at, user_id")
      .eq("id", threadId)
      .maybeSingle();
    if (!thread || thread.user_id !== user.id) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
    const { data: messages } = await db
      .from("ai_chat_messages")
      .select("id, role, content, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    return NextResponse.json({ ok: true, thread, messages: messages ?? [] });
  }

  // List threads
  const { data: threads } = await db
    .from("ai_chat_threads")
    .select("id, title, created_at, updated_at")
    .eq("user_id", user.id)
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(20);

  return NextResponse.json({ ok: true, threads: threads ?? [] });
}
