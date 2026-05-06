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

async function logEvent(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
  eventType: string,
  actor: ActorInfo,
  comment?: string,
  details?: Record<string, unknown>,
) {
  await admin.from("order_audit_events").insert({
    order_id: orderId,
    event_type: eventType,
    actor_id: actor.userId,
    actor_name: actor.fullName,
    comment: comment ?? null,
    details: details ?? null,
  });
}

async function recomputeOrderStatus(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
) {
  // Sum dispatched (shipped or delivered) and delivered qty per line
  const { data: items } = await admin.from("order_items").select("id, qty").eq("order_id", orderId);
  if (!items?.length) return;

  const itemIds = items.map(i => i.id);
  const { data: dispatchItems } = await admin
    .from("dispatch_items")
    .select("order_item_id, qty, dispatch:dispatches(status)")
    .in("order_item_id", itemIds);

  let allShippedOrMore = true;
  let allDelivered = true;
  for (const it of items) {
    const totalShipped = (dispatchItems ?? [])
      .filter((di: { order_item_id: string; qty: number; dispatch: { status: string } | { status: string }[] | null }) => {
        const status = Array.isArray(di.dispatch) ? di.dispatch[0]?.status : di.dispatch?.status;
        return di.order_item_id === it.id && (status === "shipped" || status === "delivered");
      })
      .reduce((s, di) => s + Number(di.qty), 0);

    const totalDelivered = (dispatchItems ?? [])
      .filter((di: { order_item_id: string; qty: number; dispatch: { status: string } | { status: string }[] | null }) => {
        const status = Array.isArray(di.dispatch) ? di.dispatch[0]?.status : di.dispatch?.status;
        return di.order_item_id === it.id && status === "delivered";
      })
      .reduce((s, di) => s + Number(di.qty), 0);

    if (totalShipped < Number(it.qty)) allShippedOrMore = false;
    if (totalDelivered < Number(it.qty)) allDelivered = false;
  }

  let newStatus: string;
  if (allDelivered) newStatus = "delivered";
  else if (allShippedOrMore) newStatus = "dispatched";
  else {
    // Check if anything is shipped at all → partially_dispatched
    const anyShipped = (dispatchItems ?? []).some((di: { dispatch: { status: string } | { status: string }[] | null }) => {
      const status = Array.isArray(di.dispatch) ? di.dispatch[0]?.status : di.dispatch?.status;
      return status === "shipped" || status === "delivered";
    });
    if (anyShipped) {
      newStatus = "partially_dispatched";
    } else {
      // Nothing shipped, but is anything currently pending (= being loaded)?
      const anyPending = (dispatchItems ?? []).some((di: { dispatch: { status: string } | { status: string }[] | null }) => {
        const status = Array.isArray(di.dispatch) ? di.dispatch[0]?.status : di.dispatch?.status;
        return status === "pending";
      });
      newStatus = anyPending ? "loading" : "approved";
    }
  }

  await admin.from("orders").update({ app_status: newStatus }).eq("id", orderId);
}

