"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  saveAreaTarget,
  saveBeatTargets,
  saveCustomerTargets,
  applyDistributionToSchedule,
  type SavedBeatTarget,
  type SavedCustomerTarget,
} from "@/lib/sales-monitor/distribution";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || me.role !== "admin") throw new Error("Not authorized");
}

export type SaveDistributionPayload = {
  jcId: string;
  areaId: string;
  areaTargetKg: number;
  beatTargets: SavedBeatTarget[];
  customerTargets: SavedCustomerTarget[];
};

export async function saveDistribution(
  payload: SaveDistributionPayload,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();

    if (payload.areaTargetKg < 0) {
      return { ok: false, error: "Area target must be non-negative" };
    }

    const r1 = await saveAreaTarget(payload.jcId, payload.areaId, payload.areaTargetKg);
    if (!r1.ok) return { ok: false, error: `Area: ${r1.error}` };

    const r2 = await saveBeatTargets(payload.jcId, payload.beatTargets);
    if (!r2.ok) return { ok: false, error: `Beats: ${r2.error}` };

    const r3 = await saveCustomerTargets(payload.jcId, payload.customerTargets);
    if (!r3.ok) return { ok: false, error: `Customers: ${r3.error}` };

    revalidatePath(`/sales-monitor/journey-cycles/${payload.jcId}/distribute`);
    revalidatePath(`/sales-monitor/journey-cycles/${payload.jcId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function applyTargetsToSchedule(
  jcId: string,
  mode: "skip-existing" | "force",
): Promise<{
  ok: boolean;
  inserted: number;
  skipped: number;
  noTarget: number;
  error?: string;
}> {
  try {
    await requireAdmin();
    const result = await applyDistributionToSchedule(jcId, mode);
    revalidatePath(`/sales-monitor/journey-cycles/${jcId}/distribute`);
    revalidatePath(`/sales-monitor/journey-cycles/${jcId}`);
    revalidatePath("/sales-monitor");
    return result;
  } catch (e) {
    return {
      ok: false, inserted: 0, skipped: 0, noTarget: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
