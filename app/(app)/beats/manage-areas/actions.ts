"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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
  return supabase;
}

function revalidateAll(): void {
  revalidatePath("/beats/manage-areas");
  revalidatePath("/beats");
}

// -------- Area CRUD --------

export async function createArea(
  name: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const supabase = await requireAdmin();
    const trimmed = name.trim();
    if (trimmed.length === 0) return { ok: false, error: "Area name required" };
    if (trimmed.length > 100)
      return { ok: false, error: "Area name too long (max 100)" };

    const { data, error } = await supabase
      .from("areas")
      .insert({ name: trimmed })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: `Area "${trimmed}" already exists` };
      }
      return { ok: false, error: error.message };
    }
    revalidateAll();
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function renameArea(
  id: string,
  newName: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await requireAdmin();
    const trimmed = newName.trim();
    if (trimmed.length === 0) return { ok: false, error: "Name required" };
    if (trimmed.length > 100) return { ok: false, error: "Name too long" };
    const { error } = await supabase
      .from("areas")
      .update({ name: trimmed })
      .eq("id", id);
    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: `Area "${trimmed}" already exists` };
      }
      return { ok: false, error: error.message };
    }
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteArea(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await requireAdmin();
    // ON DELETE SET NULL on beats.area_id means beats become unassigned but
    // are not destroyed. Safe to delete the area.
    const { error } = await supabase.from("areas").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// -------- Beat → area assignment --------

export async function saveBeatAssignments(
  edits: { beat_id: string; area_id: string | null }[],
): Promise<{ ok: boolean; updated: number; error?: string }> {
  try {
    const supabase = await requireAdmin();
    if (edits.length === 0) return { ok: true, updated: 0 };

    let updated = 0;
    const errors: string[] = [];
    for (const e of edits) {
      const { error } = await supabase
        .from("beats")
        .update({ area_id: e.area_id })
        .eq("id", e.beat_id);
      if (error) {
        errors.push(`${e.beat_id.slice(0, 8)}: ${error.message}`);
      } else {
        updated++;
      }
    }
    revalidateAll();
    if (errors.length > 0 && updated === 0) {
      return { ok: false, updated, error: errors.join("; ") };
    }
    return {
      ok: errors.length === 0,
      updated,
      error: errors.length > 0 ? `Partial: ${errors.join("; ")}` : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      updated: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
