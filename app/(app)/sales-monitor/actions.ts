"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!appUser || appUser.role !== "admin") throw new Error("Not authorized");
  return { supabase, userId: user.id };
}

function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
}

export async function saveAssignment(
  salesmanId: string,
  date: string,
  beatId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    validateDate(date);
    if (!salesmanId || !beatId) throw new Error("Missing salesman or beat");
    const { supabase, userId } = await requireAdmin();
    const { error } = await supabase
      .from("salesman_beat_assignments")
      .upsert(
        { salesman_id: salesmanId, assignment_date: date, beat_id: beatId, created_by: userId },
        { onConflict: "salesman_id,assignment_date" },
      );
    if (error) throw error;
    revalidatePath("/sales-monitor");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteAssignment(
  salesmanId: string,
  date: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    validateDate(date);
    const { supabase } = await requireAdmin();
    const { error } = await supabase
      .from("salesman_beat_assignments")
      .delete()
      .eq("salesman_id", salesmanId)
      .eq("assignment_date", date);
    if (error) throw error;
    revalidatePath("/sales-monitor");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveTarget(
  salesmanId: string,
  date: string,
  targetKg: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    validateDate(date);
    if (!salesmanId) throw new Error("Missing salesman");
    if (!Number.isFinite(targetKg) || targetKg <= 0) throw new Error("Target must be > 0");
    const { supabase, userId } = await requireAdmin();
    const { error } = await supabase
      .from("daily_sales_targets")
      .upsert(
        { salesman_id: salesmanId, target_date: date, target_kg: targetKg, created_by: userId },
        { onConflict: "salesman_id,target_date" },
      );
    if (error) throw error;
    revalidatePath("/sales-monitor");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteTarget(
  salesmanId: string,
  date: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    validateDate(date);
    const { supabase } = await requireAdmin();
    const { error } = await supabase
      .from("daily_sales_targets")
      .delete()
      .eq("salesman_id", salesmanId)
      .eq("target_date", date);
    if (error) throw error;
    revalidatePath("/sales-monitor");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Copy yesterday's beat assignments + targets onto the target date for any
 * salesman who doesn't already have an entry for that date. Existing entries
 * for the target date are preserved (no overwrite).
 */
export async function copyFromYesterday(
  toDate: string,
  fromDate: string,
): Promise<{ ok: true; assignmentsCopied: number; targetsCopied: number } | { ok: false; error: string }> {
  try {
    validateDate(toDate);
    validateDate(fromDate);
    const { supabase, userId } = await requireAdmin();

    // Pull what already exists on toDate so we don't overwrite manual choices.
    const [{ data: existingAssignments }, { data: existingTargets }] = await Promise.all([
      supabase.from("salesman_beat_assignments")
        .select("salesman_id")
        .eq("assignment_date", toDate),
      supabase.from("daily_sales_targets")
        .select("salesman_id")
        .eq("target_date", toDate),
    ]);
    const haveAssignment = new Set((existingAssignments || []).map(r => r.salesman_id));
    const haveTarget = new Set((existingTargets || []).map(r => r.salesman_id));

    // Pull yesterday's data.
    const [{ data: yAssignments }, { data: yTargets }] = await Promise.all([
      supabase.from("salesman_beat_assignments")
        .select("salesman_id, beat_id")
        .eq("assignment_date", fromDate),
      supabase.from("daily_sales_targets")
        .select("salesman_id, target_kg")
        .eq("target_date", fromDate),
    ]);

    const assignmentsToInsert = (yAssignments || [])
      .filter(a => !haveAssignment.has(a.salesman_id))
      .map(a => ({
        salesman_id: a.salesman_id,
        assignment_date: toDate,
        beat_id: a.beat_id,
        created_by: userId,
      }));

    const targetsToInsert = (yTargets || [])
      .filter(t => !haveTarget.has(t.salesman_id))
      .map(t => ({
        salesman_id: t.salesman_id,
        target_date: toDate,
        target_kg: t.target_kg,
        created_by: userId,
      }));

    if (assignmentsToInsert.length > 0) {
      const { error } = await supabase
        .from("salesman_beat_assignments")
        .insert(assignmentsToInsert);
      if (error) throw error;
    }

    if (targetsToInsert.length > 0) {
      const { error } = await supabase
        .from("daily_sales_targets")
        .insert(targetsToInsert);
      if (error) throw error;
    }

    revalidatePath("/sales-monitor");
    return {
      ok: true,
      assignmentsCopied: assignmentsToInsert.length,
      targetsCopied: targetsToInsert.length,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
