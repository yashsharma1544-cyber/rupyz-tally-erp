"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { applyJcPlan, copyJcPlan } from "@/lib/sales-monitor/journey-cycle";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: appUser } = await supabase
    .from("app_users").select("role").eq("id", user.id).single();
  if (!appUser || appUser.role !== "admin") throw new Error("Not authorized");
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const sr = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createServiceClient(url, sr, { auth: { persistSession: false } });
}

/**
 * Persist a single salesman's plan for the given JC. Delete-then-insert so
 * the saved set exactly matches what's on screen. Days with beat_id=null are
 * not inserted (salesman is off that day).
 *
 * visit_type marks a day as an order visit or a collection visit. Collection
 * days keep the beat assigned but are excluded from sales coverage reporting.
 */
export async function savePlanForSalesman(
  jcId: string,
  salesmanId: string,
  entries: { jc_day: number; beat_id: string | null; visit_type?: "order" | "collection" }[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
    const admin = getServiceClient();

    const { error: delErr } = await admin
      .from("beat_journey_plan")
      .delete()
      .eq("jc_id", jcId)
      .eq("salesman_id", salesmanId);
    if (delErr) return { ok: false, error: `delete: ${delErr.message}` };

    const rows = entries
      .filter((e) => e.beat_id !== null && e.beat_id !== "")
      .map((e) => ({
        jc_id: jcId,
        jc_day: e.jc_day,
        salesman_id: salesmanId,
        beat_id: e.beat_id as string,
        visit_type: e.visit_type === "collection" ? "collection" : "order",
      }));

    if (rows.length > 0) {
      const { error: insErr } = await admin.from("beat_journey_plan").insert(rows);
      if (insErr) return { ok: false, error: `insert: ${insErr.message}` };
    }

    revalidatePath("/sales-monitor/journey-cycles");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Beat targets for a JC, used by the downloadable target sheet. */
export async function getBeatTargets(
  jcId: string,
): Promise<{ ok: boolean; targets: { beat_id: string; target_kg: number }[]; error?: string }> {
  try {
    await requireAdmin();
    const admin = getServiceClient();
    const { data, error } = await admin
      .from("beat_jc_targets")
      .select("beat_id, target_kg")
      .eq("jc_id", jcId);
    if (error) return { ok: false, targets: [], error: error.message };
    return {
      ok: true,
      targets: (data ?? []).map((r) => ({
        beat_id: r.beat_id as string,
        target_kg: Number(r.target_kg) || 0,
      })),
    };
  } catch (e) {
    return { ok: false, targets: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Billed kg per beat per day, for the Actual column on the target sheet.
 * Sources tally_sales and resolves party -> beat through tally_customer_map.
 * NOTE: only as current as the Tally bridge has loaded.
 */
export async function getActualKg(
  fromDate: string,
  toDate: string,
): Promise<{
  ok: boolean;
  rows: { sale_date: string; beat_id: string; kg: number }[];
  lastLoaded: string | null;
  error?: string;
}> {
  try {
    await requireAdmin();
    const admin = getServiceClient();

    // party_name -> beat_id (highest confidence wins)
    const partyBeat = new Map<string, string>();
    const seen = new Map<string, number>();
    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("tally_customer_map")
        .select("party_name, beat_id, match_beat_id, confidence")
        .range(off, off + 999);
      if (error) return { ok: false, rows: [], lastLoaded: null, error: error.message };
      const page = data ?? [];
      for (const r of page) {
        const beat = (r.beat_id as string) || (r.match_beat_id as string);
        if (!beat || !r.party_name) continue;
        const conf = Number(r.confidence) || 0;
        const prev = seen.get(r.party_name as string);
        if (prev === undefined || conf > prev) {
          seen.set(r.party_name as string, conf);
          partyBeat.set(r.party_name as string, beat);
        }
      }
      if (page.length < 1000) break;
      if (off > 20000) break;
    }

    const agg = new Map<string, number>();
    let lastLoaded: string | null = null;

    for (let off = 0; ; off += 1000) {
      const { data, error } = await admin
        .from("tally_sales")
        .select("sale_date, party_name, qty_kg")
        .gte("sale_date", fromDate)
        .lte("sale_date", toDate)
        .not("qty_kg", "is", null)
        .order("sale_date", { ascending: true })
        .range(off, off + 999);
      if (error) return { ok: false, rows: [], lastLoaded: null, error: error.message };
      const page = data ?? [];
      for (const r of page) {
        const beat = partyBeat.get(r.party_name as string);
        if (!beat) continue;
        const key = `${r.sale_date}|${beat}`;
        agg.set(key, (agg.get(key) ?? 0) + (Number(r.qty_kg) || 0));
      }
      if (page.length < 1000) break;
      if (off > 60000) break;
    }

    const { data: maxRow } = await admin
      .from("tally_sales")
      .select("sale_date")
      .order("sale_date", { ascending: false })
      .limit(1);
    if (maxRow && maxRow.length) lastLoaded = maxRow[0].sale_date as string;

    const rows = Array.from(agg, ([k, kg]) => {
      const [sale_date, beat_id] = k.split("|");
      return { sale_date, beat_id, kg };
    });

    return { ok: true, rows, lastLoaded };
  } catch (e) {
    return {
      ok: false,
      rows: [],
      lastLoaded: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function copyFromOtherJc(
  targetJcId: string,
  sourceJcId: string,
): Promise<{ ok: boolean; copied: number; error?: string }> {
  try {
    await requireAdmin();
    const result = await copyJcPlan(sourceJcId, targetJcId);
    if (result.error) return { ok: false, copied: 0, error: result.error };
    revalidatePath("/sales-monitor/journey-cycles");
    return { ok: true, copied: result.copied };
  } catch (e) {
    return { ok: false, copied: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function applyPlanToSchedule(
  jcId: string,
  mode: "skip-existing" | "force",
): Promise<{ ok: boolean; inserted: number; skipped: number; error?: string }> {
  try {
    await requireAdmin();
    const result = await applyJcPlan(jcId, mode);
    if (result.error) return { ok: false, inserted: 0, skipped: 0, error: result.error };
    revalidatePath("/sales-monitor");
    revalidatePath("/sales-monitor/journey-cycles");
    return { ok: true, inserted: result.inserted, skipped: result.skipped };
  } catch (e) {
    return { ok: false, inserted: 0, skipped: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
