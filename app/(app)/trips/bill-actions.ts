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
// HELPER: compute remaining stock per product on a trip.
// Optionally exclude one bill's items (for editing a bill — we want to know
// stock as if this bill weren't yet committed).
// Returns a map: productId → { loaded, sold, remaining, productName }
// Products not loaded on the trip will not appear in the map.
// =============================================================================
async function computeRemainingStock(tripId: string, excludeBillId?: string): Promise<Map<string, { loaded: number; sold: number; remaining: number; productName: string }>> {
  const admin = createAdminClient();

  const [{ data: loadItems }, { data: bills }] = await Promise.all([
    admin.from("trip_load_items")
      .select("product_id, qty_loaded, qty_planned, product:products(name)")
      .eq("trip_id", tripId),
    admin.from("trip_bills")
      .select("id, is_cancelled, items:trip_bill_items(product_id, qty)")
      .eq("trip_id", tripId)
      .eq("is_cancelled", false),
  ]);

  const result = new Map<string, { loaded: number; sold: number; remaining: number; productName: string }>();
  for (const li of (loadItems ?? []) as Array<{
    product_id: string; qty_loaded: number | null; qty_planned: number;
    product: { name: string } | { name: string }[] | null;
  }>) {
    const loaded = Number(li.qty_loaded ?? li.qty_planned);
    const prod = Array.isArray(li.product) ? li.product[0] : li.product;
    result.set(li.product_id, {
      loaded,
      sold: 0,
      remaining: loaded,
      productName: prod?.name ?? "product",
    });
  }
  for (const bill of (bills ?? []) as Array<{
    id: string; is_cancelled: boolean; items: Array<{ product_id: string; qty: number }>;
  }>) {
    if (excludeBillId && bill.id === excludeBillId) continue;
    for (const it of bill.items ?? []) {
      const cur = result.get(it.product_id);
      if (cur) {
        cur.sold += Number(it.qty);
        cur.remaining = cur.loaded - cur.sold;
      }
    }
  }
  return result;
}

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

    // Stock guard — only matters if the user is editing the bill (adds or qty increases).
    // Compute the FINAL state of items per product after this edit, then compare to
    // remaining stock as if this bill weren't yet committed.
    if ((input.itemEdits?.length ?? 0) > 0 || (input.itemAdditions?.length ?? 0) > 0 || (input.itemRemovals?.length ?? 0) > 0) {
      const { data: currentItems } = await admin.from("trip_bill_items")
        .select("id, product_id, qty").eq("bill_id", input.billId);
      const finalQty = new Map<string, number>();
      for (const it of (currentItems ?? []) as Array<{ id: string; product_id: string; qty: number }>) {
        if (input.itemRemovals?.includes(it.id)) continue;
        const edit = input.itemEdits?.find(e => e.itemId === it.id);
        const q = edit ? edit.qty : Number(it.qty);
        finalQty.set(it.product_id, (finalQty.get(it.product_id) ?? 0) + q);
      }
      for (const a of input.itemAdditions ?? []) {
        if (a.qty <= 0) return { error: "Qty must be > 0" };
        finalQty.set(a.productId, (finalQty.get(a.productId) ?? 0) + a.qty);
      }

      const remaining = await computeRemainingStock(bill.trip_id, input.billId);
      for (const [pid, qty] of finalQty.entries()) {
        const stock = remaining.get(pid);
        if (!stock) {
          // Product wasn't loaded — only matters if user added it via additions
          const { data: p } = await admin.from("products").select("name").eq("id", pid).single();
          return { error: `${p?.name ?? "Product"} is not loaded on this trip` };
        }
        if (qty > stock.remaining + 0.0001) {
          return { error: `Not enough ${stock.productName} on truck — only ${stock.remaining.toFixed(0)} available, you need ${qty.toFixed(0)}` };
        }
      }
    }

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

    // Stock guard — sum qty per product, reject if any exceeds remaining on truck
    const remaining = await computeRemainingStock(input.tripId);
    const totalByProduct = new Map<string, number>();
    for (const it of input.items) {
      totalByProduct.set(it.productId, (totalByProduct.get(it.productId) ?? 0) + it.qty);
    }
    for (const [pid, qty] of totalByProduct.entries()) {
      const stock = remaining.get(pid);
      const prodName = stock?.productName ?? prods?.find(p => p.id === pid)?.name ?? "product";
      if (!stock) return { error: `${prodName} is not loaded on this trip` };
      if (qty > stock.remaining + 0.0001) {
        return { error: `Not enough ${prodName} on truck — only ${stock.remaining.toFixed(0)} available, you need ${qty.toFixed(0)}` };
      }
    }

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
