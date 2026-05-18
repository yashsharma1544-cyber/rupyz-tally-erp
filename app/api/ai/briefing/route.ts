/**
 * POST /api/ai/briefing
 *
 * Generates / returns the daily briefing. Cached per-day (one per date).
 * Admin-only.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/ai/service-client";
import { buildDailyBriefingContext } from "@/lib/ai/context";
import { generateOrFetchCached } from "@/lib/ai/cache";
import { DAILY_BRIEFING_SYSTEM, buildDailyBriefingUser } from "@/lib/ai/prompts";

export const dynamic = "force-dynamic";

export async function POST() {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await userClient
    .from("app_users").select("role").eq("id", user.id).single();
  if (me?.role !== "admin" && me?.role !== "accounts") return NextResponse.json({ error: "Admin or accounts only" }, { status: 403 });

  const db = serviceClient();
  const ctx = await buildDailyBriefingContext(db);

  try {
    const result = await generateOrFetchCached({
      db,
      feature: "daily_briefing",
      entityType: null,
      entityId: null,
      systemPrompt: DAILY_BRIEFING_SYSTEM,
      userPrompt: buildDailyBriefingUser(ctx),
      maxTokens: 800,
    });
    return NextResponse.json({
      ok: true,
      briefing: result.content,
      cached: result.cached,
      generatedAt: result.generatedAt,
      asOfDate: ctx.asOfDate,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Generation failed" }, { status: 500 });
  }
}
