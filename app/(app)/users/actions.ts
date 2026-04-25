"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";
import { revalidatePath } from "next/cache";

async function ensureAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: appUser } = await supabase.from("app_users").select("role,active").eq("id", user.id).single();
  if (!appUser || !appUser.active || appUser.role !== "admin") throw new Error("Forbidden — admin only");
}

export async function inviteUser(formData: FormData) {
  await ensureAdmin();
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const fullName = (formData.get("full_name") as string)?.trim();
  const role = formData.get("role") as UserRole;
  const phone = (formData.get("phone") as string)?.trim() || null;
  const salesmanId = (formData.get("salesman_id") as string) || null;

  if (!email || !fullName || !role) return { error: "Email, name, and role are required." };

  const admin = createAdminClient();
  // Use inviteUserByEmail so the user receives an email to set password.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, role, phone, salesman_id: salesmanId },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
  });
  if (error) return { error: error.message };

  // The on-signup trigger will create the app_users row from raw_user_meta_data.
  revalidatePath("/users");
  return { ok: true, userId: data.user?.id };
}

export async function setUserActive(userId: string, active: boolean) {
  await ensureAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("app_users").update({ active }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/users");
  return { ok: true };
}

export async function setUserRole(userId: string, role: UserRole) {
  await ensureAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("app_users").update({ role }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/users");
  return { ok: true };
}
