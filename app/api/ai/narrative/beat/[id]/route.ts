/**
 * POST /api/ai/narrative/beat/[id]
 *
 * Beat-level narrative. Admin-only.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/ai/service-client";
import { buildBeatContext } from "@/lib/ai/context";
import { generateOrFetchCached } from "@/lib/ai/cache";
import { BEAT_NARRATIVE_SYSTEM, buildBeatNarrativeUser } from "@/lib/ai/prompts";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await userClient
    .from("app_users").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const db = serviceClient();
  const ctx = await buildBeatContext(db, params.id);
  if (!ctx) return NextResponse.json({ error: "Beat not found" }, { status: 404 });

  try {
    const result = await generateOrFetchCached({
      db,
      feature: "beat_narrative",
      entityType: "beat",
      entityId: params.id,
      systemPrompt: BEAT_NARRATIVE_SYSTEM,
      userPrompt: buildBeatNarrativeUser(ctx),
      maxTokens: 500,
    });
    return NextResponse.json({
      ok: true,
      narrative: result.content,
      cached: result.cached,
      generatedAt: result.generatedAt,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Generation failed" }, { status: 500 });
  }
}
