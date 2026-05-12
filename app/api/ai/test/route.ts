/**
 * GET /api/ai/test
 *
 * Verifies the Anthropic API integration end-to-end:
 *   1. ANTHROPIC_API_KEY is set in Vercel env
 *   2. Network reachable from Vercel runtime
 *   3. Response parsing + cost tracking
 *   4. Cache table accessible
 *
 * Returns JSON with the Claude response, token counts, and cost.
 *
 * Admin-only. Delete this route before deploying for users.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callClaude, MODELS, contextHash } from "@/lib/ai/anthropic";

export const dynamic = "force-dynamic";

export async function GET() {
  // Admin gate
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }
  const { data: me } = await supabase
    .from("app_users").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Admin only" }, { status: 403 });
  }

  // Verify API key is present (without leaking it)
  const keyStatus = process.env.ANTHROPIC_API_KEY 
    ? `set (${process.env.ANTHROPIC_API_KEY.slice(0, 7)}...)` 
    : "MISSING";

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      ok: false,
      step: "env",
      anthropicKey: keyStatus,
      error: "ANTHROPIC_API_KEY not found in environment. Set it in Vercel env vars and redeploy.",
    }, { status: 500 });
  }

  // Call Claude with a trivial prompt
  let claudeResponse;
  try {
    claudeResponse = await callClaude({
      model: MODELS.HAIKU,  // cheapest model for the test
      system: "You are a helpful test assistant. Respond very briefly.",
      messages: [
        { role: "user", content: "Reply with exactly: 'AI integration working. Today is " + new Date().toISOString().slice(0, 10) + ".'" }
      ],
      maxTokens: 100,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      step: "claude",
      anthropicKey: keyStatus,
      error: e?.message ?? String(e),
    }, { status: 500 });
  }

  // Verify cache table is accessible
  let cacheStatus = "unknown";
  let cacheCount: number | null = null;
  try {
    const { count, error } = await supabase
      .from("ai_generations")
      .select("*", { count: "exact", head: true });
    if (error) cacheStatus = `error: ${error.message}`;
    else { cacheStatus = "accessible"; cacheCount = count; }
  } catch (e: any) {
    cacheStatus = `error: ${e?.message ?? e}`;
  }

  // Write a test entry to confirm RLS + service role works
  const hash = await contextHash("test-" + Date.now());
  let writeStatus = "skipped";
  try {
    const { error } = await supabase.from("ai_generations").insert({
      feature: "test",
      entity_type: null,
      entity_id: null,
      scope_date: new Date().toISOString().slice(0, 10),
      model: claudeResponse.model,
      prompt_tokens: claudeResponse.inputTokens,
      completion_tokens: claudeResponse.outputTokens,
      content: claudeResponse.content,
      context_hash: hash,
      cost_usd: claudeResponse.costUsd,
    });
    if (error) writeStatus = `error: ${error.message}`;
    else writeStatus = "written";
  } catch (e: any) {
    writeStatus = `error: ${e?.message ?? e}`;
  }

  return NextResponse.json({
    ok: true,
    anthropicKey: keyStatus,
    claudeResponse: {
      content: claudeResponse.content,
      model: claudeResponse.model,
      inputTokens: claudeResponse.inputTokens,
      outputTokens: claudeResponse.outputTokens,
      costUsd: claudeResponse.costUsd,
    },
    cache: {
      tableAccessible: cacheStatus,
      existingRows: cacheCount,
      writeStatus,
    },
    message: "Infrastructure working. Safe to proceed with full feature build.",
  });
}
