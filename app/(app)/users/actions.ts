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

// =============================================================================
// CREATE DRIVER — phone + password (no email round-trip)
//
// Drivers don't have email. We synthesize an email like 9876543210@drivers.sushil.local
// so Supabase's email-based auth still works. Login form accepts the phone number
// and converts to the synthetic email under the hood.
// =============================================================================

const DRIVER_EMAIL_DOMAIN = "drivers.sushil.local";

export function driverPhoneToEmail(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@${DRIVER_EMAIL_DOMAIN}`;
}

export function isDriverEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${DRIVER_EMAIL_DOMAIN}`);
}

export async function createDriver(formData: FormData) {
  await ensureAdmin();

  const fullName = (formData.get("full_name") as string)?.trim();
  const phone = (formData.get("phone") as string)?.trim();
  const password = (formData.get("password") as string)?.trim();

  if (!fullName) return { error: "Driver name is required" };
  if (!phone) return { error: "Phone number is required" };
  if (!password || password.length < 6) return { error: "Password must be at least 6 characters" };

  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return { error: "Enter a valid phone number (10+ digits)" };

  const syntheticEmail = driverPhoneToEmail(digits);
  const admin = createAdminClient();

  // Create the auth user with the synthetic email + password, pre-confirmed
  // (no email round-trip). Metadata sets role to 'driver' so the on-signup
  // trigger creates the right app_users row.
  const { data, error } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role: "driver",
      phone: digits,
    },
  });
  if (error) return { error: error.message };

  // The on-signup trigger should have created the app_users row. If not
  // (older trigger versions), insert directly.
  if (data.user?.id) {
    const { data: existing } = await admin.from("app_users").select("id").eq("id", data.user.id).maybeSingle();
    if (!existing) {
      const { error: insErr } = await admin.from("app_users").insert({
        id: data.user.id,
        full_name: fullName,
        email: syntheticEmail,
        phone: digits,
        role: "driver",
        active: true,
      });
      if (insErr) return { error: `User created in auth but app_users failed: ${insErr.message}` };
    }
  }

  revalidatePath("/users");
  return { ok: true, userId: data.user?.id, phone: digits };
}

// Helper: reset a driver's password (admin)
export async function resetDriverPassword(userId: string, newPassword: string) {
  await ensureAdmin();
  if (!newPassword || newPassword.length < 6) return { error: "Password must be at least 6 characters" };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return { error: error.message };
  return { ok: true };
}
