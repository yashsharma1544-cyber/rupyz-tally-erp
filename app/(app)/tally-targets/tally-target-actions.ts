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

export interface TallyAllocRow {
  party_name: string;
  hist_kg: number;
  share_pct: number;
}

export async function loadTallyAllocation(
  company: string,
  partyGroup: string,
  periodLabel: string,
): Promise<
  | { ok: true; targetKg: number; saved: boolean; rows: TallyAllocRow[] }
  | { error: string }
> {
  try {
    await requireAdmin();
    const admin = createAdminClient();

    const { data: shares, error: shareErr } = await admin.rpc("tally_group_shares", {
      p_company: company,
      p_party_group: partyGroup,
      p_from: null,
      p_to: null,
    });
    if (shareErr) return { error: shareErr.message };
    type S = { party_name: string; hist_kg: number | string; share_pct: number | string };
    const shareRows = (shares ?? []) as S[];

    const { data: bt } = await admin
      .from("tally_beat_targets")
      .select("id, target_kg")
      .eq("company", company)
      .eq("party_group", partyGroup)
      .eq("period_label", periodLabel)
      .maybeSingle();

    if (bt) {
      const { data: ct } = await admin
        .from("tally_customer_targets")
        .select("party_name, share_pct")
        .eq("beat_target_id", bt.id);
      const savedMap = new Map((ct ?? []).map((r) => [r.party_name, Number(r.share_pct)]));
      const rows: TallyAllocRow[] = shareRows.map((s) => ({
        party_name: s.party_name,
        hist_kg: Number(s.hist_kg),
        share_pct: savedMap.has(s.party_name) ? savedMap.get(s.party_name)! : Number(s.share_pct),
      }));
      return { ok: true, targetKg: Number(bt.target_kg), saved: true, rows };
    }

    const rows: TallyAllocRow[] = shareRows.map((s) => ({
      party_name: s.party_name,
      hist_kg: Number(s.hist_kg),
      share_pct: Number(s.share_pct),
    }));
    return { ok: true, targetKg: 0, saved: false, rows };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveTallyAllocation(input: {
  company: string;
  partyGroup: string;
  periodLabel: string;
  targetKg: number;
  allocations: { party_name: string; share_pct: number; hist_kg: number }[];
}): Promise<{ ok: true; allocatedKg: number; count: number } | { error: string }> {
  try {
    const userId = await requireAdmin();
    const admin = createAdminClient();

    if (!input.company) return { error: "Pick a company" };
    if (!input.partyGroup) return { error: "Pick a beat (party group)" };
    if (!input.periodLabel.trim()) return { error: "Enter a period label" };
    if (!(input.targetKg >= 0)) return { error: "Target must be 0 or more" };

    const { data: bt, error: btErr } = await admin
      .from("tally_beat_targets")
      .upsert(
        {
          company: input.company,
          party_group: input.partyGroup,
          period_label: input.periodLabel.trim(),
          target_kg: input.targetKg,
          created_by: userId,
        },
        { onConflict: "company,party_group,period_label" },
      )
      .select("id")
      .single();
    if (btErr || !bt) return { error: btErr?.message || "Failed to save beat target" };

    await admin.from("tally_customer_targets").delete().eq("beat_target_id", bt.id);

    const rows = input.allocations.map((a) => {
      const share = Number.isFinite(a.share_pct) ? Math.max(0, a.share_pct) : 0;
      return {
        beat_target_id: bt.id,
        party_name: a.party_name,
        share_pct: share,
        target_kg: Math.round((input.targetKg * share) / 100 * 100) / 100,
        hist_kg: Number.isFinite(a.hist_kg) ? a.hist_kg : 0,
      };
    });
    if (rows.length > 0) {
      const { error: insErr } = await admin.from("tally_customer_targets").insert(rows);
      if (insErr) return { error: insErr.message };
    }

    const allocatedKg = rows.reduce((s, r) => s + r.target_kg, 0);
    revalidatePath("/tally-targets");
    return { ok: true, allocatedKg: Math.round(allocatedKg * 10) / 10, count: rows.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