// =============================================================================
// CREATE DISPATCH
// =============================================================================
export async function createDispatch(
  orderId: string,
  items: { orderItemId: string; qty: number }[],
  meta: {
    vehicleNumber?: string;
    driverName?: string;
    driverPhone?: string;
    notes?: string;
  } = {},
) {
  try {
    const actor = await requireRoles(["admin", "dispatch", "approver"]);
    const admin = createAdminClient();

    const { data: order } = await admin.from("orders").select("id, app_status").eq("id", orderId).single();
    if (!order) return { error: "Order not found" };
    if (!["approved", "partially_dispatched"].includes(order.app_status))
      return { error: `Cannot dispatch — order is "${order.app_status}"` };

    if (!items.length) return { error: "No items selected for dispatch" };

    // Validate available qty per line
    const itemIds = items.map(i => i.orderItemId);
    const { data: orderItems } = await admin
      .from("order_items")
      .select("id, qty, price, product_name")
      .in("id", itemIds);
    if (!orderItems) return { error: "Could not load order items" };

    // Sum already-shipped/delivered qty per line
    const { data: existingDi } = await admin
      .from("dispatch_items")
      .select("order_item_id, qty, dispatch:dispatches!inner(status)")
      .in("order_item_id", itemIds);

    const dispatchedSoFar = new Map<string, number>();
    for (const di of existingDi ?? []) {
      const status = Array.isArray(di.dispatch) ? di.dispatch[0]?.status : (di.dispatch as { status: string } | null)?.status;
      if (status === "shipped" || status === "delivered" || status === "pending") {
        dispatchedSoFar.set(di.order_item_id, (dispatchedSoFar.get(di.order_item_id) ?? 0) + Number(di.qty));
      }
    }

    const itemMap = new Map(orderItems.map((it: { id: string; qty: number; price: number; product_name: string }) => [it.id, it]));
    const dispatchItemsToInsert = [];
    let totalQty = 0;
    let totalAmount = 0;

    for (const req of items) {
      const it = itemMap.get(req.orderItemId);
      if (!it) return { error: `Order item ${req.orderItemId} not found` };
      if (req.qty <= 0) return { error: `Invalid qty for ${it.product_name}` };
      const already = dispatchedSoFar.get(req.orderItemId) ?? 0;
      const remaining = Number(it.qty) - already;
      if (req.qty > remaining)
        return { error: `${it.product_name}: requested ${req.qty} but only ${remaining} available` };

      const lineTotal = Number(it.price) * req.qty;
      dispatchItemsToInsert.push({
        order_item_id: req.orderItemId,
        qty: req.qty,
        price: Number(it.price),
        total_amount: lineTotal,
      });
      totalQty += req.qty;
      totalAmount += lineTotal;
    }

    // Generate dispatch number
    const { data: numRow } = await admin.rpc("next_dispatch_number");
    const dispatchNumber = numRow as unknown as string;

    // Insert dispatch — always 'pending' (= loading on truck). The dispatcher
    // will tap "Mark dispatched (truck left)" later to advance to 'shipped'.
    const { data: dispatch, error: dErr } = await admin.from("dispatches").insert({
      order_id: orderId,
      dispatch_number: dispatchNumber,
      status: "pending",
      vehicle_number: meta.vehicleNumber || null,
      driver_name: meta.driverName || null,
      driver_phone: meta.driverPhone || null,
      notes: meta.notes || null,
      total_qty: totalQty,
      total_amount: totalAmount,
      created_by: actor.userId,
    }).select("id, dispatch_number").single();
    if (dErr || !dispatch) return { error: dErr?.message ?? "Failed to create dispatch" };

    // Insert items
    const { error: diErr } = await admin.from("dispatch_items")
      .insert(dispatchItemsToInsert.map(di => ({ ...di, dispatch_id: dispatch.id })));
    if (diErr) return { error: diErr.message };

    await logEvent(admin, orderId, "dispatch_created", actor, undefined, {
      dispatch_id: dispatch.id,
      dispatch_number: dispatch.dispatch_number,
      total_qty: totalQty,
      total_amount: totalAmount,
    });

    // Recompute the order's app_status — should flip to 'loading' if this is
    // the first pending dispatch on it.
    await recomputeOrderStatus(admin, orderId);

    revalidatePath("/orders");
    revalidatePath("/dispatches");
    revalidatePath("/dispatch");
    return { ok: true, dispatchId: dispatch.id, dispatchNumber: dispatch.dispatch_number };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// SHIP DISPATCH (truck leaves warehouse)
// =============================================================================
export async function shipDispatch(dispatchId: string) {
  try {
    const actor = await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();

    const { data: d } = await admin.from("dispatches")
      .select("id, order_id, status").eq("id", dispatchId).single();
    if (!d) return { error: "Dispatch not found" };
    if (d.status !== "pending") return { error: `Cannot ship — current status: ${d.status}` };

    const { error } = await admin.from("dispatches").update({
      status: "shipped",
      shipped_at: new Date().toISOString(),
      shipped_by: actor.userId,
    }).eq("id", dispatchId);
    if (error) return { error: error.message };

    await logEvent(admin, d.order_id, "dispatch_shipped", actor, undefined, { dispatch_id: dispatchId });
    await recomputeOrderStatus(admin, d.order_id);

    revalidatePath("/orders");
    revalidatePath("/dispatches");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// MARK DISPATCH DELIVERED (with POD)
// =============================================================================
export async function markDelivered(
  dispatchId: string,
  pod: {
    photoUrl: string;
    latitude: number | null;
    longitude: number | null;
    accuracyM?: number | null;
    receiverName?: string;
    notes?: string;
  },
) {
  try {
    const actor = await requireRoles(["admin", "dispatch", "delivery"]);
    const admin = createAdminClient();

    const { data: d } = await admin.from("dispatches")
      .select("id, order_id, status").eq("id", dispatchId).single();
    if (!d) return { error: "Dispatch not found" };
    if (d.status !== "shipped") return { error: `Cannot mark delivered — current status: ${d.status}` };

    if (!pod.photoUrl) return { error: "POD photo required" };

    const { error: pErr } = await admin.from("pods").insert({
      dispatch_id: dispatchId,
      photo_url: pod.photoUrl,
      latitude: pod.latitude,
      longitude: pod.longitude,
      accuracy_m: pod.accuracyM ?? null,
      receiver_name: pod.receiverName?.trim() || null,
      notes: pod.notes?.trim() || null,
      captured_by: actor.userId,
    });
    if (pErr) return { error: `POD: ${pErr.message}` };

    const { error: dErr } = await admin.from("dispatches").update({
      status: "delivered",
      delivered_at: new Date().toISOString(),
      delivered_by: actor.userId,
    }).eq("id", dispatchId);
    if (dErr) return { error: dErr.message };

    await logEvent(admin, d.order_id, "dispatch_delivered", actor, undefined, { dispatch_id: dispatchId });
    await recomputeOrderStatus(admin, d.order_id);

    revalidatePath("/orders");
    revalidatePath("/dispatches");
    revalidatePath(`/pod/${dispatchId}`);
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// CANCEL DISPATCH (warehouse error etc — only if not yet shipped)
// =============================================================================
export async function cancelDispatch(dispatchId: string, reason: string) {
  try {
    if (!reason || reason.trim().length < 3) return { error: "Cancel reason required" };
    const actor = await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();

    const { data: d } = await admin.from("dispatches")
      .select("id, order_id, status").eq("id", dispatchId).single();
    if (!d) return { error: "Dispatch not found" };
    if (d.status !== "pending") return { error: `Can only cancel pending dispatches (current: ${d.status})` };

    const { error } = await admin.from("dispatches").update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: actor.userId,
      cancel_reason: reason.trim(),
    }).eq("id", dispatchId);
    if (error) return { error: error.message };

    await logEvent(admin, d.order_id, "dispatch_cancelled", actor, reason);
    await recomputeOrderStatus(admin, d.order_id);

    revalidatePath("/orders");
    revalidatePath("/dispatches");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// UPLOAD POD PHOTO (returns storage URL — called from client before markDelivered)
// =============================================================================
export async function getPhotoUploadUrl(dispatchId: string) {
  try {
    await requireRoles(["admin", "dispatch", "delivery"]);
    const admin = createAdminClient();
    const objectName = `dispatch-${dispatchId}/${Date.now()}.jpg`;
    const { data, error } = await admin.storage
      .from("pod-photos")
      .createSignedUploadUrl(objectName);
    if (error || !data) return { error: error?.message ?? "Could not create upload URL" };
    return { ok: true, path: data.path, token: data.token, objectName };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getPhotoPublicUrl(objectName: string) {
  const admin = createAdminClient();
  const { data } = admin.storage.from("pod-photos").getPublicUrl(objectName);
  return data.publicUrl;
}

// =============================================================================
// BULK DISPATCH BY BEAT
//
// Creates one dispatch row per approved/partially_dispatched order in the
// given beat, all sharing the same vehicle/driver. Each dispatch contains
// the full remaining quantity per line.
//
// Stops on the first failure and returns a partial-success result so the
// dispatcher knows which orders went through.
// =============================================================================

export async function bulkDispatchByBeat(input: {
  beatId: string;
  vehicleNumber: string;
  driverName: string;
  driverPhone?: string;
  notes?: string;
}) {
  try {
    await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();

    if (!input.vehicleNumber.trim()) return { error: "Vehicle number is required" };
    if (!input.driverName.trim()) return { error: "Driver name is required" };

    // Find candidate orders for this beat
    const { data: orders, error: oErr } = await admin
      .from("orders")
      .select("id, rupyz_order_id, customer:customers!inner(name, beat_id)")
      .in("app_status", ["approved", "partially_dispatched"])
      .eq("customer.beat_id", input.beatId);
    if (oErr) return { error: oErr.message };
    const orderList = (orders ?? []) as unknown as Array<{ id: string; rupyz_order_id: string }>;
    if (orderList.length === 0) return { error: "No approved orders found for this beat" };

    // For each order, load remaining (un-dispatched) line quantities and dispatch full remaining
    const results: Array<{ orderId: string; rupyzOrderId: string; ok: boolean; error?: string; dispatchNumber?: string }> = [];

    for (const o of orderList) {
      // Pull order items with already-dispatched qty
      const { data: items } = await admin
        .from("order_items")
        .select("id, qty, total_dispatched_qty")
        .eq("order_id", o.id);

      const lines = (items ?? [])
        .map((it: { id: string; qty: number; total_dispatched_qty: number | null }) => ({
          orderItemId: it.id,
          qty: Number(it.qty) - Number(it.total_dispatched_qty ?? 0),
        }))
        .filter(l => l.qty > 0);

      if (lines.length === 0) {
        results.push({ orderId: o.id, rupyzOrderId: o.rupyz_order_id, ok: false, error: "Nothing left to dispatch" });
        continue;
      }

      const res = await createDispatch(o.id, lines, {
        vehicleNumber: input.vehicleNumber.trim(),
        driverName: input.driverName.trim(),
        driverPhone: input.driverPhone?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
      });

      if (res.error) {
        results.push({ orderId: o.id, rupyzOrderId: o.rupyz_order_id, ok: false, error: res.error });
      } else {
        results.push({ orderId: o.id, rupyzOrderId: o.rupyz_order_id, ok: true, dispatchNumber: res.dispatchNumber });
      }
    }

    const succeeded = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;

    revalidatePath("/dispatch");
    revalidatePath("/orders");
    revalidatePath("/dispatches");

    return {
      ok: failed === 0,
      succeeded,
      failed,
      total: results.length,
      results,
    };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// DISPATCH SELECTED ORDERS (load-truck wizard)
//
// Like bulkDispatchByBeat but operates on an explicit list of order IDs
// instead of "all in beat." Used by the wizard at /dispatch/[beatId]/load-truck.
//
// Each order is dispatched at full remaining quantity. Vehicle/driver is
// shared across all dispatches.
// =============================================================================

export async function dispatchSelectedOrders(input: {
  orderIds: string[];
  vehicleNumber: string;
  driverName: string;
  driverPhone?: string;
  notes?: string;
}) {
  try {
    await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();

    if (!input.vehicleNumber.trim()) return { error: "Vehicle number is required" };
    if (!input.driverName.trim()) return { error: "Driver name is required" };
    if (!input.orderIds || input.orderIds.length === 0) return { error: "No orders selected" };

    // Validate all order IDs exist and are in dispatchable state
    const { data: orders, error: oErr } = await admin
      .from("orders")
      .select("id, rupyz_order_id, app_status")
      .in("id", input.orderIds);
    if (oErr) return { error: oErr.message };
    const orderList = (orders ?? []) as Array<{ id: string; rupyz_order_id: string; app_status: string }>;

    const invalid = orderList.filter(o => !["approved", "partially_dispatched"].includes(o.app_status));
    if (invalid.length > 0) {
      return { error: `${invalid.length} order(s) not dispatchable (already sent or cancelled). Refresh the list.` };
    }
    if (orderList.length !== input.orderIds.length) {
      return { error: "Some selected orders no longer exist. Refresh the list." };
    }

    const results: Array<{ orderId: string; rupyzOrderId: string; ok: boolean; error?: string; dispatchNumber?: string }> = [];

    for (const o of orderList) {
      const { data: items } = await admin
        .from("order_items")
        .select("id, qty, total_dispatched_qty")
        .eq("order_id", o.id);

      const lines = (items ?? [])
        .map((it: { id: string; qty: number; total_dispatched_qty: number | null }) => ({
          orderItemId: it.id,
          qty: Number(it.qty) - Number(it.total_dispatched_qty ?? 0),
        }))
        .filter(l => l.qty > 0);

      if (lines.length === 0) {
        results.push({ orderId: o.id, rupyzOrderId: o.rupyz_order_id, ok: false, error: "Nothing left to dispatch" });
        continue;
      }

      const res = await createDispatch(o.id, lines, {
        vehicleNumber: input.vehicleNumber.trim(),
        driverName: input.driverName.trim(),
        driverPhone: input.driverPhone?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
      });

      if (res.error) {
        results.push({ orderId: o.id, rupyzOrderId: o.rupyz_order_id, ok: false, error: res.error });
      } else {
        results.push({ orderId: o.id, rupyzOrderId: o.rupyz_order_id, ok: true, dispatchNumber: res.dispatchNumber });
      }
    }

    const succeeded = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;

    revalidatePath("/dispatch");
    revalidatePath("/orders");
    revalidatePath("/dispatches");

    return {
      ok: failed === 0,
      succeeded,
      failed,
      total: results.length,
      results,
    };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// SHIP TRUCK (mark all pending dispatches with a given vehicle+driver as shipped)
//
// Used by the dispatch PWA when the dispatcher confirms "truck has left."
// Advances every pending dispatch matching the (vehicle_number, driver_name)
// pair to 'shipped' and recomputes each affected order's app_status.
// =============================================================================

export async function shipTruck(input: {
  vehicleNumber: string;
  driverName: string;
}) {
  try {
    const actor = await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();

    if (!input.vehicleNumber.trim()) return { error: "Vehicle number is required" };

    // Pull the matching pending dispatches
    const { data: dispatches, error: dErr } = await admin.from("dispatches")
      .select("id, order_id")
      .eq("status", "pending")
      .eq("vehicle_number", input.vehicleNumber)
      .eq("driver_name", input.driverName);
    if (dErr) return { error: dErr.message };
    if (!dispatches || dispatches.length === 0) return { error: "No pending dispatches found for this truck" };

    const now = new Date().toISOString();
    const dispatchIds = dispatches.map(d => d.id);
    const orderIds = Array.from(new Set(dispatches.map(d => d.order_id)));

    // Flip them all to 'shipped'
    const { error: uErr } = await admin.from("dispatches")
      .update({ status: "shipped", shipped_at: now, shipped_by: actor.userId })
      .in("id", dispatchIds);
    if (uErr) return { error: uErr.message };

    // Log + recompute each affected order's status
    for (const orderId of orderIds) {
      await logEvent(admin, orderId, "truck_dispatched", actor, undefined, {
        vehicle_number: input.vehicleNumber,
        driver_name: input.driverName,
        dispatch_count: dispatches.filter(d => d.order_id === orderId).length,
      });
      await recomputeOrderStatus(admin, orderId);
    }

    revalidatePath("/dispatch");
    revalidatePath("/orders");
    revalidatePath("/dispatches");

    return {
      ok: true,
      dispatchCount: dispatches.length,
      orderCount: orderIds.length,
    };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
