/**
 * POST /api/ai/narrative/product/[id]
 *
 * Product-level narrative. Admin-only.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/ai/service-client";
import { buildProductContext } from "@/lib/ai/context";
import { generateOrFetchCached } from "@/lib/ai/cache";
import { PRODUCT_NARRATIVE_SYSTEM, buildProductNarrativeUser } from "@/lib/ai/prompts";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await userClient
    .from("app_users").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const db = serviceClient();
  const ctx = await buildProductContext(db, params.id);
  if (!ctx) return NextResponse.json({ error: "Product not found" }, { status: 404 });

  try {
    const result = await generateOrFetchCached({
      db,
      feature: "product_narrative",
      entityType: "product",
      entityId: params.id,
      systemPrompt: PRODUCT_NARRATIVE_SYSTEM,
      userPrompt: buildProductNarrativeUser(ctx),
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
