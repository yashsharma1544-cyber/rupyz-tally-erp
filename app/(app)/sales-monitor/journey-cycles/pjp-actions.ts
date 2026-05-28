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
 */
export async function savePlanForSalesman(
  jcId: string,
  salesmanId: string,
  entries: { jc_day: number; beat_id: string | null }[],
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
