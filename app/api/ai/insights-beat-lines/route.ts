/**
 * POST /api/ai/insights-beat-lines
 *
 * Returns one-line AI insights for every beat, as a JSON object:
 *   { ok: true, lines: { [beatId]: "one-line insight" }, cached: boolean }
 *
 * One Sonnet call generates all lines at once (cheaper than per-beat).
 * Cached per-day in ai_generations (feature='insights_beat_lines', entity null).
 *
 * Admin-only.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/ai/service-client";
import { callClaude, MODELS, contextHash } from "@/lib/ai/anthropic";
import { buildBeatsOverviewContext } from "@/lib/ai/beats-overview-context";
import {
  BEATS_OVERVIEW_SYSTEM,
  buildBeatsOverviewUser,
} from "@/lib/ai/beats-overview-prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;  // Vercel pro tier — extend for the multi-beat call

export async function POST() {
  // Auth gate
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await userClient
    .from("app_users").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const db = serviceClient();
  const beats = await buildBeatsOverviewContext(db);

  if (beats.length === 0) {
    return NextResponse.json({ ok: true, lines: {}, cached: false });
  }

  // Cache check
  const today = new Date().toISOString().slice(0, 10);
  const userPrompt = buildBeatsOverviewUser(beats);
  const hash = await contextHash(BEATS_OVERVIEW_SYSTEM + "\n" + userPrompt);

  const { data: cached } = await db
    .from("ai_generations")
    .select("content, context_hash")
    .eq("feature", "insights_beat_lines")
    .is("entity_type", null)
    .is("entity_id", null)
    .eq("scope_date", today)
    .eq("context_hash", hash)
    .maybeSingle();

  if (cached) {
    try {
      const lines = JSON.parse(cached.content);
      return NextResponse.json({ ok: true, lines, cached: true });
    } catch {
      // Cached content was malformed JSON — fall through to regenerate
    }
  }

  // Call Claude
  let resp;
  try {
    resp = await callClaude({
      model: MODELS.SONNET,
      system: BEATS_OVERVIEW_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 4000,    // 25 beats × ~50 tokens each + JSON overhead
      temperature: 0.3,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Generation failed" }, { status: 500 });
  }

  // Parse JSON from Claude's response. It might include stray text or fences.
  let lines: Record<string, string>;
  try {
    let content = resp.content.trim();
    // Strip markdown fences if Claude added them despite instructions
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    // Find the first { and last } as a safety net
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      content = content.slice(firstBrace, lastBrace + 1);
    }
    lines = JSON.parse(content);
  } catch (e: any) {
    return NextResponse.json({
      error: "Claude returned malformed JSON",
      raw: resp.content.slice(0, 500),
    }, { status: 500 });
  }

  // Store
  await db.from("ai_generations").insert({
    feature: "insights_beat_lines",
    entity_type: null,
    entity_id: null,
    scope_date: today,
    model: resp.model,
    prompt_tokens: resp.inputTokens,
    completion_tokens: resp.outputTokens,
    content: JSON.stringify(lines),
    context_hash: hash,
    cost_usd: resp.costUsd,
  });

  return NextResponse.json({ ok: true, lines, cached: false });
}
