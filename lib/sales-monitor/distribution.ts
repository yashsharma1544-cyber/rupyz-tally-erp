/**
 * Phase 8 helpers — target distribution across area → beats → customers,
 * plus apply-to-daily-schedule.
 *
 * Default-share formula:
 *   Each item gets a "weight" used in normalization to 100%.
 *   - Items with history (kg > 0): weight = their historical kg
 *   - Items without history (kg == 0): weight = average of history items
 *   - If no history at all: equal split
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

export function computeDefaultShares<T extends { id: string; kg_84d: number }>(
  items: T[],
): Map<string, number> {
  const shares = new Map<string, number>();
  if (items.length === 0) return shares;

  const historyItems = items.filter((i) => i.kg_84d > 0);
  const zeroItems = items.filter((i) => i.kg_84d <= 0);

  if (historyItems.length === 0) {
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

// ---- Apply to daily schedule ----

/**
 * For every (salesman, date) in salesman_beat_assignments inside the JC's
 * date range, write a daily_sales_targets row using the JC's beat target_kg
 * for whichever beat that salesman is visiting that day.
 *
 * Joint visits (two salesmen share one beat on the same date) each get the
 * FULL beat target — matches the "both responsible for the same goal" model.
 *
 *   mode = "skip-existing"  → never touches a (salesman, date) that already
 *                             has a daily target. Manual edits preserved.
 *   mode = "force"          → upsert. Overwrites manual edits in the JC's
 *                             date range. Destructive — use sparingly.
 */
export async function applyDistributionToSchedule(
  jcId: string,
  mode: "skip-existing" | "force",
): Promise<{
  ok: boolean;
  inserted: number;
  skipped: number;
  noTarget: number;
  error?: string;
}> {
  const admin = getAdminClient();

  // 1. Resolve JC date range
  const { data: jc, error: jcErr } = await admin
    .from("journey_cycles")
    .select("start_date, end_date, jc_number")
    .eq("id", jcId)
    .single();
  if (jcErr || !jc) {
    return { ok: false, inserted: 0, skipped: 0, noTarget: 0, error: "JC not found" };
  }

  // 2. Get all daily beat assignments in the JC's date range
  const { data: assignments, error: aErr } = await admin
    .from("salesman_beat_assignments")
    .select("salesman_id, beat_id, assignment_date")
    .gte("assignment_date", jc.start_date)
    .lte("assignment_date", jc.end_date);
  if (aErr) {
    return { ok: false, inserted: 0, skipped: 0, noTarget: 0, error: `assignments: ${aErr.message}` };
  }
  if (!assignments || assignments.length === 0) {
    return {
      ok: false, inserted: 0, skipped: 0, noTarget: 0,
      error: `No salesman_beat_assignments in JC ${jc.jc_number} date range. Apply the JC plan to schedule first.`,
    };
  }

  // 3. Load beat targets for this JC
  const { data: beatTargets, error: btErr } = await admin
    .from("beat_jc_targets")
    .select("beat_id, target_kg")
    .eq("jc_id", jcId);
  if (btErr) {
    return { ok: false, inserted: 0, skipped: 0, noTarget: 0, error: `beat targets: ${btErr.message}` };
  }
  const targetByBeat = new Map<string, number>();
  for (const t of beatTargets ?? []) {
    targetByBeat.set(t.beat_id, Number(t.target_kg));
  }
  if (targetByBeat.size === 0) {
    return {
      ok: false, inserted: 0, skipped: 0, noTarget: 0,
      error: "No beat targets set for this JC. Save targets before applying.",
    };
  }

  // 4. Build target rows. Track beats with no target separately so the
  //    admin gets a clear count, not a silent skip.
  type Row = { salesman_id: string; target_date: string; target_kg: number };
  const rows: Row[] = [];
  let noTarget = 0;
  for (const a of assignments) {
    const target = targetByBeat.get(a.beat_id);
    if (target === undefined) {
      // Beat has no JC target — common if some beats weren't included in
      // the distribution (different area, or admin hasn't filled them).
      noTarget++;
      continue;
    }
    rows.push({
      salesman_id: a.salesman_id,
      target_date: a.assignment_date,
      target_kg: target,
    });
  }

  if (rows.length === 0) {
    return {
      ok: false, inserted: 0, skipped: 0, noTarget,
      error: `No matching beat targets for the ${assignments.length} daily assignments. Check that beat targets are saved for the area you've distributed.`,
    };
  }

  // 5. Apply
  if (mode === "force") {
    const { error } = await admin
      .from("daily_sales_targets")
      .upsert(rows, { onConflict: "salesman_id,target_date" });
    if (error) {
      return { ok: false, inserted: 0, skipped: 0, noTarget, error: error.message };
    }
    return { ok: true, inserted: rows.length, skipped: 0, noTarget };
  }

  // skip-existing: fetch already-set rows and exclude them
  const dates = Array.from(new Set(rows.map((r) => r.target_date)));
  const salesmen = Array.from(new Set(rows.map((r) => r.salesman_id)));
  const { data: existing, error: exErr } = await admin
    .from("daily_sales_targets")
    .select("salesman_id, target_date")
    .in("target_date", dates)
    .in("salesman_id", salesmen);
  if (exErr) {
    return { ok: false, inserted: 0, skipped: 0, noTarget, error: exErr.message };
  }
  const existingKeys = new Set(
    (existing ?? []).map((e) => `${e.salesman_id}|${e.target_date}`),
  );
  const newRows = rows.filter(
    (r) => !existingKeys.has(`${r.salesman_id}|${r.target_date}`),
  );
  const skipped = rows.length - newRows.length;

  if (newRows.length === 0) {
    return { ok: true, inserted: 0, skipped, noTarget };
  }

  const { error: insErr } = await admin
    .from("daily_sales_targets")
    .insert(newRows);
  if (insErr) {
    return { ok: false, inserted: 0, skipped, noTarget, error: insErr.message };
  }
  return { ok: true, inserted: newRows.length, skipped, noTarget };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
