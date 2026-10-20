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

export async function createVehicle(input: {
  number: string;
  make: string | null;
  capacity_kg: number | null;
}): Promise<{ ok: true; vehicle: { id: string; number: string; make: string | null; capacity_kg: number | null } } | { ok: false; error: string }> {
  const actor = await requireAdmin();
  if (!actor) return { ok: false, error: "Not authorized" };
  const number = input.number.trim().toUpperCase();
  if (!number) return { ok: false, error: "Vehicle number is required" };

  const admin = createAdminClient();

  // Reuse an existing vehicle with the same number if one is already there
  const { data: existing } = await admin
    .from("vehicles")
    .select("id, number, make, capacity_kg, active")
    .ilike("number", number)
    .maybeSingle();
  if (existing) {
    // Reactivate if it was soft-deleted
    if (!existing.active) {
      await admin.from("vehicles").update({ active: true }).eq("id", existing.id);
    }
    return {
      ok: true,
      vehicle: {
        id: existing.id as string,
        number: (existing.number as string) ?? number,
        make: (existing.make as string) ?? null,
        capacity_kg: (existing.capacity_kg as number) ?? null,
      },
    };
  }

  const { data: inserted, error } = await admin
    .from("vehicles")
    .insert({
      number,
      make: input.make?.trim() || null,
      capacity_kg: input.capacity_kg,
      active: true,
    })
    .select("id, number, make, capacity_kg")
    .single();
  if (error || !inserted) return { ok: false, error: error?.message ?? "Failed to create vehicle" };

  revalidatePath("/out-for-delivery");
  revalidatePath("/vehicles");
  return {
    ok: true,
    vehicle: {
      id: inserted.id as string,
      number: (inserted.number as string) ?? number,
      make: (inserted.make as string) ?? null,
      capacity_kg: (inserted.capacity_kg as number) ?? null,
    },
  };
}

export async function createDispatch(input: {
  invoiceIds: string[];
  vehicleId: string | null;
  helper1UserId: string | null;
  helper2UserId: string | null;
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

  // Vehicle / helper lookups for denormalized labels on the dispatch row
  let vehicleNumber: string | null = null;
  let helper1Name: string | null = null;
  let helper2Name: string | null = null;
  if (input.vehicleId) {
    const { data: v } = await admin.from("vehicles").select("number").eq("id", input.vehicleId).maybeSingle();
    vehicleNumber = (v?.number as string) ?? null;
  }
  const helperIds = [input.helper1UserId, input.helper2UserId].filter((x): x is string => !!x);
  if (helperIds.length > 0) {
    const { data: hs } = await admin.from("app_users").select("id, full_name").in("id", helperIds);
    const byId = new Map((hs ?? []).map((h) => [h.id as string, (h.full_name as string) ?? null]));
    helper1Name = input.helper1UserId ? byId.get(input.helper1UserId) ?? null : null;
    helper2Name = input.helper2UserId ? byId.get(input.helper2UserId) ?? null : null;
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
      helper1_user_id: input.helper1UserId,
      helper1_name: helper1Name,
      helper2_user_id: input.helper2UserId,
      helper2_name: helper2Name,
      // Keep legacy driver_* columns populated with helper1 for one release
      // so anything still reading them keeps working.
      driver_user_id: input.helper1UserId,
      driver_name: helper1Name,
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

  // Auto-populate vehicle loads from the invoice line items
  const { data: lineRows } = await admin
    .from("tally_invoice_lines")
    .select("item_name, hsn, qty, qty_kg")
    .in("invoice_id", input.invoiceIds)
    .not("item_name", "is", null);
  const loadMap = new Map<string, { item_name: string; hsn: string | null; loaded_qty: number; loaded_kg: number }>();
  for (const l of lineRows ?? []) {
    const key = (l.item_name as string) ?? "";
    if (!key) continue;
    const cur = loadMap.get(key) ?? { item_name: key, hsn: (l.hsn as string) ?? null, loaded_qty: 0, loaded_kg: 0 };
    cur.loaded_qty += Number(l.qty) || 0;
    cur.loaded_kg += Number(l.qty_kg) || 0;
    if (!cur.hsn && l.hsn) cur.hsn = l.hsn as string;
    loadMap.set(key, cur);
  }
  if (loadMap.size > 0) {
    const loadRows = Array.from(loadMap.values()).map((r) => ({
      dispatch_id: dispatchId,
      item_name: r.item_name,
      hsn: r.hsn,
      loaded_qty: r.loaded_qty,
      loaded_kg: r.loaded_kg,
    }));
    // table may not exist yet if migration hasn't been run; ignore errors silently
    await admin.from("tally_dispatch_loads").insert(loadRows);
  }

  revalidatePath("/out-for-delivery");
  return { ok: true, dispatchId };
}

export async function updateDispatchLoad(input: {
  loadId: string;
  loaded_qty?: number;
  loaded_kg?: number;
  returned_qty?: number;
  returned_kg?: number;
  notes?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAdmin();
  if (!actor) return { ok: false, error: "Not authorized" };
  const admin = createAdminClient();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.loaded_qty !== undefined) patch.loaded_qty = input.loaded_qty;
  if (input.loaded_kg !== undefined) patch.loaded_kg = input.loaded_kg;
  if (input.returned_qty !== undefined) {
    patch.returned_qty = input.returned_qty;
    patch.returned_at = new Date().toISOString();
    patch.returned_by = actor.userId;
  }
  if (input.returned_kg !== undefined) patch.returned_kg = input.returned_kg;
  if (input.notes !== undefined) patch.notes = input.notes;

  const { error } = await admin.from("tally_dispatch_loads").update(patch).eq("id", input.loadId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/out-for-delivery");
  return { ok: true };
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
