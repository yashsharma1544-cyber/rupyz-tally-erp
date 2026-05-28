"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ---- Types shared with the client ----------------------------------------

export type CustomerNode = {
  customer_id: string;
  customer_name: string;
  hist_kg: number;
  share_pct: number; // share of beat
  target_kg: number;
  is_manual: boolean;
};

export type BeatNode = {
  beat_id: string;
  beat_name: string;
  hist_kg: number;
  share_pct: number; // share of area
  target_kg: number;
  is_manual: boolean;
  customers: CustomerNode[];
};

export type AreaPreview = {
  jc_id: string;
  area_id: string;
  area_name: string;
  area_kg: number;
  area_hist_kg: number;
  beats: BeatNode[];
};

type DistRow = {
  beat_id: string;
  beat_name: string;
  beat_kg: number;
  customer_id: string | null;
  customer_name: string | null;
  customer_kg: number;
};

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const { data: appUser } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!appUser?.active || appUser.role !== "admin") return { ok: false, error: "Admin only" };
  return { ok: true, userId: user.id };
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Build the cascade preview for one area + JC + entered area target.
 * Read-only: computes shares from Rupyz history (area_distribution_rupyz),
 * applies the area target proportionally, and overlays any already-saved
 * targets (so re-opening shows what was saved, incl. manual values).
 */
export async function previewAreaTargets(
  jcId: string,
  areaId: string,
  areaKg: number,
): Promise<{ error: string } | AreaPreview> {
  const auth = await requireAdmin();
  if (!auth.ok) return { error: auth.error };

  const admin = createAdminClient();

  // Area name
  const { data: area } = await admin.from("areas").select("name").eq("id", areaId).maybeSingle();

  // Historical distribution (beat + customer kg) from Rupyz, window <= 2026-03-31
  const { data: distData, error: distErr } = await admin.rpc("area_distribution_rupyz", {
    p_area_id: areaId,
  });
  if (distErr) return { error: `Distribution failed: ${distErr.message}` };
  const dist = (distData ?? []) as DistRow[];

  // Group by beat
  const beatMap = new Map<
    string,
    { name: string; beat_kg: number; customers: { id: string; name: string; kg: number }[] }
  >();
  for (const r of dist) {
    if (!beatMap.has(r.beat_id)) {
      beatMap.set(r.beat_id, { name: r.beat_name, beat_kg: Number(r.beat_kg) || 0, customers: [] });
    }
    if (r.customer_id) {
      beatMap.get(r.beat_id)!.customers.push({
        id: r.customer_id,
        name: r.customer_name ?? "—",
        kg: Number(r.customer_kg) || 0,
      });
    }
  }

  const areaHistKg = Array.from(beatMap.values()).reduce((a, b) => a + b.beat_kg, 0);

  // Existing saved targets to overlay (manual flags + saved kg)
  const { data: savedBeats } = await admin
    .from("beat_jc_targets")
    .select("beat_id, target_kg, is_manual")
    .eq("jc_id", jcId);
  const savedBeatMap = new Map(
    (savedBeats ?? []).map((b) => [b.beat_id as string, b]),
  );

  const { data: savedCusts } = await admin
    .from("jc_customer_targets")
    .select("customer_id, target_kg")
    .eq("jc_id", jcId)
    .eq("area_id", areaId);
  const savedCustMap = new Map(
    (savedCusts ?? []).map((c) => [c.customer_id as string, Number(c.target_kg) || 0]),
  );

  // Build beats with shares + auto targets
  const beats: BeatNode[] = [];
  for (const [beatId, b] of beatMap) {
    const beatShare = areaHistKg > 0 ? (b.beat_kg / areaHistKg) * 100 : 0;
    const autoBeatKg = round2((beatShare / 100) * areaKg);

    const savedB = savedBeatMap.get(beatId);
    const beatTarget = savedB ? Number(savedB.target_kg) || 0 : autoBeatKg;
    const beatIsManual = savedB ? Boolean(savedB.is_manual) : false;

    // Customers: share of THIS beat's hist kg, applied to the beat's target
    const customers: CustomerNode[] = b.customers
      .map((c) => {
        const custShare = b.beat_kg > 0 ? (c.kg / b.beat_kg) * 100 : 0;
        const autoCustKg = round2((custShare / 100) * beatTarget);
        const savedKg = savedCustMap.get(c.id);
        return {
          customer_id: c.id,
          customer_name: c.name,
          hist_kg: round2(c.kg),
          share_pct: round2(custShare),
          target_kg: savedKg != null ? round2(savedKg) : autoCustKg,
          is_manual: savedKg != null && savedKg !== autoCustKg,
        };
      })
      .sort((a, b2) => b2.hist_kg - a.hist_kg);

    beats.push({
      beat_id: beatId,
      beat_name: b.name,
      hist_kg: round2(b.beat_kg),
      share_pct: round2(beatShare),
      target_kg: beatTarget,
      is_manual: beatIsManual,
      customers,
    });
  }

  beats.sort((a, b) => b.hist_kg - a.hist_kg);

  return {
    jc_id: jcId,
    area_id: areaId,
    area_name: area?.name ?? "—",
    area_kg: areaKg,
    area_hist_kg: round2(areaHistKg),
    beats,
  };
}

/**
 * Persist the cascade for one area+JC: upserts area_jc_targets, beat_jc_targets,
 * jc_customer_targets. Manual edits carry is_manual=true. No sibling rebalance;
 * we write exactly what the preview shows.
 */
export async function saveAreaTargets(payload: {
  jcId: string;
  areaId: string;
  areaKg: number;
  beats: Array<{ beat_id: string; share_pct: number; target_kg: number; is_manual: boolean }>;
  customers: Array<{ beat_id: string; customer_id: string; target_kg: number; is_manual: boolean }>;
}): Promise<{ ok: true } | { error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { error: auth.error };
  const userId = auth.userId;

  const admin = createAdminClient();
  const { jcId, areaId, areaKg, beats, customers } = payload;

  // 1) Area
  const { error: areaErr } = await admin
    .from("area_jc_targets")
    .upsert(
      { jc_id: jcId, area_id: areaId, target_kg: round2(areaKg), updated_at: new Date().toISOString() },
      { onConflict: "jc_id,area_id" },
    );
  if (areaErr) return { error: `Area save failed: ${areaErr.message}` };

  // 2) Beats
  if (beats.length > 0) {
    const beatRows = beats.map((b) => ({
      jc_id: jcId,
      beat_id: b.beat_id,
      share_pct: round2(b.share_pct),
      target_kg: round2(b.target_kg),
      is_manual: b.is_manual,
      updated_at: new Date().toISOString(),
    }));
    const { error: beatErr } = await admin
      .from("beat_jc_targets")
      .upsert(beatRows, { onConflict: "jc_id,beat_id" });
    if (beatErr) return { error: `Beat save failed: ${beatErr.message}` };
  }

  // 3) Customers
  if (customers.length > 0) {
    const custRows = customers.map((c) => ({
      jc_id: jcId,
      area_id: areaId,
      beat_id: c.beat_id,
      customer_id: c.customer_id,
      target_kg: round2(c.target_kg),
      created_by: userId,
    }));
    const { error: custErr } = await admin
      .from("jc_customer_targets")
      .upsert(custRows, { onConflict: "jc_id,customer_id" });
    if (custErr) return { error: `Customer save failed: ${custErr.message}` };
  }

  return { ok: true };
}
