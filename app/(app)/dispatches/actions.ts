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
    return { ok: true, dispatchId: dispatch.id, dispatchNumber: dispatch.dispatch_number };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

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
// MARK DISPATCH DELIVERED (simple — no POD photo/GPS)
// =============================================================================
export async function markDelivered(dispatchId: string, receiverName?: string) {
  try {
    const actor = await requireRoles(["admin", "dispatch", "delivery"]);
    const admin = createAdminClient();

    const { data: d } = await admin.from("dispatches")
      .select("id, order_id, status").eq("id", dispatchId).single();
    if (!d) return { error: "Dispatch not found" };
    if (d.status !== "shipped") return { error: `Cannot mark delivered — current status: ${d.status}` };

    const { error: dErr } = await admin.from("dispatches").update({
      status: "delivered",
      delivered_at: new Date().toISOString(),
      delivered_by: actor.userId,
    }).eq("id", dispatchId);
    if (dErr) return { error: dErr.message };

    await logEvent(admin, d.order_id, "dispatch_delivered", actor, receiverName?.trim() || undefined, {
      dispatch_id: dispatchId,
      receiver_name: receiverName?.trim() || null,
    });
    await recomputeOrderStatus(admin, d.order_id);

    revalidatePath("/orders");
    revalidatePath("/dispatches");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// DISPATCH FORM OPTIONS — active vehicles and drivers for the Orders drawer
// =============================================================================
export async function listDispatchOptions() {
  try {
    await requireRoles(["admin", "dispatch", "approver"]);
    const admin = createAdminClient();
    const [{ data: vehicles, error: vErr }, { data: drivers, error: dErr }] = await Promise.all([
      admin.from("vehicles").select("id, number").eq("active", true).order("number"),
      admin.from("app_users").select("id, full_name, phone").eq("role", "driver").eq("active", true).order("full_name"),
    ]);
    if (vErr) return { error: vErr.message };
    if (dErr) return { error: dErr.message };
    return {
      ok: true,
      vehicles: (vehicles ?? []) as Array<{ id: string; number: string }>,
      drivers: (drivers ?? []) as Array<{ id: string; full_name: string; phone: string | null }>,
    };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

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

export async function createVehicle(input: { number: string; make?: string; capacityKg?: number }) {
  try {
    const actor = await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();
    const number = input.number.trim();
    if (!number) return { error: "Vehicle number is required" };

    const { data: existing } = await admin
      .from("vehicles").select("id, number, make, capacity_kg")
      .ilike("number", number).maybeSingle();
    if (existing) return { ok: true, vehicle: existing };

    const { data: v, error } = await admin.from("vehicles").insert({
      number,
      make: input.make?.trim() || null,
      capacity_kg: input.capacityKg ?? null,
      active: true,
      created_by: actor.userId,
    }).select("id, number, make, capacity_kg").single();
    if (error) return { error: error.message };
    revalidatePath("/vehicles");
    return { ok: true, vehicle: v };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

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

export async function updateVehicle(input: { id: string; number: string; make?: string; capacityKg?: number | null }) {
  try {
    await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();
    const number = input.number.trim();
    if (!input.id) return { error: "Vehicle id required" };
    if (!number) return { error: "Vehicle number is required" };

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
    return { ok: true, vehicle: v };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setVehicleActive(input: { id: string; active: boolean }) {
  try {
    await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();
    if (!input.id) return { error: "Vehicle id required" };

    const { error } = await admin.from("vehicles").update({ active: input.active }).eq("id", input.id);
    if (error) return { error: error.message };

    revalidatePath("/vehicles");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteVehicle(id: string) {
  try {
    await requireRoles(["admin", "dispatch"]);
    const admin = createAdminClient();
    if (!id) return { error: "Vehicle id required" };

    const { data: used } = await admin
      .from("vehicle_loads").select("id").eq("vehicle_id", id).limit(1);

    if (used && used.length > 0) {
      const { error } = await admin.from("vehicles").update({ active: false }).eq("id", id);
      if (error) return { error: error.message };
      revalidatePath("/vehicles");
      revalidatePath("/vehicles");
      return { ok: true, deactivated: true };
    }

    const { error } = await admin.from("vehicles").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/vehicles");
    return { ok: true, deleted: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
