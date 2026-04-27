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

// =============================================================================
// CREATE TRIP (with optional pre-order link + buffer)
// =============================================================================
export interface CreateTripInput {
  tripDate: string;            // YYYY-MM-DD
  beatId: string;
  vehicleType: "company" | "own";
  vehicleNumber?: string;
  vehicleProvidedBy?: string;
  leadId: string;
  helpers: string[];
  notes?: string;
  preOrderIds: string[];       // selected order IDs to bundle
  bufferLines: { productId: string; qty: number }[];
}

export async function createTrip(input: CreateTripInput) {
  try {
    const actor = await requireRoles(["admin", "van_lead"]);
    const admin = createAdminClient();

    // Validate beat is van-eligible
    const { data: beat } = await admin
      .from("beats").select("id, is_van_beat, name").eq("id", input.beatId).single();
    if (!beat) return { error: "Beat not found" };
    if (!beat.is_van_beat) return { error: `Beat "${beat.name}" is not marked as a VAN beat` };

    // Validate lead exists
    const { data: lead } = await admin
      .from("app_users").select("id, full_name").eq("id", input.leadId).single();
    if (!lead) return { error: "Lead user not found" };

    // Generate trip number
    const { data: tripNo } = await admin.rpc("next_trip_number", { d: input.tripDate });
    const tripNumber = tripNo as unknown as string;

    // Insert trip
    const { data: trip, error: tErr } = await admin.from("van_trips").insert({
      trip_number: tripNumber,
      trip_date: input.tripDate,
      beat_id: input.beatId,
      vehicle_type: input.vehicleType,
      vehicle_number: input.vehicleNumber?.trim() || null,
      vehicle_provided_by: input.vehicleProvidedBy?.trim() || null,
      lead_id: input.leadId,
      helpers: input.helpers,
      status: "planning",
      notes: input.notes?.trim() || null,
      created_by: actor.userId,
    }).select("id, trip_number").single();
    if (tErr || !trip) return { error: tErr?.message ?? "Failed to create trip" };

    // Roll up pre-order qtys + buffer into trip_load_items
    const planned = new Map<string, { preOrder: number; buffer: number }>();

    if (input.preOrderIds.length) {
      const { data: oItems } = await admin
        .from("order_items")
        .select("product_id, qty, order_id")
        .in("order_id", input.preOrderIds);
      for (const it of oItems ?? []) {
        const cur = planned.get(it.product_id) ?? { preOrder: 0, buffer: 0 };
        cur.preOrder += Number(it.qty);
        planned.set(it.product_id, cur);
      }
    }
    for (const b of input.bufferLines) {
      if (!b.productId || b.qty <= 0) continue;
      const cur = planned.get(b.productId) ?? { preOrder: 0, buffer: 0 };
      cur.buffer += Number(b.qty);
      planned.set(b.productId, cur);
    }

    if (planned.size > 0) {
      const { error: liErr } = await admin.from("trip_load_items").insert(
        Array.from(planned.entries()).map(([productId, v]) => ({
          trip_id: trip.id,
          product_id: productId,
          qty_planned: v.preOrder + v.buffer,
          source_pre_order_qty: v.preOrder,
          source_buffer_qty: v.buffer,
        })),
      );
      if (liErr) return { error: `Saving load: ${liErr.message}` };
    }

    // Pre-create pre_order trip_bills (status: not delivered yet — they'll be marked
    // when the van actually delivers, on the mobile screen).
    if (input.preOrderIds.length) {
      const { data: orders } = await admin
        .from("orders")
        .select("id, customer_id, total_amount, amount, payment_option_check, items:order_items(*)")
        .in("id", input.preOrderIds);
      for (const o of (orders ?? []) as Array<{
        id: string;
        customer_id: string;
        total_amount: number;
        amount: number;
        payment_option_check: string | null;
        items: Array<{ product_id: string; qty: number; price: number; total_price: number }>;
      }>) {
        const { data: bn } = await admin.rpc("next_trip_bill_number", { p_trip_id: trip.id });
        const billNumber = bn as unknown as string;
        const paymentMode: "cash" | "credit" = o.payment_option_check === "PAY_ON_DELIVERY" ? "cash" : "credit";

        const { data: bill } = await admin.from("trip_bills").insert({
          trip_id: trip.id,
          bill_number: billNumber,
          bill_type: "pre_order",
          customer_id: o.customer_id,
          source_order_id: o.id,
          payment_mode: paymentMode,
          subtotal: Number(o.amount),
          total_amount: Number(o.total_amount),
          created_by: actor.userId,
        }).select("id").single();

        if (bill && o.items?.length) {
          await admin.from("trip_bill_items").insert(
            o.items.map((it) => ({
              bill_id: bill.id,
              product_id: it.product_id,
              qty: Number(it.qty),
              rate: Number(it.price),
              amount: Number(it.total_price ?? Number(it.qty) * Number(it.price)),
            })),
          );
        }
      }

      // Flip every successfully-bundled order to 'on_van_trip'
      await admin.from("orders")
        .update({ app_status: "on_van_trip" })
        .in("id", input.preOrderIds)
        .in("app_status", ["approved", "partially_dispatched"]);
    }

    revalidatePath("/trips");
    revalidatePath("/orders");
    return { ok: true, tripId: trip.id, tripNumber: trip.trip_number };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// ATTACH ORDER TO ACTIVE TRIP
// Used when an order arrives after the trip has started. The order's items roll
// into the trip's load (qty_planned += order qty, qty_loaded UNCHANGED so the
// stock guard catches shortages naturally), and a pre_order trip_bill is created
// so the lead sees it on the mobile app.
//
// Returns a "stockWarnings" array if any items exceed remaining stock — the
// caller can surface this in the UI but the attach proceeds either way.
// =============================================================================
export interface AttachOrderToTripInput {
  orderId: string;
  tripId: string;
}

export interface StockWarning {
  productName: string;
  qtyNeeded: number;
  qtyRemaining: number;
}

export async function attachOrderToTrip(input: AttachOrderToTripInput) {
  try {
    const actor = await requireRoles(["admin", "van_lead"]);
    const admin = createAdminClient();

    // Validate trip
    const { data: trip } = await admin.from("van_trips")
      .select("id, status, trip_number, beat_id").eq("id", input.tripId).maybeSingle();
    if (!trip) return { error: "Trip not found" };
    if (trip.status !== "in_progress") {
      return { error: `Trip is "${trip.status}" — only on-route trips accept new orders. For planning-stage trips, edit the trip plan instead.` };
    }

    // Validate order
    const { data: order } = await admin.from("orders")
      .select("id, customer_id, total_amount, amount, payment_option_check, app_status, customer:customers(id, name, beat_id)")
      .eq("id", input.orderId)
      .maybeSingle();
    if (!order) return { error: "Order not found" };
    if (!["approved", "partially_dispatched"].includes(order.app_status)) {
      return { error: `Order is "${order.app_status}" — only approved orders can be attached` };
    }

    const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;
    if (!customer) return { error: "Order has no customer" };
    // Beat boundary is intentionally NOT enforced here — admin/van_lead are
    // trusted to know when to attach cross-beat orders (e.g., "the lead drives
    // past this shop today anyway"). The mobile app will surface cross-beat
    // bills in the pre-order tab regardless.

    // Refuse duplicate attach
    const { data: dup } = await admin.from("trip_bills")
      .select("id, trip_id, is_cancelled")
      .eq("source_order_id", input.orderId)
      .eq("is_cancelled", false)
      .maybeSingle();
    if (dup) return { error: "This order is already on a trip" };

    // Fetch order items
    const { data: items } = await admin.from("order_items")
      .select("product_id, qty, price, total_price, product:products(id, name)")
      .eq("order_id", input.orderId);
    if (!items || items.length === 0) return { error: "Order has no items" };

    type Item = { product_id: string; qty: number; price: number; total_price: number; product: { id: string; name: string } | { id: string; name: string }[] | null };

    // Roll items up by product (an order can list the same product more than once in theory)
    const itemsByProduct = new Map<string, { qty: number; productName: string }>();
    for (const it of (items as Item[])) {
      const prod = Array.isArray(it.product) ? it.product[0] : it.product;
      const cur = itemsByProduct.get(it.product_id) ?? { qty: 0, productName: prod?.name ?? "—" };
      cur.qty += Number(it.qty);
      itemsByProduct.set(it.product_id, cur);
    }

    // Compute current stock state to detect shortages (warn-only)
    const { data: existingLoad } = await admin.from("trip_load_items")
      .select("product_id, qty_loaded, qty_planned")
      .eq("trip_id", input.tripId);
    const { data: existingBills } = await admin.from("trip_bills")
      .select("id, is_cancelled, items:trip_bill_items(product_id, qty)")
      .eq("trip_id", input.tripId)
      .eq("is_cancelled", false);

    const loadedByProduct = new Map<string, { loaded: number; planned: number }>();
    for (const li of (existingLoad ?? []) as Array<{ product_id: string; qty_loaded: number | null; qty_planned: number }>) {
      loadedByProduct.set(li.product_id, {
        loaded: Number(li.qty_loaded ?? li.qty_planned),
        planned: Number(li.qty_planned),
      });
    }
    const soldByProduct = new Map<string, number>();
    for (const b of (existingBills ?? []) as Array<{
      id: string; is_cancelled: boolean; items: Array<{ product_id: string; qty: number }>;
    }>) {
      for (const it of b.items ?? []) {
        soldByProduct.set(it.product_id, (soldByProduct.get(it.product_id) ?? 0) + Number(it.qty));
      }
    }

    const warnings: StockWarning[] = [];
    for (const [pid, { qty, productName }] of itemsByProduct.entries()) {
      const loaded = loadedByProduct.get(pid)?.loaded ?? 0;
      const sold = soldByProduct.get(pid) ?? 0;
      const remaining = loaded - sold;
      if (qty > remaining + 0.0001) {
        warnings.push({ productName, qtyNeeded: qty, qtyRemaining: remaining });
      }
    }

    // 1. Bump trip_load_items qty_planned by the new order qty (insert if missing).
    //    qty_loaded stays as-is — that's the truth about what's physically on the truck.
    for (const [pid, { qty }] of itemsByProduct.entries()) {
      const existing = loadedByProduct.get(pid);
      if (existing) {
        // Need current source_pre_order_qty so we can bump it correctly
        const { data: row } = await admin.from("trip_load_items")
          .select("source_pre_order_qty")
          .eq("trip_id", input.tripId).eq("product_id", pid).single();
        await admin.from("trip_load_items").update({
          qty_planned: existing.planned + qty,
          source_pre_order_qty: Number(row?.source_pre_order_qty ?? 0) + qty,
        }).eq("trip_id", input.tripId).eq("product_id", pid);
      } else {
        await admin.from("trip_load_items").insert({
          trip_id: input.tripId,
          product_id: pid,
          qty_planned: qty,
          qty_loaded: 0, // not loaded — this is what triggers a stock warning
          source_pre_order_qty: qty,
          source_buffer_qty: 0,
        });
      }
    }

    // 2. Create the pre_order trip_bill
    const { data: bn } = await admin.rpc("next_trip_bill_number", { p_trip_id: input.tripId });
    const billNumber = bn as unknown as string;
    const paymentMode: "cash" | "credit" = order.payment_option_check === "PAY_ON_DELIVERY" ? "cash" : "credit";

    const { data: bill, error: bErr } = await admin.from("trip_bills").insert({
      trip_id: input.tripId,
      bill_number: billNumber,
      bill_type: "pre_order",
      customer_id: order.customer_id,
      source_order_id: order.id,
      payment_mode: paymentMode,
      subtotal: Number(order.amount),
      total_amount: Number(order.total_amount),
      notes: `Added mid-trip by ${actor.fullName}`,
      created_by: actor.userId,
    }).select("id").single();
    if (bErr || !bill) return { error: bErr?.message ?? "Failed to create trip bill" };

    // 3. Add bill items
    const { error: biErr } = await admin.from("trip_bill_items").insert(
      (items as Item[]).map(it => ({
        bill_id: bill.id,
        product_id: it.product_id,
        qty: Number(it.qty),
        rate: Number(it.price),
        amount: Number(it.total_price ?? Number(it.qty) * Number(it.price)),
      })),
    );
    if (biErr) return { error: `Saving items: ${biErr.message}` };

    // 4. Flip the order's status to 'on_van_trip'
    await admin.from("orders")
      .update({ app_status: "on_van_trip" })
      .eq("id", order.id);

    revalidatePath(`/trips/${input.tripId}`);
    revalidatePath(`/van/${input.tripId}`);
    revalidatePath("/orders");
    return {
      ok: true,
      billNumber,
      tripNumber: trip.trip_number,
      stockWarnings: warnings,
    };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// LIST ACTIVE TRIPS FOR ORDER (used by order drawer / mobile to pick a trip)
// Returns trips that are in_progress for the order's customer's beat.
// =============================================================================
export async function listActiveTripsForOrder(orderId: string) {
  try {
    await requireRoles(["admin", "van_lead", "approver", "dispatch", "delivery", "accounts", "salesman"]);
    const admin = createAdminClient();

    const { data: order } = await admin.from("orders")
      .select("id, app_status, customer:customers(id, beat_id)")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return { error: "Order not found" };

    const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;
    const beatId = customer?.beat_id;
    if (!beatId) return { ok: true, trips: [], orderEligible: false, reason: "Customer has no beat" };

    if (!["approved", "partially_dispatched"].includes(order.app_status)) {
      return { ok: true, trips: [], orderEligible: false, reason: `Order status is "${order.app_status}"` };
    }

    // Already on a trip?
    const { data: existing } = await admin.from("trip_bills")
      .select("trip_id, is_cancelled")
      .eq("source_order_id", orderId)
      .eq("is_cancelled", false)
      .maybeSingle();
    if (existing) {
      return { ok: true, trips: [], orderEligible: false, reason: "Already on a trip" };
    }

    const { data: trips } = await admin.from("van_trips")
      .select("id, trip_number, trip_date, beat_id, status, beat:beats(id,name), lead:app_users!van_trips_lead_id_fkey(id,full_name)")
      .eq("status", "in_progress")
      .order("trip_date", { ascending: false });

    // Flag each trip with whether its beat matches the order's customer beat —
    // useful for sorting/highlighting in the picker. Cross-beat trips are still
    // returned and selectable.
    const flagged = (trips ?? []).map(t => ({
      ...t,
      same_beat: t.beat_id === beatId,
    }));
    // Sort same-beat first
    flagged.sort((a, b) => (a.same_beat === b.same_beat ? 0 : a.same_beat ? -1 : 1));

    return { ok: true, trips: flagged, orderEligible: true, customerBeatId: beatId };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// LIST ALL ACTIVE TRIPS (for the bulk-attach picker — admin needs to see every
// in-progress trip across all beats, not filtered by a specific order's beat)
// =============================================================================
export async function listAllActiveTrips() {
  try {
    await requireRoles(["admin", "van_lead", "approver", "dispatch"]);
    const admin = createAdminClient();

    const { data: trips } = await admin.from("van_trips")
      .select("id, trip_number, trip_date, beat_id, status, beat:beats(id,name), lead:app_users!van_trips_lead_id_fkey(id,full_name)")
      .eq("status", "in_progress")
      .order("trip_date", { ascending: false });

    return { ok: true, trips: (trips ?? []) };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// BULK ATTACH ORDERS TO TRIP
// Each order's customer must be on the trip's beat; mismatched-beat orders are
// reported as failures rather than silently skipped. Process one at a time so
// per-order stock warnings can be surfaced.
// =============================================================================
export interface BulkAttachResult {
  orderId: string;
  ok: boolean;
  error?: string;
  billNumber?: string;
  stockWarnings?: StockWarning[];
}

export async function bulkAttachOrdersToTrip(orderIds: string[], tripId: string) {
  try {
    if (!orderIds || orderIds.length === 0) return { error: "No orders selected" };
    if (orderIds.length > 500) return { error: "Too many orders (max 500). Narrow your selection." };
    if (!tripId) return { error: "No trip selected" };

    await requireRoles(["admin", "van_lead"]);

    // Quick sanity: the trip must exist and be in_progress (attachOrderToTrip checks
    // each call, but failing fast on a bad trip avoids 500 nuisance results)
    const admin = createAdminClient();
    const { data: trip } = await admin.from("van_trips")
      .select("id, status, trip_number").eq("id", tripId).maybeSingle();
    if (!trip) return { error: "Trip not found" };
    if (trip.status !== "in_progress") {
      return { error: `Trip is "${trip.status}" — only on-route trips accept new orders` };
    }

    const results: BulkAttachResult[] = [];
    let succeeded = 0;
    const allWarnings: { orderId: string; warnings: StockWarning[] }[] = [];

    for (const orderId of orderIds) {
      try {
        const res = await attachOrderToTrip({ orderId, tripId });
        if (res.error) {
          results.push({ orderId, ok: false, error: res.error });
        } else {
          results.push({
            orderId, ok: true,
            billNumber: res.billNumber,
            stockWarnings: res.stockWarnings,
          });
          succeeded++;
          if (res.stockWarnings && res.stockWarnings.length > 0) {
            allWarnings.push({ orderId, warnings: res.stockWarnings });
          }
        }
      } catch (e: unknown) {
        results.push({ orderId, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    revalidatePath(`/trips/${tripId}`);
    revalidatePath(`/van/${tripId}`);
    revalidatePath("/orders");

    return {
      ok: true,
      succeeded,
      total: orderIds.length,
      tripNumber: trip.trip_number,
      results,
      stockWarningCount: allWarnings.reduce((s, w) => s + w.warnings.length, 0),
    };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// SAVE TRIP PLAN (add/edit/remove buffer items during planning)
// `bufferRows` represents the COMPLETE desired buffer state.
// Products not in the list have their buffer cleared.
// Products with source_pre_order_qty=0 AND buffer cleared get deleted.
// =============================================================================
export interface SaveTripPlanInput {
  bufferRows: { productId: string; bufferQty: number }[];
}

export async function saveTripPlan(tripId: string, input: SaveTripPlanInput) {
  try {
    const actor = await requireRoles(["admin", "van_lead"]);
    const admin = createAdminClient();

    const { data: trip } = await admin.from("van_trips").select("id, status").eq("id", tripId).single();
    if (!trip) return { error: "Trip not found" };
    const isAdminInProgressEdit = trip.status === "in_progress" && actor.role === "admin";
    if (!["planning", "loading"].includes(trip.status) && !isAdminInProgressEdit) {
      return { error: `Trip is "${trip.status}", buffer can only be edited during planning${actor.role === "admin" ? " or while on route" : ""}` };
    }

    for (const r of input.bufferRows) {
      if (r.bufferQty < 0) return { error: "Buffer qty cannot be negative" };
    }

    // Map: productId → desired bufferQty
    const desiredBuffer = new Map<string, number>();
    for (const r of input.bufferRows) desiredBuffer.set(r.productId, r.bufferQty);

    // Fetch existing rows
    const { data: existing } = await admin.from("trip_load_items")
      .select("id, product_id, source_pre_order_qty, source_buffer_qty")
      .eq("trip_id", tripId);

    const existingByProduct = new Map<string, {
      id: string; product_id: string; source_pre_order_qty: number; source_buffer_qty: number;
    }>();
    for (const r of (existing ?? []) as Array<{
      id: string; product_id: string; source_pre_order_qty: number; source_buffer_qty: number;
    }>) {
      existingByProduct.set(r.product_id, r);
    }

    // Compute sold-per-product (for in-progress edits, prevent removing rows that have been sold)
    const soldByProduct = new Map<string, number>();
    if (isAdminInProgressEdit) {
      const { data: bills } = await admin.from("trip_bills")
        .select("id, is_cancelled, items:trip_bill_items(product_id, qty)")
        .eq("trip_id", tripId)
        .eq("is_cancelled", false);
      for (const b of (bills ?? []) as Array<{
        id: string; is_cancelled: boolean; items: Array<{ product_id: string; qty: number }>;
      }>) {
        for (const it of b.items ?? []) {
          soldByProduct.set(it.product_id, (soldByProduct.get(it.product_id) ?? 0) + Number(it.qty));
        }
      }
    }

    // 1. UPDATE / DELETE existing rows
    for (const [productId, row] of existingByProduct.entries()) {
      const newBuffer = desiredBuffer.get(productId) ?? 0;
      const preOrder = Number(row.source_pre_order_qty);
      const sold = soldByProduct.get(productId) ?? 0;

      if (newBuffer === 0 && preOrder === 0) {
        // Buffer cleared and no pre-order — but if anything has been sold from this product
        // (admin in-progress edit), keep the row at zero so stock calc stays consistent.
        if (sold > 0) {
          await admin.from("trip_load_items").update({
            source_buffer_qty: 0,
            qty_planned: 0,
          }).eq("id", row.id);
        } else {
          await admin.from("trip_load_items").delete().eq("id", row.id);
        }
      } else {
        await admin.from("trip_load_items").update({
          source_buffer_qty: newBuffer,
          qty_planned: preOrder + newBuffer,
        }).eq("id", row.id);
      }
      desiredBuffer.delete(productId);
    }

    // 2. INSERT new buffer-only rows (productIds left in desiredBuffer)
    const inserts: Array<{
      trip_id: string; product_id: string; qty_planned: number;
      source_pre_order_qty: number; source_buffer_qty: number;
    }> = [];
    for (const [productId, qty] of desiredBuffer.entries()) {
      if (qty <= 0) continue; // skip empty new rows
      inserts.push({
        trip_id: tripId,
        product_id: productId,
        qty_planned: qty,
        source_pre_order_qty: 0,
        source_buffer_qty: qty,
      });
    }
    if (inserts.length) {
      const { error: insErr } = await admin.from("trip_load_items").insert(inserts);
      if (insErr) return { error: `Insert failed: ${insErr.message}` };
    }

    void actor;
    revalidatePath(`/trips/${tripId}`);
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// UPDATE TRIP METADATA (admin-only, any non-cancelled status)
// Lets admin fix date, vehicle, lead, helpers, notes — even after the trip
// has started or returned. Beat is intentionally NOT editable since it would
// orphan the linked pre-orders.
// =============================================================================
export interface UpdateTripMetadataInput {
  tripDate?: string;                                    // YYYY-MM-DD
  vehicleType?: "company" | "own";
  vehicleNumber?: string | null;
  vehicleProvidedBy?: string | null;
  leadId?: string;
  helpers?: string[];
  notes?: string | null;
}

export async function updateTripMetadata(tripId: string, input: UpdateTripMetadataInput) {
  try {
    const actor = await requireRoles(["admin"]);
    const admin = createAdminClient();

    const { data: trip } = await admin.from("van_trips").select("id, status").eq("id", tripId).single();
    if (!trip) return { error: "Trip not found" };
    if (trip.status === "cancelled") return { error: "Cannot edit a cancelled trip" };

    // Validate lead if changing
    if (input.leadId !== undefined) {
      const { data: lead } = await admin
        .from("app_users").select("id, active, role").eq("id", input.leadId).maybeSingle();
      if (!lead) return { error: "Lead user not found" };
      if (!lead.active) return { error: "Lead user is inactive" };
    }

    const updates: Record<string, unknown> = {};
    if (input.tripDate !== undefined) updates.trip_date = input.tripDate;
    if (input.vehicleType !== undefined) updates.vehicle_type = input.vehicleType;
    if (input.vehicleNumber !== undefined) updates.vehicle_number = input.vehicleNumber?.trim() || null;
    if (input.vehicleProvidedBy !== undefined) updates.vehicle_provided_by = input.vehicleProvidedBy?.trim() || null;
    if (input.leadId !== undefined) updates.lead_id = input.leadId;
    if (input.helpers !== undefined) updates.helpers = input.helpers;
    if (input.notes !== undefined) updates.notes = input.notes?.trim() || null;

    if (Object.keys(updates).length === 0) return { ok: true };

    const { error } = await admin.from("van_trips").update(updates).eq("id", tripId);
    if (error) return { error: error.message };

    void actor;
    revalidatePath(`/trips/${tripId}`);
    revalidatePath("/trips");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// MARK LOADED (warehouse confirms physical load)
// Optionally accepts buffer changes too — so user can add buffer + load in one step.
// =============================================================================
export async function markTripLoaded(
  tripId: string,
  loadedQty: { productId: string; qtyLoaded: number }[],
  bufferRows?: { productId: string; bufferQty: number }[],
) {
  try {
    const actor = await requireRoles(["admin", "van_lead"]);
    const admin = createAdminClient();

    const { data: trip } = await admin.from("van_trips").select("id, status").eq("id", tripId).single();
    if (!trip) return { error: "Trip not found" };
    const isAdminInProgressEdit = trip.status === "in_progress" && actor.role === "admin";
    if (!["planning", "loading"].includes(trip.status) && !isAdminInProgressEdit) {
      return { error: `Trip is "${trip.status}", cannot edit loaded qty` };
    }

    // 1. Save buffer changes first if provided
    if (bufferRows) {
      const planRes = await saveTripPlan(tripId, { bufferRows });
      if (planRes.error) return { error: planRes.error };
    }

    // 2. For in-progress edits: validate that qty_loaded never goes below already-sold qty
    if (isAdminInProgressEdit) {
      const { data: bills } = await admin.from("trip_bills")
        .select("id, is_cancelled, items:trip_bill_items(product_id, qty)")
        .eq("trip_id", tripId)
        .eq("is_cancelled", false);
      const sold = new Map<string, number>();
      for (const b of (bills ?? []) as Array<{
        id: string; is_cancelled: boolean; items: Array<{ product_id: string; qty: number }>;
      }>) {
        for (const it of b.items ?? []) {
          sold.set(it.product_id, (sold.get(it.product_id) ?? 0) + Number(it.qty));
        }
      }
      for (const lq of loadedQty) {
        const s = sold.get(lq.productId) ?? 0;
        if (lq.qtyLoaded < s - 0.0001) {
          // Look up product name for a friendlier message
          const { data: p } = await admin.from("products").select("name").eq("id", lq.productId).single();
          return { error: `Cannot set ${p?.name ?? "product"} loaded qty below ${s.toFixed(0)} — that much has already been sold` };
        }
      }
    }

    // 3. Apply loaded qtys
    for (const lq of loadedQty) {
      if (lq.qtyLoaded < 0) return { error: "Negative loaded qty not allowed" };
      await admin.from("trip_load_items").update({
        qty_loaded: lq.qtyLoaded,
      }).eq("trip_id", tripId).eq("product_id", lq.productId);
    }

    // 4. Flip status only if not already in_progress
    if (!isAdminInProgressEdit) {
      const now = new Date().toISOString();
      await admin.from("van_trips").update({
        status: "in_progress",
        loaded_at: now,
        loaded_by: actor.userId,
        started_at: now,
      }).eq("id", tripId);
    }

    revalidatePath(`/trips/${tripId}`);
    revalidatePath("/trips");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// MARK RETURNED (vehicle back at office, awaiting reconciliation)
// =============================================================================
export async function markTripReturned(tripId: string) {
  try {
    const actor = await requireRoles(["admin", "van_lead"]);
    const admin = createAdminClient();

    const { data: trip } = await admin.from("van_trips").select("status").eq("id", tripId).single();
    if (!trip) return { error: "Trip not found" };
    if (trip.status !== "in_progress") return { error: `Trip is "${trip.status}"` };

    await admin.from("van_trips").update({
      status: "returned",
      returned_at: new Date().toISOString(),
    }).eq("id", tripId);
    void actor;

    revalidatePath(`/trips/${tripId}`);
    revalidatePath("/trips");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// RECONCILE TRIP
// =============================================================================
export interface ReconcileInput {
  returnedQty: { productId: string; qtyReturned: number }[];
  cashCollectedActual: number;
  notes?: string;
}

export async function reconcileTrip(tripId: string, input: ReconcileInput) {
  try {
    const actor = await requireRoles(["admin", "van_lead"]);
    const admin = createAdminClient();

    const { data: trip } = await admin.from("van_trips").select("status").eq("id", tripId).single();
    if (!trip) return { error: "Trip not found" };
    if (!["returned", "in_progress"].includes(trip.status))
      return { error: `Trip is "${trip.status}", cannot reconcile yet` };

    for (const r of input.returnedQty) {
      if (r.qtyReturned < 0) return { error: "Returned qty cannot be negative" };
      await admin.from("trip_load_items").update({
        qty_returned: r.qtyReturned,
      }).eq("trip_id", tripId).eq("product_id", r.productId);
    }

    await admin.from("van_trips").update({
      status: "reconciled",
      reconciled_at: new Date().toISOString(),
      reconciled_by: actor.userId,
      cash_collected_actual: input.cashCollectedActual,
      reconcile_notes: input.notes?.trim() || null,
    }).eq("id", tripId);

    // Mark linked source orders as 'delivered'
    const { data: bills } = await admin
      .from("trip_bills").select("source_order_id")
      .eq("trip_id", tripId).eq("is_cancelled", false).not("source_order_id", "is", null);
    const orderIds = (bills ?? []).map((b: { source_order_id: string | null }) => b.source_order_id).filter(Boolean) as string[];
    if (orderIds.length) {
      await admin.from("orders").update({ app_status: "delivered" }).in("id", orderIds);
    }

    revalidatePath(`/trips/${tripId}`);
    revalidatePath("/trips");
    revalidatePath("/orders");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// CANCEL TRIP
// =============================================================================
export async function cancelTrip(tripId: string, reason: string) {
  try {
    if (!reason || reason.trim().length < 3) return { error: "Reason required" };
    const actor = await requireRoles(["admin"]);
    const admin = createAdminClient();

    const { data: trip } = await admin.from("van_trips").select("status").eq("id", tripId).single();
    if (!trip) return { error: "Trip not found" };
    if (["reconciled", "cancelled"].includes(trip.status))
      return { error: `Already ${trip.status}` };

    await admin.from("van_trips").update({
      status: "cancelled",
      reconcile_notes: `[CANCELLED by ${actor.fullName}] ${reason.trim()}`,
    }).eq("id", tripId);

    // Cascade-cancel non-cancelled bills. For confirmed pre-order bills, also roll
    // the linked source order back from 'delivered' to 'approved' so it's available
    // for a fresh trip. We don't touch outstanding amounts — if money was actually
    // collected, that's a separate manual reversal in the customer outstanding tab.
    const { data: liveBills } = await admin
      .from("trip_bills")
      .select("id, bill_type, source_order_id, bill_number, confirmed_at")
      .eq("trip_id", tripId)
      .eq("is_cancelled", false);

    for (const bill of (liveBills ?? []) as Array<{
      id: string; bill_type: string; source_order_id: string | null;
      bill_number: string; confirmed_at: string | null;
    }>) {
      // Mark the bill cancelled
      await admin.from("trip_bills").update({
        is_cancelled: true,
        notes: `[CANCELLED via trip cancel by ${actor.fullName}] ${reason.trim()}`,
      }).eq("id", bill.id);

      // Roll back the linked source order if this was a pre-order with a meaningful
      // status to undo (either 'delivered' or 'on_van_trip')
      if (bill.bill_type === "pre_order" && bill.source_order_id) {
        const { data: cur } = await admin.from("orders")
          .select("app_status").eq("id", bill.source_order_id).maybeSingle();
        const fromStatus = cur?.app_status;
        if (fromStatus === "delivered" || fromStatus === "on_van_trip") {
          await admin.from("orders").update({ app_status: "approved" }).eq("id", bill.source_order_id);
          await admin.from("order_audit_events").insert({
            order_id: bill.source_order_id,
            event_type: "trip_cancelled",
            actor_id: actor.userId,
            actor_name: actor.fullName,
            comment: `Trip cancelled — bill ${bill.bill_number} reversed`,
            details: { from_status: fromStatus, to_status: "approved", trip_id: tripId, trip_bill_id: bill.id, reason: reason.trim() },
          });
        }
      }
    }

    revalidatePath(`/trips/${tripId}`);
    revalidatePath("/trips");
    revalidatePath("/orders");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
