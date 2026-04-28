"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

interface ActorInfo {
  userId: string;
  fullName: string;
  role: string;
}

async function requireRoles(roles: string[]): Promise<ActorInfo> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: appUser } = await supabase
    .from("app_users").select("id, full_name, role, active")
    .eq("id", user.id).single();
  if (!appUser?.active) throw new Error("User inactive");
  if (!roles.includes(appUser.role)) throw new Error(`Role "${appUser.role}" not allowed for this action`);
  return { userId: appUser.id, fullName: appUser.full_name, role: appUser.role };
}

// =============================================================================
// UPDATE CUSTOMER BEAT (admin override)
//
// Stamps beat_overridden_at so the Rupyz sync won't clobber this assignment.
// Pass beatId = null to clear the beat (and the override stamp too — we treat
// "no beat" as not-overridden, so a future sync can populate it).
// =============================================================================
export async function updateCustomerBeat(customerId: string, beatId: string | null) {
  try {
    const actor = await requireRoles(["admin"]);
    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("customers")
      .select("id, name, beat_id")
      .eq("id", customerId)
      .maybeSingle();
    if (!existing) return { error: "Customer not found" };

    if (beatId) {
      // Validate beat exists
      const { data: beat } = await admin.from("beats").select("id, name").eq("id", beatId).maybeSingle();
      if (!beat) return { error: "Beat not found" };
    }

    const { error } = await admin.from("customers").update({
      beat_id: beatId,
      beat_overridden_at: beatId ? new Date().toISOString() : null,
    }).eq("id", customerId);
    if (error) return { error: error.message };

    void actor;
    revalidatePath("/customers");
    revalidatePath("/orders");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
