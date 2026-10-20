"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

async function requireAdmin(): Promise<{ userId: string; fullName: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: me } = await supabase
    .from("app_users")
    .select("id, full_name, role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || me.role !== "admin") return null;
  return { userId: me.id as string, fullName: (me.full_name as string) ?? user.email ?? "admin" };
}

export async function assignPartyBeats(
  partyNames: string[],
  beat: string,
): Promise<{ ok: true; parties: number; invoices: number } | { ok: false; error: string }> {
  const actor = await requireAdmin();
  if (!actor) return { ok: false, error: "Not authorized" };

  const cleanBeat = beat.trim();
  if (!cleanBeat) return { ok: false, error: "Beat required" };
  if (partyNames.length === 0) return { ok: false, error: "No parties selected" };

  const admin = createAdminClient();

  // Upsert override rows
  const now = new Date().toISOString();
  const rows = partyNames.map((p) => ({
    party_name: p,
    beat: cleanBeat,
    updated_by: actor.userId,
    updated_by_name: actor.fullName,
    updated_at: now,
  }));
  const { error: upErr } = await admin
    .from("tally_party_beat_overrides")
    .upsert(rows, { onConflict: "party_name" });
  if (upErr) return { ok: false, error: upErr.message };

  // Stamp inferred_beat on every matching invoice
  const { data: upd, error: updErr } = await admin
    .from("tally_invoices")
    .update({ inferred_beat: cleanBeat })
    .eq("company", "Anjali Agency")
    .in("party_name", partyNames)
    .select("id");
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath("/out-for-delivery/parties");
  revalidatePath("/out-for-delivery");
  return { ok: true, parties: partyNames.length, invoices: upd?.length ?? 0 };
}
