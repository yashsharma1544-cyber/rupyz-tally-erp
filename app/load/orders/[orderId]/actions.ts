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

  // Confirm order is in loadable state — must be invoiced (or already loading)
  // and must have an invoice number set.
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, app_status, invoice_number")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr || !order) return { ok: false, error: "Order not found" };

  if (!["invoiced", "loading"].includes(order.app_status)) {
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

  // Update each order_items row with loaded_qty.
  const updateResults = await Promise.all(
    lines.map(line =>
      supabase
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
    .in("app_status", ["invoiced", "loading"]); // concurrency guard — invoice required

  if (statusErr) {
    return { ok: false, error: `Failed to update order status: ${statusErr.message}` };
  }

  revalidatePath("/load");
  revalidatePath(`/load/orders/${orderId}`);

  return { ok: true, status: finalStatus };
}
