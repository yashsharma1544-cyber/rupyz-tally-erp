/**
 * POST /api/ai/narrative/customer/[id]
 *
 * Returns a Claude-generated narrative about the given customer.
 * Cached per-day. Admin-only.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/ai/service-client";
import { buildCustomerContext } from "@/lib/ai/context";
import { generateOrFetchCached } from "@/lib/ai/cache";
import { CUSTOMER_NARRATIVE_SYSTEM, buildCustomerNarrativeUser } from "@/lib/ai/prompts";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  // Auth via user session
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: me } = await userClient
    .from("app_users").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  // Build context with service client
  const db = serviceClient();
  const ctx = await buildCustomerContext(db, params.id);
  if (!ctx) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  // Get / generate narrative
  try {
    const result = await generateOrFetchCached({
      db,
      feature: "customer_narrative",
      entityType: "customer",
      entityId: params.id,
      systemPrompt: CUSTOMER_NARRATIVE_SYSTEM,
      userPrompt: buildCustomerNarrativeUser(ctx),
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
