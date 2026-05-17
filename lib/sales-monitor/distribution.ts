/**
 * Phase 8 helpers — target distribution across area → beats → customers.
 *
 * Default-share formula:
 *   Each item gets a "weight" used in normalization to 100%.
 *   - Items with history (kg > 0): weight = their historical kg
 *   - Items without history (kg == 0): weight = average of history items
 *   - If no history at all: equal split
 *
 * Effect: zero-history items get treated as "average-performing" — distinct
 * from history-rich items but not zero. Admin can still override any item
 * manually after.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let adminClientCache: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient {
  if (adminClientCache) return adminClientCache;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Supabase admin client env vars missing");
  adminClientCache = createClient(url, serviceRole, { auth: { persistSession: false } });
  return adminClientCache;
}

// ---- Types ----

export type DistributionRow = {
  beat_id: string;
  beat_name: string;
  beat_kg_84d: number;
  customer_id: string | null;
  customer_name: string | null;
  customer_kg_84d: number;
};

export type BeatHist = {
  id: string;
  name: string;
  kg_84d: number;
  customers: { id: string; name: string; kg_84d: number }[];
};

export type SavedBeatTarget = {
  beat_id: string;
  share_pct: number;
  target_kg: number;
  is_manual: boolean;
};

export type SavedCustomerTarget = {
  customer_id: string;
  share_pct: number;
  target_kg: number;
  is_manual: boolean;
};

// ---- Default-share math ----

/**
 * Compute default share percentages summing to 100. Items with kg>0 get their
 * historical proportion; zero-kg items each get a slot equal to the average
 * of history items. If no item has history, equal split.
 */
export function computeDefaultShares<T extends { id: string; kg_84d: number }>(
  items: T[],
): Map<string, number> {
  const shares = new Map<string, number>();
  if (items.length === 0) return shares;

  const historyItems = items.filter((i) => i.kg_84d > 0);
  const zeroItems = items.filter((i) => i.kg_84d <= 0);

  if (historyItems.length === 0) {
    // No history at all — equal split
    const eq = 100 / items.length;
    for (const i of items) shares.set(i.id, eq);
    return shares;
  }

  const totalHistory = historyItems.reduce((s, i) => s + i.kg_84d, 0);
  const avgHistory = totalHistory / historyItems.length;
  const totalWeight = totalHistory + zeroItems.length * avgHistory;
  if (totalWeight === 0) {
    const eq = 100 / items.length;
    for (const i of items) shares.set(i.id, eq);
    return shares;
  }

  for (const i of historyItems) {
    shares.set(i.id, (i.kg_84d / totalWeight) * 100);
  }
  for (const i of zeroItems) {
    shares.set(i.id, (avgHistory / totalWeight) * 100);
  }
  return shares;
}

// ---- Data loaders ----

/**
 * Load all beats and customers in an area with their 84-day kg, structured
 * as a list of beats each containing its customers.
 */
export async function loadAreaDistribution(
  areaId: string,
): Promise<BeatHist[]> {
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("area_distribution_84d", {
    p_area_id: areaId,
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as DistributionRow[];
  const beatMap = new Map<string, BeatHist>();
  for (const r of rows) {
    if (!beatMap.has(r.beat_id)) {
      beatMap.set(r.beat_id, {
        id: r.beat_id,
        name: r.beat_name,
        kg_84d: Number(r.beat_kg_84d),
        customers: [],
      });
    }
    if (r.customer_id) {
      beatMap.get(r.beat_id)!.customers.push({
        id: r.customer_id,
        name: r.customer_name || "—",
        kg_84d: Number(r.customer_kg_84d),
      });
    }
  }
  return Array.from(beatMap.values()).sort((a, b) =>
    b.kg_84d - a.kg_84d || a.name.localeCompare(b.name),
  );
}

export async function loadAreaTarget(
  jcId: string,
  areaId: string,
): Promise<number | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("area_jc_targets")
    .select("target_kg")
    .eq("jc_id", jcId)
    .eq("area_id", areaId)
    .maybeSingle();
  if (error) return null;
  return data ? Number(data.target_kg) : null;
}

export async function loadBeatTargets(
  jcId: string,
  beatIds: string[],
): Promise<Map<string, SavedBeatTarget>> {
  const map = new Map<string, SavedBeatTarget>();
  if (beatIds.length === 0) return map;
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("beat_jc_targets")
    .select("beat_id, share_pct, target_kg, is_manual")
    .eq("jc_id", jcId)
    .in("beat_id", beatIds);
  if (error) return map;
  for (const row of data ?? []) {
    map.set(row.beat_id, {
      beat_id: row.beat_id,
      share_pct: Number(row.share_pct),
      target_kg: Number(row.target_kg),
      is_manual: row.is_manual,
    });
  }
  return map;
}

export async function loadCustomerTargets(
  jcId: string,
  customerIds: string[],
): Promise<Map<string, SavedCustomerTarget>> {
  const map = new Map<string, SavedCustomerTarget>();
  if (customerIds.length === 0) return map;
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("customer_jc_targets")
    .select("customer_id, share_pct, target_kg, is_manual")
    .eq("jc_id", jcId)
    .in("customer_id", customerIds);
  if (error) return map;
  for (const row of data ?? []) {
    map.set(row.customer_id, {
      customer_id: row.customer_id,
      share_pct: Number(row.share_pct),
      target_kg: Number(row.target_kg),
      is_manual: row.is_manual,
    });
  }
  return map;
}

// ---- Savers ----

export async function saveAreaTarget(
  jcId: string,
  areaId: string,
  targetKg: number,
): Promise<{ ok: boolean; error?: string }> {
  const admin = getAdminClient();
  const { error } = await admin.from("area_jc_targets").upsert(
    { jc_id: jcId, area_id: areaId, target_kg: targetKg },
    { onConflict: "jc_id,area_id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function saveBeatTargets(
  jcId: string,
  targets: SavedBeatTarget[],
): Promise<{ ok: boolean; error?: string }> {
  if (targets.length === 0) return { ok: true };
  const admin = getAdminClient();
  const rows = targets.map((t) => ({
    jc_id: jcId,
    beat_id: t.beat_id,
    share_pct: round4(t.share_pct),
    target_kg: round3(t.target_kg),
    is_manual: t.is_manual,
  }));
  const { error } = await admin
    .from("beat_jc_targets")
    .upsert(rows, { onConflict: "jc_id,beat_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function saveCustomerTargets(
  jcId: string,
  targets: SavedCustomerTarget[],
): Promise<{ ok: boolean; error?: string }> {
  if (targets.length === 0) return { ok: true };
  const admin = getAdminClient();
  const rows = targets.map((t) => ({
    jc_id: jcId,
    customer_id: t.customer_id,
    share_pct: round4(t.share_pct),
    target_kg: round3(t.target_kg),
    is_manual: t.is_manual,
  }));
  const { error } = await admin
    .from("customer_jc_targets")
    .upsert(rows, { onConflict: "jc_id,customer_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
