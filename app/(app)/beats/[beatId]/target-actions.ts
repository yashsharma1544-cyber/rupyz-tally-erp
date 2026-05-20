"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

async function requireAdmin(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: me } = await supabase
    .from("app_users").select("id, role, active").eq("id", user.id).single();
  if (!me?.active || me.role !== "admin") throw new Error("Admin only");
  return me.id;
}

export interface AllocationRow {
  customer_id: string;
  customer_name: string;
  city: string | null;
  hist_kg: number;
  share_pct: number;
  target_kg: number;
}

/**
 * Load the allocation editor state for a (cycle, beat):
 *   - the saved beat target + customer rows if one exists, OR
 *   - auto-filled shares from beat_customer_shares() if not.
 */
export async function loadAllocation(
  journeyCycleId: string,
  beatId: string,
  windowMonths = 12,
): Promise<
  | { ok: true; targetKg: number; saved: boolean; rows: AllocationRow[] }
  | { error: string }
> {
  try {
    await requireAdmin();
    const admin = createAdminClient();

    // Existing target?
    const { data: bt } = await admin
      .from("beat_targets")
      .select("id, target_kg, window_months")
      .eq("journey_cycle_id", journeyCycleId)
      .eq("beat_id", beatId)
      .maybeSingle();

    // Always pull fresh shares for hist_kg + auto-fill fallback.
    const { data: shares, error: shareErr } = await admin.rpc("beat_customer_shares", {
      p_beat_id: beatId,
      p_window_months: bt?.window_months ?? windowMonths,
    });
    if (shareErr) return { error: shareErr.message };

    type Share = { customer_id: string; customer_name: string; city: string | null; hist_kg: number | string; share_pct: number | string };
    const shareRows = (shares ?? []) as Share[];

    if (bt) {
      // Merge saved customer_targets over the share list.
      const { data: ct } = await admin
        .from("customer_targets")
        .select("customer_id, share_pct, target_kg")
        .eq("beat_target_id", bt.id);
      const savedMap = new Map(
        (ct ?? []).map((r) => [r.customer_id, { share_pct: Number(r.share_pct), target_kg: Number(r.target_kg) }]),
      );
      const rows: AllocationRow[] = shareRows.map((s) => {
        const saved = savedMap.get(s.customer_id);
        const share = saved ? saved.share_pct : Number(s.share_pct);
        return {
          customer_id: s.customer_id,
          customer_name: s.customer_name,
          city: s.city,
          hist_kg: Number(s.hist_kg),
          share_pct: share,
          target_kg: saved ? saved.target_kg : 0,
        };
      });
      return { ok: true, targetKg: Number(bt.target_kg), saved: true, rows };
    }

    // No saved target — auto-fill from shares, target 0.
    const rows: AllocationRow[] = shareRows.map((s) => ({
      customer_id: s.customer_id,
      customer_name: s.customer_name,
      city: s.city,
      hist_kg: Number(s.hist_kg),
      share_pct: Number(s.share_pct),
      target_kg: 0,
    }));
    return { ok: true, targetKg: 0, saved: false, rows };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Save (upsert) a beat target + per-customer allocation.
 * allocations carry share_pct (editable); allocated kg is recomputed
 * server-side as targetKg * share_pct/100 to keep the math authoritative.
 */
export async function saveAllocation(input: {
  journeyCycleId: string;
  beatId: string;
  targetKg: number;
  windowMonths: number;
  allocations: { customer_id: string; share_pct: number; hist_kg: number }[];
}): Promise<{ ok: true; allocatedKg: number; count: number } | { error: string }> {
  try {
    const userId = await requireAdmin();
    const admin = createAdminClient();

    if (!input.journeyCycleId) return { error: "Pick a journey cycle" };
    if (!input.beatId) return { error: "Missing beat" };
    if (!(input.targetKg >= 0)) return { error: "Target must be 0 or more" };

    // Upsert beat_targets (unique on journey_cycle_id + beat_id).
    const { data: bt, error: btErr } = await admin
      .from("beat_targets")
      .upsert(
        {
          journey_cycle_id: input.journeyCycleId,
          beat_id: input.beatId,
          target_kg: input.targetKg,
          window_months: input.windowMonths,
          created_by: userId,
        },
        { onConflict: "journey_cycle_id,beat_id" },
      )
      .select("id")
      .single();
    if (btErr || !bt) return { error: btErr?.message || "Failed to save beat target" };

    // Replace customer_targets for this beat target.
    await admin.from("customer_targets").delete().eq("beat_target_id", bt.id);

    const rows = input.allocations.map((a) => {
      const share = Number.isFinite(a.share_pct) ? Math.max(0, a.share_pct) : 0;
      return {
        beat_target_id: bt.id,
        customer_id: a.customer_id,
        share_pct: share,
        target_kg: Math.round((input.targetKg * share) / 100 * 100) / 100,
        hist_kg: Number.isFinite(a.hist_kg) ? a.hist_kg : 0,
      };
    });

    if (rows.length > 0) {
      const { error: insErr } = await admin.from("customer_targets").insert(rows);
      if (insErr) return { error: insErr.message };
    }

    const allocatedKg = rows.reduce((s, r) => s + r.target_kg, 0);

    revalidatePath(`/beats/${input.beatId}`);
    return { ok: true, allocatedKg: Math.round(allocatedKg * 10) / 10, count: rows.length };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
