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
    }

    revalidatePath("/trips");
    return { ok: true, tripId: trip.id, tripNumber: trip.trip_number };
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

    // Cascade-cancel any non-cancelled bills so their source orders unlock
    await admin.from("trip_bills").update({
      is_cancelled: true,
    }).eq("trip_id", tripId).eq("is_cancelled", false);

    revalidatePath(`/trips/${tripId}`);
    revalidatePath("/trips");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
