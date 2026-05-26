"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface LoadLineInput {
  orderItemId: string;
  loadedQty: number;
}

export async function markOrderLoaded(
  orderId: string,
  lines: LoadLineInput[],
  options: { markPartial: boolean; loadId?: string }
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // Role check
  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || !["admin", "dispatch"].includes(me.role)) {
    return { ok: false, error: "Not authorized" };
  }

  // Validate: at least one line must have loaded_qty > 0
  const totalLoaded = lines.reduce((s, l) => s + Number(l.loadedQty || 0), 0);
  if (totalLoaded <= 0) {
    return { ok: false, error: "At least one line must have quantity > 0" };
  }

  // A vehicle load session is required so the order attaches to a vehicle.
  if (!options.loadId) {
    return { ok: false, error: "No vehicle selected. Go back to the loading screen and pick a vehicle first." };
  }

  const admin = createAdminClient();

  // Confirm order is loadable — must be invoiced (or already loading/loaded)
  // and must have an invoice number set.
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, app_status, invoice_number")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr || !order) return { ok: false, error: "Order not found" };

  if (!["invoiced", "loading", "loaded", "partially_dispatched"].includes(order.app_status)) {
    if (order.app_status === "approved") {
      return {
        ok: false,
        error: "Add the invoice number first. Approved orders cannot be loaded until billing enters the Tally invoice.",
      };
    }
    return { ok: false, error: `Order is "${order.app_status}", can't mark as loaded` };
  }
  if (!order.invoice_number) {
    return { ok: false, error: "Order is missing an invoice number. Ask billing to set it." };
  }

  // Confirm the load session exists and is still open
  const { data: load } = await admin
    .from("vehicle_loads")
    .select("id, status, vehicle_id, vehicles(number)")
    .eq("id", options.loadId)
    .maybeSingle();
  if (!load) return { ok: false, error: "Loading session not found. Start a new one from the loading screen." };
  if (load.status !== "loading") {
    return { ok: false, error: "This vehicle has already left. Start a new loading session." };
  }
  const vehicleNumber = Array.isArray(load.vehicles)
    ? (load.vehicles[0] as { number?: string } | undefined)?.number
    : (load.vehicles as { number?: string } | null)?.number;

  // Save loaded_qty on each line
  const updateResults = await Promise.all(
    lines.map(line =>
      admin
        .from("order_items")
        .update({ loaded_qty: line.loadedQty })
        .eq("id", line.orderItemId)
        .eq("order_id", orderId)
    )
  );
  const firstUpdateError = updateResults.find(r => r.error);
  if (firstUpdateError?.error) {
    return { ok: false, error: `Failed to save loaded quantities: ${firstUpdateError.error.message}` };
  }

  // Build dispatch lines from loaded quantities (only positive)
  const itemIds = lines.map(l => l.orderItemId);
  const { data: orderItems } = await admin
    .from("order_items")
    .select("id, price, product_name")
    .in("id", itemIds);
  const priceMap = new Map((orderItems ?? []).map((it: { id: string; price: number }) => [it.id, Number(it.price)]));

  const dispatchLines = lines
    .filter(l => Number(l.loadedQty) > 0)
    .map(l => {
      const price = priceMap.get(l.orderItemId) ?? 0;
      return {
        order_item_id: l.orderItemId,
        qty: Number(l.loadedQty),
        price,
        total_amount: price * Number(l.loadedQty),
      };
    });
  if (dispatchLines.length === 0) {
    return { ok: false, error: "Nothing to load (all quantities are zero)." };
  }

  const totalQty = dispatchLines.reduce((s, d) => s + d.qty, 0);
  const totalAmount = dispatchLines.reduce((s, d) => s + d.total_amount, 0);

  // Create the dispatch attached to this vehicle load (status pending → ships at "Vehicle left")
  const { data: numRow } = await admin.rpc("next_dispatch_number");
  const dispatchNumber = numRow as unknown as string;

  const { data: dispatch, error: dErr } = await admin.from("dispatches").insert({
    order_id: orderId,
    dispatch_number: dispatchNumber,
    status: "pending",
    vehicle_number: vehicleNumber || null,
    load_id: options.loadId,
    total_qty: totalQty,
    total_amount: totalAmount,
    created_by: user.id,
  }).select("id").single();
  if (dErr || !dispatch) {
    return { ok: false, error: `Failed to create dispatch: ${dErr?.message ?? "unknown"}` };
  }

  const { error: diErr } = await admin.from("dispatch_items")
    .insert(dispatchLines.map(d => ({ ...d, dispatch_id: dispatch.id })));
  if (diErr) {
    return { ok: false, error: `Failed to save dispatch items: ${diErr.message}` };
  }

  // Determine final status:
  //  - markPartial OR any line short of ordered  → partially_dispatched
  //  - otherwise                                  → loaded
  const finalStatus = options.markPartial ? "partially_dispatched" : "loaded";

  const { error: statusErr } = await admin
    .from("orders")
    .update({
      app_status: finalStatus,
      loaded_at: new Date().toISOString(),
      loaded_by: user.id,
    })
    .eq("id", orderId)
    .in("app_status", ["invoiced", "loading", "loaded", "partially_dispatched"]);
  if (statusErr) {
    return { ok: false, error: `Failed to update order status: ${statusErr.message}` };
  }

  // Audit
  await admin.from("order_audit_events").insert({
    order_id: orderId,
    event_type: "order_loaded",
    actor_id: user.id,
    actor_name: null,
    comment: null,
    details: { load_id: options.loadId, dispatch_id: dispatch.id, total_qty: totalQty, partial: options.markPartial },
  });

  revalidatePath("/load");
  revalidatePath(`/load/orders/${orderId}`);
  revalidatePath("/dispatch");

  return { ok: true, status: finalStatus };
}
