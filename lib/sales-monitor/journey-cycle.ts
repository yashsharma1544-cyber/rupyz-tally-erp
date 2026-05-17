/**
 * Journey Cycle helpers — read JCs, manage plan entries, copy across JCs,
 * apply a JC plan to the live daily schedule.
 *
 * All admin operations use the service-role client (bypasses RLS); auth is
 * gated upstream by server actions calling these functions.
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

export type JourneyCycle = {
  id: string;
  jc_number: number;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  days_count: number;
  fy_label: string;
};

export type PlanEntry = {
  id: string;
  jc_id: string;
  jc_day: number;
  salesman_id: string;
  beat_id: string;
};

export type Salesman = { id: string; full_name: string };
export type Beat     = { id: string; name: string };

export async function listJourneyCycles(): Promise<JourneyCycle[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("journey_cycles")
    .select("id, jc_number, start_date, end_date, days_count, fy_label")
    .order("jc_number", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as JourneyCycle[];
}

export async function getJourneyCycleById(id: string): Promise<JourneyCycle | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("journey_cycles")
    .select("id, jc_number, start_date, end_date, days_count, fy_label")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as JourneyCycle;
}

export async function getJcForDate(date: string): Promise<JourneyCycle | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("journey_cycles")
    .select("id, jc_number, start_date, end_date, days_count, fy_label")
    .lte("start_date", date)
    .gte("end_date", date)
    .single();
  if (error || !data) return null;
  return data as JourneyCycle;
}

export async function listPlanEntriesForJc(jcId: string): Promise<PlanEntry[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("beat_journey_plan")
    .select("id, jc_id, jc_day, salesman_id, beat_id")
    .eq("jc_id", jcId);
  if (error) throw new Error(error.message);
  return (data ?? []) as PlanEntry[];
}

/**
 * Active field-staff salesmen. Reads from the dedicated `salesmen` table
 * (not app_users — those are login accounts). Maps the table's `name` column
 * to `full_name` so callers stay unchanged.
 */
export async function listActiveSalesmen(): Promise<Salesman[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("salesmen")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string }[]).map((r) => ({
    id: r.id,
    full_name: r.name,
  }));
}

export async function listBeats(): Promise<Beat[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("beats")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Beat[];
}

/**
 * Apply a JC's plan into the daily salesman_beat_assignments table.
 *
 *   mode = "skip-existing"  → never touches a (salesman, date) that already
 *                             has an assignment. Manual edits are preserved.
 *   mode = "force"          → upsert. Overwrites manual edits in the JC's
 *                             date range. Destructive — use sparingly.
 *
 * Returns counts so the UI can report what happened.
 */
export async function applyJcPlan(
  jcId: string,
  mode: "skip-existing" | "force",
): Promise<{ inserted: number; skipped: number; error?: string }> {
  const admin = getAdminClient();
  const jc = await getJourneyCycleById(jcId);
  if (!jc) return { inserted: 0, skipped: 0, error: "JC not found" };

  const plan = await listPlanEntriesForJc(jcId);
  if (plan.length === 0) {
    return { inserted: 0, skipped: 0, error: "No plan entries to apply" };
  }

  // Map each (jc_day) to a calendar date using IST-safe arithmetic.
  // start_date is already an IST date string, so we just add days as integers.
  function addDays(yyyymmdd: string, n: number): string {
    const [y, m, d] = yyyymmdd.split("-").map(Number);
    const base = new Date(Date.UTC(y, m - 1, d));
    base.setUTCDate(base.getUTCDate() + n);
    return base.toISOString().slice(0, 10);
  }

  const rows = plan.map((p) => ({
    salesman_id: p.salesman_id,
    beat_id: p.beat_id,
    assignment_date: addDays(jc.start_date, p.jc_day - 1),
  }));

  if (mode === "force") {
    const { error } = await admin
      .from("salesman_beat_assignments")
      .upsert(rows, { onConflict: "salesman_id,assignment_date" });
    if (error) return { inserted: 0, skipped: 0, error: error.message };
    return { inserted: rows.length, skipped: 0 };
  }

  // skip-existing: fetch existing rows in the date range, filter out, insert rest
  const dates = Array.from(new Set(rows.map((r) => r.assignment_date)));
  const salesmen = Array.from(new Set(rows.map((r) => r.salesman_id)));

  const { data: existing, error: exErr } = await admin
    .from("salesman_beat_assignments")
    .select("salesman_id, assignment_date")
    .in("assignment_date", dates)
    .in("salesman_id", salesmen);

  if (exErr) return { inserted: 0, skipped: 0, error: exErr.message };

  const existingKeys = new Set(
    (existing ?? []).map((e) => `${e.salesman_id}|${e.assignment_date}`),
  );
  const newRows = rows.filter(
    (r) => !existingKeys.has(`${r.salesman_id}|${r.assignment_date}`),
  );
  const skipped = rows.length - newRows.length;

  if (newRows.length === 0) return { inserted: 0, skipped };

  const { error: insErr } = await admin
    .from("salesman_beat_assignments")
    .insert(newRows);
  if (insErr) return { inserted: 0, skipped, error: insErr.message };

  return { inserted: newRows.length, skipped };
}

/**
 * Copy every plan entry from sourceJcId into targetJcId. Useful for "next
 * JC's plan starts as a copy of last JC, then tweak". Existing rows in the
 * target are overwritten on (jc_id, jc_day, salesman_id) conflict.
 *
 * If source has more days than target (e.g. copying JC13's 29 days into a
 * 28-day JC) the overflow entries are dropped silently.
 */
export async function copyJcPlan(
  sourceJcId: string,
  targetJcId: string,
): Promise<{ copied: number; error?: string }> {
  const admin = getAdminClient();
  const targetJc = await getJourneyCycleById(targetJcId);
  if (!targetJc) return { copied: 0, error: "Target JC not found" };

  const sourcePlan = await listPlanEntriesForJc(sourceJcId);
  if (sourcePlan.length === 0) {
    return { copied: 0, error: "Source JC has no plan entries to copy" };
  }

  const newEntries = sourcePlan
    .filter((p) => p.jc_day <= targetJc.days_count)
    .map((p) => ({
      jc_id: targetJcId,
      jc_day: p.jc_day,
      salesman_id: p.salesman_id,
      beat_id: p.beat_id,
    }));

  if (newEntries.length === 0) {
    return { copied: 0, error: "No applicable entries to copy" };
  }

  const { error } = await admin
    .from("beat_journey_plan")
    .upsert(newEntries, { onConflict: "jc_id,jc_day,salesman_id" });
  if (error) return { copied: 0, error: error.message };

  return { copied: newEntries.length };
}
