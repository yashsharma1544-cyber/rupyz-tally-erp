"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

type ActorInfo = { userId: string; fullName: string; role: string };

async function requireRoles(roles: string[]): Promise<ActorInfo> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: appUser } = await supabase
    .from("app_users")
    .select("id, full_name, role, active")
    .eq("id", user.id)
    .single();
  if (!appUser?.active || !roles.includes(appUser.role)) {
    throw new Error(`Forbidden — requires one of: ${roles.join(", ")}`);
  }
  return { userId: appUser.id, fullName: appUser.full_name, role: appUser.role };
}

const VAN_ROLES = ["admin", "van_lead", "van_helper"];

// =============================================================================
// CONFIRM / EDIT PRE-ORDER BILL (during trip)
// =============================================================================
export interface ConfirmPreOrderBillInput {
  billId: string;
  paymentMode: "cash" | "credit";
  outstandingCollected: number;
  paperBillNo?: string;
  notes?: string;
  // Optional: line edits if customer altered the order at the shop
  itemEdits?: { itemId: string; qty: number; rate: number }[];
  itemAdditions?: { productId: string; qty: number; rate: number }[];
  itemRemovals?: string[];
}

export async function confirmPreOrderBill(input: ConfirmPreOrderBillInput) {
  try {
    const actor = await requireRoles(VAN_ROLES);
    const admin = createAdminClient();

    const { data: bill } = await admin
      .from("trip_bills").select("*, trip:van_trips(status)").eq("id", input.billId).single();
    if (!bill) return { error: "Bill not found" };
    if (bill.bill_type !== "pre_order") return { error: "Not a pre-order bill" };
    const tripStatus = Array.isArray(bill.trip) ? bill.trip[0]?.status : (bill.trip as { status: string } | null)?.status;
    if (tripStatus !== "in_progress") return { error: `Trip is "${tripStatus}"` };

    // Apply line edits
    if (input.itemRemovals?.length) {
      await admin.from("trip_bill_items").delete().in("id", input.itemRemovals);
    }
    for (const e of input.itemEdits ?? []) {
      if (e.qty <= 0) return { error: "Qty must be > 0" };
      await admin.from("trip_bill_items").update({
        qty: e.qty, rate: e.rate, amount: e.qty * e.rate,
      }).eq("id", e.itemId);
    }
    for (const a of input.itemAdditions ?? []) {
      if (a.qty <= 0) return { error: "Qty must be > 0" };
      await admin.from("trip_bill_items").insert({
        bill_id: input.billId,
        product_id: a.productId,
        qty: a.qty, rate: a.rate, amount: a.qty * a.rate,
      });
    }

    // Recompute totals
    const { data: items } = await admin.from("trip_bill_items")
      .select("amount").eq("bill_id", input.billId);
    const subtotal = (items ?? []).reduce((s, i) => s + Number(i.amount), 0);
    const total = subtotal; // No GST on van bills (kachi parchi)

    const cashReceived = input.paymentMode === "cash" ? total : 0;

    await admin.from("trip_bills").update({
      payment_mode: input.paymentMode,
      outstanding_collected: input.outstandingCollected,
      cash_received: cashReceived,
      paper_bill_no: input.paperBillNo?.trim() || null,
      notes: input.notes?.trim() || null,
      subtotal,
      total_amount: total,
      confirmed_at: new Date().toISOString(),
    }).eq("id", input.billId);

    // Update outstanding tracker (deduct collected amount)
    if (input.outstandingCollected > 0) {
      const { data: out } = await admin.from("customer_outstanding")
        .select("amount").eq("customer_id", bill.customer_id).maybeSingle();
      if (out) {
        await admin.from("customer_outstanding").update({
          amount: Math.max(0, Number(out.amount) - input.outstandingCollected),
        }).eq("customer_id", bill.customer_id);
      }
    }

    void actor;
    revalidatePath(`/van/${bill.trip_id}`);
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// CREATE SPOT BILL
// =============================================================================
export interface CreateSpotBillInput {
  tripId: string;
  customerId: string;
  paymentMode: "cash" | "credit";
  outstandingCollected: number;
  paperBillNo?: string;
  notes?: string;
  items: { productId: string; qty: number; rate: number }[];
}

export async function createSpotBill(input: CreateSpotBillInput) {
  try {
    const actor = await requireRoles(VAN_ROLES);
    const admin = createAdminClient();

    const { data: trip } = await admin.from("van_trips").select("status").eq("id", input.tripId).single();
    if (!trip) return { error: "Trip not found" };
    if (trip.status !== "in_progress") return { error: `Trip is "${trip.status}"` };

    if (!input.items.length) return { error: "Add at least one item" };
    for (const it of input.items) {
      if (it.qty <= 0 || it.rate < 0) return { error: "Invalid qty or rate" };
    }

    // Verify products exist + master only
    const productIds = input.items.map(i => i.productId);
    const { data: prods } = await admin.from("products")
      .select("id, name").in("id", productIds);
    if ((prods?.length ?? 0) !== productIds.length) return { error: "Some products not found in master" };

    const { data: bn } = await admin.rpc("next_trip_bill_number", { p_trip_id: input.tripId });
    const billNumber = bn as unknown as string;

    const subtotal = input.items.reduce((s, i) => s + i.qty * i.rate, 0);
    const total = subtotal;
    const cashReceived = input.paymentMode === "cash" ? total : 0;

    const { data: bill, error: bErr } = await admin.from("trip_bills").insert({
      trip_id: input.tripId,
      bill_number: billNumber,
      bill_type: "spot",
      customer_id: input.customerId,
      payment_mode: input.paymentMode,
      subtotal, total_amount: total,
      outstanding_collected: input.outstandingCollected,
      cash_received: cashReceived,
      paper_bill_no: input.paperBillNo?.trim() || null,
      notes: input.notes?.trim() || null,
      confirmed_at: new Date().toISOString(),
      created_by: actor.userId,
    }).select("id, bill_number").single();
    if (bErr || !bill) return { error: bErr?.message ?? "Failed to create bill" };

    await admin.from("trip_bill_items").insert(
      input.items.map(it => ({
        bill_id: bill.id,
        product_id: it.productId,
        qty: it.qty,
        rate: it.rate,
        amount: it.qty * it.rate,
      })),
    );

    if (input.outstandingCollected > 0) {
      const { data: out } = await admin.from("customer_outstanding")
        .select("amount").eq("customer_id", input.customerId).maybeSingle();
      if (out) {
        await admin.from("customer_outstanding").update({
          amount: Math.max(0, Number(out.amount) - input.outstandingCollected),
        }).eq("customer_id", input.customerId);
      }
    }

    revalidatePath(`/van/${input.tripId}`);
    return { ok: true, billId: bill.id, billNumber: bill.bill_number };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// CANCEL BILL
// =============================================================================
export async function cancelBill(billId: string, reason: string) {
  try {
    if (!reason || reason.trim().length < 3) return { error: "Reason required" };
    const actor = await requireRoles(VAN_ROLES);
    const admin = createAdminClient();

    const { data: bill } = await admin.from("trip_bills").select("trip_id, is_cancelled").eq("id", billId).single();
    if (!bill) return { error: "Bill not found" };
    if (bill.is_cancelled) return { error: "Already cancelled" };

    await admin.from("trip_bills").update({
      is_cancelled: true,
      notes: `[CANCELLED by ${actor.fullName}] ${reason.trim()}`,
    }).eq("id", billId);

    revalidatePath(`/van/${bill.trip_id}`);
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// QUICK CUSTOMER CREATE (during trip, walk-in)
// =============================================================================
export async function createQuickCustomer(input: {
  name: string;
  mobile: string;
  beatId: string;
}) {
  try {
    const actor = await requireRoles(VAN_ROLES);
    const admin = createAdminClient();

    if (!input.name?.trim() || input.name.trim().length < 2) return { error: "Name required" };
    if (!input.mobile?.trim() || input.mobile.trim().length < 10) return { error: "Valid mobile required (10+ digits)" };
    const cleanMobile = input.mobile.replace(/\D/g, "");

    // Check for duplicate by mobile
    const { data: existing } = await admin.from("customers")
      .select("id, name").eq("mobile", cleanMobile).maybeSingle();
    if (existing) {
      return { ok: true, customerId: existing.id, existing: true, name: existing.name };
    }

    const { data: c, error } = await admin.from("customers").insert({
      name: input.name.trim(),
      mobile: cleanMobile,
      beat_id: input.beatId,
      customer_type: "RETAILER",
      active: true,
    }).select("id").single();
    if (error || !c) return { error: error?.message ?? "Failed to create customer" };

    void actor;
    return { ok: true, customerId: c.id, existing: false };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
