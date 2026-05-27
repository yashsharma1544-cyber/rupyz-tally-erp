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
    const anyShipped = (dispatchItems ?? []).some((di: { dispatch: { status: string } | { status: string }[] | null }) => {
      const status = Array.isArray(di.dispatch) ? di.dispatch[0]?.status : di.dispatch?.status;
      return status === "shipped" || status === "delivered";
    });
    if (anyShipped) {
      newStatus = "partially_dispatched";
    } else {
      const anyPending = (dispatchItems ?? []).some((di: { dispatch: { status: string } | { status: string }[] | null }) => {
        const status = Array.isArray(di.dispatch) ? di.dispatch[0]?.status : di.dispatch?.status;
        return status === "pending";
      });
      newStatus = anyPending ? "loaded" : "approved";
    }
  }

  await admin.from("orders").update({ app_status: newStatus }).eq("id", orderId);
}

// =============================================================================
// CREATE DISPATCH
// EDIT 1+2: added optional loadId; driver/helper already optional; set load_id.
// =============================================================================
export async function createDispatch(
  orderId: string,
  items: { orderItemId: string; qty: number }[],
  meta: {
    vehicleNumber?: string;
    driverName?: string;
    driverPhone?: string;
    driverUserId?: string;
    helperUserId?: string;
    loadId?: string;
    notes?: string;
  } = {},
) {
  try {
    const actor = await requireRoles(["admin", "dispatch", "approver"]);
    const admin = createAdminClient();

    const { data: order } = await admin.from("orders").select("id, app_status").eq("id", orderId).single();
    if (!order) return { error: "Order not found" };
    if (!["approved", "partially_dispatched", "loaded"].includes(order.app_status))
      return { error: `Cannot dispatch — order is "${order.app_status}"` };

    if (!items.length) return { error: "No items selected for dispatch" };

    const itemIds = items.map(i => i.orderItemId);
    const { data: orderItems } = await admin
      .from("order_items")
      .select("id, qty, price, product_name")
      .in("id", itemIds);
    if (!orderItems) return { error: "Could not load order items" };

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

    const { data: numRow } = await admin.rpc("next_dispatch_number");
    const dispatchNumber = numRow as unknown as string;

    const { data: dispatch, error: dErr } = await admin.from("dispatches").insert({
      order_id: orderId,
      dispatch_number: dispatchNumber,
      status: "pending",
      vehicle_number: meta.vehicleNumber || null,
      driver_name: meta.driverName || null,
      driver_phone: meta.driverPhone || null,
      driver_user_id: meta.driverUserId || null,
      helper_user_id: meta.helperUserId || null,
      load_id: meta.loadId || null,
      notes: meta.notes || null,
      total_qty: totalQty,
      total_amount: totalAmount,
      created_by: actor.userId,
    }).select("id, dispatch_number").single();
    if (dErr || !dispatch) return { error: dErr?.message ?? "Failed to create dispatch" };

    const { error: diErr } = await admin.from("dispatch_items")
      .insert(dispatchItemsToInsert.map(di => ({ ...di, dispatch_id: dispatch.id })));
    if (diErr) return { error: diErr.message };

    await logEvent(admin, orderId, "dispatch_created", actor, undefined, {
      dispatch_id: dispatch.id,
      dispatch_number: dispatch.dispatch_number,
      total_qty: totalQty,
      total_amount: totalAmount,
      helper_user_id: meta.helperUserId || null,
    });

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
    const actor = await requireRoles(["admin", "dispatch", "delivery", "driver", "van_helper"]);
    const admin = createAdminClient();

    const { data: d } = await admin.from("dispatches")
      .select("id, order_id, status, driver_user_id, helper_user_id").eq("id", dispatchId).single();
    if (!d) return { error: "Dispatch not found" };
    if (d.status !== "shipped") return { error: `Cannot mark delivered — current status: ${d.status}` };

    if (actor.role === "driver" && d.driver_user_id !== actor.userId) {
      return { error: "Not assigned to this delivery" };
    }
    if (actor.role === "van_helper" && d.helper_user_id !== actor.userId) {
      return { error: "Not assigned to this delivery" };
    }

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

    await logEvent(admin, d.order_id, "dispatch_delivered", actor, undefined, {
      dispatch_id: dispatchId,
      captured_by_role: actor.role,
    });
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
// CANCEL DISPATCH
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
// UPLOAD POD PHOTO
// =============================================================================
export async function getPhotoUploadUrl(dispatchId: string) {
  try {
    await requireRoles(["admin", "dispatch", "delivery", "driver", "van_helper"]);
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
// BULK DISPATCH BY BEAT  (unchanged)
// =============================================================================
export async function bulkDispatchByBeat(input: {
  beatId: string;
  vehicleNumber: string;
  driverName: string;
  driverPhone?: string;
  driverUserId?: string;
  helperUserId?: string;
  notes?: string;
}) {
  try {
    await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();

    if (!input.vehicleNumber.trim()) return { error: "Vehicle number is required" };
    if (!input.driverName.trim()) return { error: "Driver name is required" };

    const { data: orders, error: oErr } = await admin
      .from("orders")
      .select("id, rupyz_order_id, customer:customers!inner(name, beat_id)")
      .in("app_status", ["approved", "partially_dispatched", "loaded"])
      .eq("customer.beat_id", input.beatId);
    if (oErr) return { error: oErr.message };
    const orderList = (orders ?? []) as unknown as Array<{ id: string; rupyz_order_id: string }>;
    if (orderList.length === 0) return { error: "No approved orders found for this beat" };

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
        driverUserId: input.driverUserId,
        helperUserId: input.helperUserId,
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

    return { ok: failed === 0, succeeded, failed, total: results.length, results };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// CREATE VEHICLE (inline add from the load wizard dropdown)
// =============================================================================
export async function createVehicle(input: { number: string; make?: string; capacityKg?: number }) {
  try {
    const actor = await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();
    const number = input.number.trim();
    if (!number) return { error: "Vehicle number is required" };

    // reuse if a vehicle with this number already exists (case-insensitive)
    const { data: existing } = await admin
      .from("vehicles").select("id, number, make, capacity_kg")
      .ilike("number", number).maybeSingle();
    if (existing) return { ok: true, vehicle: existing };

    const { data: v, error } = await admin.from("vehicles").insert({
      number,
      make: input.make?.trim() || null,
      capacity_kg: input.capacityKg ?? null,
      created_by: actor.userId,
    }).select("id, number, make, capacity_kg").single();
    if (error) return { error: error.message };
    revalidatePath("/load");
    revalidatePath("/vehicles");
    return { ok: true, vehicle: v };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// LIST VEHICLES (manage screen) — all vehicles + usage count from vehicle_loads
// =============================================================================
export async function listVehicles() {
  try {
    await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();

    const { data: vehicles, error } = await admin
      .from("vehicles")
      .select("id, number, make, capacity_kg, active, created_at")
      .order("active", { ascending: false })
      .order("number", { ascending: true });
    if (error) return { error: error.message };

    // usage counts per vehicle
    const { data: loads } = await admin.from("vehicle_loads").select("vehicle_id");
    const usage = new Map<string, number>();
    for (const l of (loads ?? []) as Array<{ vehicle_id: string }>) {
      usage.set(l.vehicle_id, (usage.get(l.vehicle_id) ?? 0) + 1);
    }

    return {
      ok: true,
      vehicles: (vehicles ?? []).map((v: { id: string; number: string; make: string | null; capacity_kg: number | null; active: boolean; created_at: string }) => ({
        id: v.id,
        number: v.number,
        make: v.make,
        capacityKg: v.capacity_kg,
        active: v.active,
        usageCount: usage.get(v.id) ?? 0,
      })),
    };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// UPDATE VEHICLE — edit number/make/capacity (re-checks unique number)
// =============================================================================
export async function updateVehicle(input: { id: string; number: string; make?: string; capacityKg?: number | null }) {
  try {
    await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();
    const number = input.number.trim();
    if (!input.id) return { error: "Vehicle id required" };
    if (!number) return { error: "Vehicle number is required" };

    // another vehicle already using this number?
    const { data: clash } = await admin
      .from("vehicles").select("id").ilike("number", number).neq("id", input.id).maybeSingle();
    if (clash) return { error: `Another vehicle already uses number "${number}"` };

    const { data: v, error } = await admin.from("vehicles").update({
      number,
      make: input.make?.trim() || null,
      capacity_kg: input.capacityKg ?? null,
    }).eq("id", input.id).select("id, number, make, capacity_kg, active").single();
    if (error) return { error: error.message };

    revalidatePath("/vehicles");
    revalidatePath("/load");
    return { ok: true, vehicle: v };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// SET VEHICLE ACTIVE — deactivate / reactivate
// =============================================================================
export async function setVehicleActive(input: { id: string; active: boolean }) {
  try {
    await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();
    if (!input.id) return { error: "Vehicle id required" };

    const { error } = await admin.from("vehicles").update({ active: input.active }).eq("id", input.id);
    if (error) return { error: error.message };

    revalidatePath("/vehicles");
    revalidatePath("/load");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// DELETE VEHICLE — hard-delete if never used; otherwise deactivate (keep history)
// =============================================================================
export async function deleteVehicle(id: string) {
  try {
    await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();
    if (!id) return { error: "Vehicle id required" };

    const { data: used } = await admin
      .from("vehicle_loads").select("id").eq("vehicle_id", id).limit(1);

    if (used && used.length > 0) {
      // In use — can't hard delete; deactivate instead to preserve history.
      const { error } = await admin.from("vehicles").update({ active: false }).eq("id", id);
      if (error) return { error: error.message };
      revalidatePath("/vehicles");
      revalidatePath("/load");
      return { ok: true, deactivated: true };
    }

    const { error } = await admin.from("vehicles").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/vehicles");
    revalidatePath("/load");
    return { ok: true, deleted: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// START VEHICLE LOAD  — begin a loading session at /load
//
// Creates a vehicle_loads parent (status 'loading') with the chosen vehicle +
// loaders. Orders are then attached to this load as the team marks each one
// loaded (see markOrderLoaded in /load/orders/[orderId]/actions.ts).
// Returns the load id, which /load threads through as ?load=<id>.
// =============================================================================
export async function startVehicleLoad(input: { vehicleId: string; loaderUserIds: string[] }) {
  try {
    const actor = await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();
    if (!input.vehicleId) return { error: "Vehicle is required" };

    const { data: vehicle } = await admin
      .from("vehicles").select("id, number").eq("id", input.vehicleId).single();
    if (!vehicle) return { error: "Vehicle not found" };

    const { data: load, error: lErr } = await admin.from("vehicle_loads").insert({
      vehicle_id: input.vehicleId,
      status: "loading",
      loaded_by: actor.userId,
      created_by: actor.userId,
    }).select("id").single();
    if (lErr || !load) return { error: lErr?.message ?? "Failed to start load" };

    if (input.loaderUserIds?.length) {
      const rows = Array.from(new Set(input.loaderUserIds)).map(uid => ({ load_id: load.id, user_id: uid }));
      await admin.from("vehicle_load_loaders").insert(rows);
    }

    revalidatePath("/load");
    return { ok: true, loadId: load.id, vehicleNumber: vehicle.number };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// CANCEL VEHICLE LOAD  — abandon an empty/in-progress loading session
// (only allowed while still 'loading'; detaches nothing if dispatches exist)
// =============================================================================
export async function cancelVehicleLoad(loadId: string) {
  try {
    await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();
    if (!loadId) return { error: "Load id required" };

    const { data: pending } = await admin
      .from("dispatches").select("id").eq("load_id", loadId).eq("status", "pending").limit(1);
    if (pending && pending.length > 0) {
      return { error: "This load has orders on it. Remove them or dispatch the vehicle instead." };
    }
    await admin.from("vehicle_loads").update({ status: "cancelled" }).eq("id", loadId).eq("status", "loading");
    revalidatePath("/load");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// DISPATCH SELECTED ORDERS  — vehicle-first flow (with per-item load quantities)
//
// Creates a vehicle_loads parent (vehicle + loaders), then attaches each
// order's dispatch to it via load_id. Driver/helper are NOT set here — they
// are captured later at "Vehicle left" (shipTruck).
//
// Two input modes (backward compatible):
//   • loadLines: explicit per-order, per-item quantities (mandatory-open flow)
//   • orderIds:  legacy "load full remaining" for each order
// If loadLines is provided it takes precedence; orderIds is ignored.
// =============================================================================
export async function dispatchSelectedOrders(input: {
  orderIds?: string[];
  loadLines?: { orderId: string; items: { orderItemId: string; qty: number }[] }[];
  vehicleId: string;
  loaderUserIds: string[];
  notes?: string;
}) {
  try {
    const actor = await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();

    if (!input.vehicleId) return { error: "Vehicle is required" };

    const useLines = Array.isArray(input.loadLines) && input.loadLines.length > 0;
    const orderIds = useLines
      ? input.loadLines!.map(l => l.orderId)
      : (input.orderIds ?? []);
    if (orderIds.length === 0) return { error: "No orders selected" };

    const { data: vehicle } = await admin
      .from("vehicles").select("id, number").eq("id", input.vehicleId).single();
    if (!vehicle) return { error: "Vehicle not found" };

    const { data: orders, error: oErr } = await admin
      .from("orders")
      .select("id, rupyz_order_id, app_status")
      .in("id", orderIds);
    if (oErr) return { error: oErr.message };
    const orderList = (orders ?? []) as Array<{ id: string; rupyz_order_id: string; app_status: string }>;

    const invalid = orderList.filter(o => !["approved", "partially_dispatched", "loaded"].includes(o.app_status));
    if (invalid.length > 0) {
      return { error: `${invalid.length} order(s) not dispatchable (already sent or cancelled). Refresh the list.` };
    }
    if (orderList.length !== orderIds.length) {
      return { error: "Some selected orders no longer exist. Refresh the list." };
    }

    // line lookup for the per-item mode
    const linesByOrder = new Map<string, { orderItemId: string; qty: number }[]>();
    if (useLines) {
      for (const l of input.loadLines!) linesByOrder.set(l.orderId, l.items);
    }

    // 1. Create the load parent
    const { data: load, error: lErr } = await admin.from("vehicle_loads").insert({
      vehicle_id: input.vehicleId,
      status: "loading",
      loaded_by: actor.userId,
      created_by: actor.userId,
      notes: input.notes?.trim() || null,
    }).select("id").single();
    if (lErr || !load) return { error: lErr?.message ?? "Failed to create load" };

    // 2. Record loaders
    if (input.loaderUserIds?.length) {
      const loaderRows = Array.from(new Set(input.loaderUserIds)).map(uid => ({
        load_id: load.id, user_id: uid,
      }));
      await admin.from("vehicle_load_loaders").insert(loaderRows);
    }

    // 3. Attach each order's dispatch to the load (no driver yet)
    const results: Array<{ orderId: string; rupyzOrderId: string; ok: boolean; error?: string; dispatchNumber?: string }> = [];
    for (const o of orderList) {
      let lines: { orderItemId: string; qty: number }[];
      if (useLines) {
        lines = (linesByOrder.get(o.id) ?? []).filter(l => l.qty > 0);
      } else {
        const { data: items } = await admin
          .from("order_items")
          .select("id, qty, total_dispatched_qty")
          .eq("order_id", o.id);
        lines = (items ?? [])
          .map((it: { id: string; qty: number; total_dispatched_qty: number | null }) => ({
            orderItemId: it.id,
            qty: Number(it.qty) - Number(it.total_dispatched_qty ?? 0),
          }))
          .filter(l => l.qty > 0);
      }
      if (lines.length === 0) {
        results.push({ orderId: o.id, rupyzOrderId: o.rupyz_order_id, ok: false, error: "Nothing to load" });
        continue;
      }
      const res = await createDispatch(o.id, lines, {
        vehicleNumber: vehicle.number,
        loadId: load.id,
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

    // If nothing attached, clean up the empty load
    if (succeeded === 0) {
      await admin.from("vehicle_loads").delete().eq("id", load.id);
    }

    revalidatePath("/dispatch");
    revalidatePath("/orders");
    revalidatePath("/dispatches");
    return { ok: failed === 0, succeeded, failed, total: results.length, results, loadId: load.id };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// SHIP TRUCK  — "Vehicle left": capture driver + helper, ship the load
// =============================================================================
export async function shipTruck(input: {
  loadId: string;
  driverUserId: string;
  helperUserId?: string;
}) {
  try {
    const actor = await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();

    if (!input.loadId) return { error: "Load is required" };
    if (!input.driverUserId) return { error: "Driver is required" };

    // driver/helper details from app_users
    const { data: people } = await admin
      .from("app_users").select("id, full_name, phone")
      .in("id", [input.driverUserId, ...(input.helperUserId ? [input.helperUserId] : [])]);
    const driver = (people ?? []).find(p => p.id === input.driverUserId);
    if (!driver) return { error: "Driver not found" };

    const { data: dispatches, error: dErr } = await admin.from("dispatches")
      .select("id, order_id")
      .eq("status", "pending")
      .eq("load_id", input.loadId);
    if (dErr) return { error: dErr.message };
    if (!dispatches || dispatches.length === 0) return { error: "No pending dispatches for this load" };

    const now = new Date().toISOString();
    const dispatchIds = dispatches.map(d => d.id);
    const orderIds = Array.from(new Set(dispatches.map(d => d.order_id)));

    // ship dispatches + stamp driver/helper so the driver app works
    const { error: uErr } = await admin.from("dispatches")
      .update({
        status: "shipped", shipped_at: now, shipped_by: actor.userId,
        driver_user_id: input.driverUserId,
        helper_user_id: input.helperUserId || null,
        driver_name: driver.full_name,
        driver_phone: driver.phone || null,
      })
      .in("id", dispatchIds);
    if (uErr) return { error: uErr.message };

    // mark the load dispatched
    await admin.from("vehicle_loads").update({
      status: "dispatched", dispatched_at: now,
      driver_user_id: input.driverUserId,
      helper_user_id: input.helperUserId || null,
    }).eq("id", input.loadId);

    for (const orderId of orderIds) {
      await logEvent(admin, orderId, "truck_dispatched", actor, undefined, {
        load_id: input.loadId,
        driver_user_id: input.driverUserId,
        helper_user_id: input.helperUserId || null,
        dispatch_count: dispatches.filter(d => d.order_id === orderId).length,
      });
      await recomputeOrderStatus(admin, orderId);
    }

    revalidatePath("/dispatch");
    revalidatePath("/orders");
    revalidatePath("/dispatches");
    return { ok: true, dispatchCount: dispatches.length, orderCount: orderIds.length };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
