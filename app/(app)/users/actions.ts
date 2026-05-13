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
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, role, phone, salesman_id: salesmanId },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
  });
  if (error) return { error: error.message };

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

function driverPhoneToEmail(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@${DRIVER_EMAIL_DOMAIN}`;
}

function isDriverSyntheticEmail(email: string | null | undefined): boolean {
  if (!email) return false;
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

// Helper: reset a driver's password (admin) — keeps old name for back-compat
export async function resetDriverPassword(userId: string, newPassword: string) {
  return resetUserPassword(userId, newPassword);
}

// =============================================================================
// EDIT USER — name + phone (+ optional password reset)
//
// Updates app_users.full_name and app_users.phone. For driver/helper users
// whose login is the synthetic email built from phone, also updates the
// auth email so they can still log in with the new number.
//
// Password is optional. If provided, it's reset via auth admin.
// =============================================================================
export async function editUser(input: {
  userId: string;
  fullName?: string;
  phone?: string | null;
  newPassword?: string;
}) {
  await ensureAdmin();
  const admin = createAdminClient();

  if (!input.userId) return { error: "User id is required" };

  // Load current user state — need email to know if synthetic
  const { data: appUser, error: loadErr } = await admin
    .from("app_users")
    .select("id, full_name, email, phone, role, active")
    .eq("id", input.userId)
    .maybeSingle();
  if (loadErr) return { error: `Load failed: ${loadErr.message}` };
  if (!appUser) return { error: "User not found" };

  const updates: { full_name?: string; phone?: string | null; email?: string } = {};
  let newAuthEmail: string | null = null;

  // Name
  if (input.fullName !== undefined) {
    const trimmed = input.fullName.trim();
    if (!trimmed) return { error: "Name cannot be empty" };
    updates.full_name = trimmed;
  }

  // Phone
  let phoneDigits: string | null = null;
  if (input.phone !== undefined) {
    if (input.phone === null || input.phone === "") {
      // Caller cleared phone — but for synthetic-login users, this is unsafe
      if (isDriverSyntheticEmail(appUser.email)) {
        return { error: "Phone can't be empty for driver/helper accounts (they log in with phone)" };
      }
      updates.phone = null;
    } else {
      const digits = input.phone.replace(/\D/g, "");
      if (digits.length < 10) return { error: "Enter a valid phone number (10+ digits)" };
      phoneDigits = digits;
      updates.phone = digits;

      // For synthetic-login users, update auth email too
      if (isDriverSyntheticEmail(appUser.email)) {
        newAuthEmail = driverPhoneToEmail(digits);
        // Check collision: is there another user with this synthetic email?
        if (newAuthEmail !== appUser.email) {
          const { data: collision } = await admin
            .from("app_users")
            .select("id, full_name")
            .eq("email", newAuthEmail)
            .neq("id", input.userId)
            .maybeSingle();
          if (collision) {
            return { error: `Phone ${digits} is already used by ${collision.full_name}` };
          }
          updates.email = newAuthEmail;
        }
      }
    }
  }

  // Update auth side first (email + password)
  if (newAuthEmail && newAuthEmail !== appUser.email) {
    const { error: authErr } = await admin.auth.admin.updateUserById(input.userId, {
      email: newAuthEmail,
      email_confirm: true,
    });
    if (authErr) return { error: `Auth update failed: ${authErr.message}` };
  }

  if (input.newPassword !== undefined && input.newPassword !== "") {
    if (input.newPassword.length < 6) return { error: "Password must be at least 6 characters" };
    const { error: pwErr } = await admin.auth.admin.updateUserById(input.userId, {
      password: input.newPassword,
    });
    if (pwErr) return { error: `Password update failed: ${pwErr.message}` };
  }

  // Update app_users row
  if (Object.keys(updates).length > 0) {
    const { error: upErr } = await admin.from("app_users").update(updates).eq("id", input.userId);
    if (upErr) return { error: `Profile update failed: ${upErr.message}` };
  }

  revalidatePath("/users");
  return {
    ok: true,
    isDriverAccount: isDriverSyntheticEmail(appUser.email),
    phoneUpdated: !!phoneDigits && phoneDigits !== appUser.phone,
    loginChanged: !!newAuthEmail,
    passwordReset: !!(input.newPassword && input.newPassword !== ""),
  };
}

// Standalone password reset — kept for back-compat; also called by resetDriverPassword
export async function resetUserPassword(userId: string, newPassword: string) {
  await ensureAdmin();
  if (!newPassword || newPassword.length < 6) return { error: "Password must be at least 6 characters" };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return { error: error.message };
  return { ok: true };
}
