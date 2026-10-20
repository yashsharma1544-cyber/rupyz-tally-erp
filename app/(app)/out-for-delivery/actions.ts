"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { LineRow } from "./out-for-delivery-client";

type AdminInfo = { userId: string; fullName: string };

async function requireAdmin(): Promise<AdminInfo | null> {
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

export async function fetchInvoiceLines(invoiceId: string): Promise<LineRow[]> {
  if (!(await requireAdmin())) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("tally_invoice_lines")
    .select("line_no, item_name, hsn, qty, qty_kg, qty_raw_text, rate, amount")
    .eq("invoice_id", invoiceId)
    .order("line_no", { ascending: true });
  return (data ?? []).map((r) => ({
    line_no: r.line_no as number | null,
    item_name: r.item_name as string | null,
    hsn: r.hsn as string | null,
    qty: r.qty as number | null,
    qty_kg: r.qty_kg as number | null,
    qty_raw_text: r.qty_raw_text as string | null,
    rate: r.rate as number | null,
    amount: r.amount as number | null,
  }));
}

export async function createDispatch(input: {
  invoiceIds: string[];
  vehicleId: string | null;
  driverUserId: string | null;
  dispatchDate: string; // YYYY-MM-DD
  notes: string | null;
}): Promise<{ ok: true; dispatchId: string } | { ok: false; error: string }> {
  const actor = await requireAdmin();
  if (!actor) return { ok: false, error: "Not authorized" };
  if (input.invoiceIds.length === 0) return { ok: false, error: "No invoices selected" };

  const admin = createAdminClient();

  // Guard: all selected invoices must still be pending (no dispatch_id yet)
  const { data: check } = await admin
    .from("tally_invoices")
    .select("id, voucher_no, dispatch_id, delivered_at, total_amount")
    .in("id", input.invoiceIds);
  if (!check || check.length !== input.invoiceIds.length) {
    return { ok: false, error: "Some invoices not found." };
  }
  const alreadyDispatched = check.filter((r) => r.dispatch_id != null);
  if (alreadyDispatched.length > 0) {
    return { ok: false, error: `Already dispatched: ${alreadyDispatched.map((r) => r.voucher_no).slice(0, 3).join(", ")}` };
  }

  // Vehicle / driver lookup for denormalized labels
  let vehicleNumber: string | null = null;
  let driverName: string | null = null;
  if (input.vehicleId) {
    const { data: v } = await admin.from("vehicles").select("number").eq("id", input.vehicleId).maybeSingle();
    vehicleNumber = (v?.number as string) ?? null;
  }
  if (input.driverUserId) {
    const { data: d } = await admin.from("app_users").select("full_name").eq("id", input.driverUserId).maybeSingle();
    driverName = (d?.full_name as string) ?? null;
  }

  // Totals from line items
  const { data: kgRows } = await admin
    .from("tally_invoice_lines")
    .select("invoice_id, qty_kg")
    .in("invoice_id", input.invoiceIds);
  const totalKg = (kgRows ?? []).reduce((a, r) => a + (Number(r.qty_kg) || 0), 0);
  const totalValue = check.reduce((a, r) => a + (Number(r.total_amount) || 0), 0);

  // Dispatch number: DISP-YYYYMMDD-NNN (today's seq)
  const dateKey = input.dispatchDate.replace(/-/g, "");
  const { count: todayCount } = await admin
    .from("tally_dispatches")
    .select("id", { count: "exact", head: true })
    .eq("dispatch_date", input.dispatchDate);
  const seq = String((todayCount ?? 0) + 1).padStart(3, "0");
  const dispatchNo = `DISP-${dateKey}-${seq}`;

  const { data: inserted, error: insErr } = await admin
    .from("tally_dispatches")
    .insert({
      dispatch_no: dispatchNo,
      dispatch_date: input.dispatchDate,
      vehicle_id: input.vehicleId,
      vehicle_number: vehicleNumber,
      driver_user_id: input.driverUserId,
      driver_name: driverName,
      notes: input.notes,
      created_by: actor.userId,
      created_by_name: actor.fullName,
      invoice_count: input.invoiceIds.length,
      total_amount: totalValue,
      total_kg: totalKg,
    })
    .select("id")
    .single();
  if (insErr || !inserted) return { ok: false, error: insErr?.message ?? "Insert failed" };

  const dispatchId = inserted.id as string;
  const now = new Date().toISOString();

  // Stamp invoices
  const { error: updErr } = await admin
    .from("tally_invoices")
    .update({ dispatch_id: dispatchId, dispatched_at: now })
    .in("id", input.invoiceIds);
  if (updErr) {
    // Best-effort rollback of the header row
    await admin.from("tally_dispatches").delete().eq("id", dispatchId);
    return { ok: false, error: updErr.message };
  }

  revalidatePath("/out-for-delivery");
  return { ok: true, dispatchId };
}

export async function markDelivered(invoiceIds: string[]): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const actor = await requireAdmin();
  if (!actor) return { ok: false, error: "Not authorized" };
  if (invoiceIds.length === 0) return { ok: false, error: "No invoices" };

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: upd, error } = await admin
    .from("tally_invoices")
    .update({ delivered_at: now, delivered_by: actor.userId })
    .in("id", invoiceIds)
    .is("delivered_at", null)
    .select("id, dispatch_id");
  if (error) return { ok: false, error: error.message };

  // Auto-complete dispatches whose last invoice just landed
  const dispatchIds = Array.from(new Set((upd ?? []).map((r) => r.dispatch_id as string).filter(Boolean)));
  for (const did of dispatchIds) {
    const { count } = await admin
      .from("tally_invoices")
      .select("id", { count: "exact", head: true })
      .eq("dispatch_id", did)
      .is("delivered_at", null);
    if ((count ?? 0) === 0) {
      await admin.from("tally_dispatches").update({ completed_at: now }).eq("id", did);
    }
  }

  revalidatePath("/out-for-delivery");
  return { ok: true, count: upd?.length ?? 0 };
}
