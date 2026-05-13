"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

interface LoadLineInput {
  orderItemId: string;
  loadedQty: number;
}

export async function markOrderLoaded(
  orderId: string,
  lines: LoadLineInput[],
  options: { markPartial: boolean }
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

  // Confirm order is in loadable state
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, app_status")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr || !order) return { ok: false, error: "Order not found" };
  if (!["approved", "loading"].includes(order.app_status)) {
    return { ok: false, error: `Order is "${order.app_status}", can't mark as loaded` };
  }

  // Update each order_items row with loaded_qty.
  // Doing this in a single batch isn't trivial with Supabase JS; we do parallel updates.
  const updateResults = await Promise.all(
    lines.map(line =>
      supabase
        .from("order_items")
        .update({ loaded_qty: line.loadedQty })
        .eq("id", line.orderItemId)
        .eq("order_id", orderId) // safety: ensure the item belongs to this order
    )
  );

  const firstUpdateError = updateResults.find(r => r.error);
  if (firstUpdateError?.error) {
    return { ok: false, error: `Failed to save loaded quantities: ${firstUpdateError.error.message}` };
  }

  // Determine final status: 'loaded' or 'partially_dispatched'
  const finalStatus = options.markPartial ? "partially_dispatched" : "loaded";

  const { error: statusErr } = await supabase
    .from("orders")
    .update({
      app_status: finalStatus,
      loaded_at: new Date().toISOString(),
      loaded_by: user.id,
    })
    .eq("id", orderId)
    .in("app_status", ["approved", "loading"]); // concurrency guard

  if (statusErr) {
    return { ok: false, error: `Failed to update order status: ${statusErr.message}` };
  }

  revalidatePath("/load");
  revalidatePath(`/load/orders/${orderId}`);

  return { ok: true, status: finalStatus };
}
