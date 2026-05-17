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

export async function saveBeatAreas(
  edits: { id: string; area: string | null }[],
): Promise<{ ok: boolean; updated: number; error?: string }> {
  try {
    const supabase = await requireAdmin();
    if (edits.length === 0) return { ok: true, updated: 0 };

    // Apply each update individually so per-row errors don't take down a batch.
    // Number of beats is small (~25-30), so the perf cost is negligible.
    let updated = 0;
    const errors: string[] = [];
    for (const e of edits) {
      const normalized = (e.area ?? "").trim();
      const value = normalized.length > 0 ? normalized : null;
      const { error } = await supabase
        .from("beats")
        .update({ area: value })
        .eq("id", e.id);
      if (error) {
        errors.push(`${e.id.slice(0, 8)}: ${error.message}`);
      } else {
        updated++;
      }
    }

    revalidatePath("/beats/manage-areas");
    revalidatePath("/beats");

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
