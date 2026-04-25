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

// =============================================================================
// APPROVE
// =============================================================================
export async function approveOrder(orderId: string, comment?: string) {
  try {
    const actor = await requireRoles(["admin", "approver"]);
    const admin = createAdminClient();

    const { data: order, error: fetchErr } = await admin
      .from("orders").select("id, app_status").eq("id", orderId).single();
    if (fetchErr || !order) return { error: "Order not found" };
    if (order.app_status !== "received")
      return { error: `Cannot approve — current status is "${order.app_status}"` };

    const now = new Date().toISOString();
    const { error: updErr } = await admin.from("orders").update({
      app_status: "approved",
      approved_at: now,
      approved_by: actor.userId,
    }).eq("id", orderId);
    if (updErr) return { error: updErr.message };

    await logEvent(admin, orderId, "approved", actor, comment);
    revalidatePath("/orders");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// REJECT
// =============================================================================
export async function rejectOrder(orderId: string, reason: string) {
  try {
    if (!reason || reason.trim().length < 3) return { error: "Rejection reason required (min 3 chars)" };
    const actor = await requireRoles(["admin", "approver"]);
    const admin = createAdminClient();

    const { data: order, error: fetchErr } = await admin
      .from("orders").select("id, app_status").eq("id", orderId).single();
    if (fetchErr || !order) return { error: "Order not found" };
    if (order.app_status !== "received")
      return { error: `Cannot reject — current status is "${order.app_status}"` };

    const now = new Date().toISOString();
    const { error: updErr } = await admin.from("orders").update({
      app_status: "rejected",
      reject_reason: reason.trim(),
      rejected_at: now,
      rejected_by: actor.userId,
    }).eq("id", orderId);
    if (updErr) return { error: updErr.message };

    await logEvent(admin, orderId, "rejected", actor, reason);
    revalidatePath("/orders");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// EDIT ORDER
// =============================================================================
export interface EditPayload {
  lineUpdates: { lineId: string; qty?: number; price?: number }[];
  lineRemovals: string[];
  lineAdditions: { productId: string; qty: number; price: number }[];
  comment: string;
}

export async function editOrder(orderId: string, payload: EditPayload) {
  try {
    if (!payload.comment || payload.comment.trim().length < 3) {
      return { error: "Edit comment required (min 3 chars)" };
    }
    const actor = await requireRoles(["admin", "approver"]);
    const admin = createAdminClient();

    // Validate order can be edited
    const { data: order, error: oErr } = await admin
      .from("orders").select("*").eq("id", orderId).single();
    if (oErr || !order) return { error: "Order not found" };
    if (!["received", "approved"].includes(order.app_status))
      return { error: `Cannot edit — order is in "${order.app_status}" status` };

    const { data: items, error: iErr } = await admin
      .from("order_items").select("*").eq("order_id", orderId);
    if (iErr) return { error: iErr.message };

    const summaryLines: string[] = [];
    const itemsByID = new Map((items ?? []).map((it) => [it.id, it]));

    // 1. Apply removals
    for (const lineId of payload.lineRemovals) {
      const it = itemsByID.get(lineId);
      if (!it) continue;
      const { error } = await admin.from("order_items").delete().eq("id", lineId);
      if (error) return { error: `Removing line: ${error.message}` };
      summaryLines.push(`Removed: ${it.product_name} (${it.qty} ${it.unit ?? ""})`);
    }

    // 2. Apply updates (qty / price)
    for (const upd of payload.lineUpdates) {
      const it = itemsByID.get(upd.lineId);
      if (!it) continue;

      const newQty = upd.qty ?? Number(it.qty);
      const newPrice = upd.price ?? Number(it.price);
      if (newQty <= 0) return { error: `Quantity must be > 0 for ${it.product_name}` };

      const gstPct = Number(it.gst_percent ?? 0);
      const totalPriceWithoutGst = newPrice * newQty;
      const totalGstAmount = totalPriceWithoutGst * (gstPct / 100);
      const totalPrice = totalPriceWithoutGst + totalGstAmount;

      const { error } = await admin.from("order_items").update({
        qty: newQty,
        price: newPrice,
        total_price_without_gst: totalPriceWithoutGst,
        total_gst_amount: totalGstAmount,
        total_price: totalPrice,
        gst_amount: newPrice * (gstPct / 100),
      }).eq("id", upd.lineId);
      if (error) return { error: `Updating line: ${error.message}` };

      const changes: string[] = [];
      if (upd.qty !== undefined && Number(upd.qty) !== Number(it.qty)) {
        changes.push(`qty ${it.qty} → ${upd.qty}`);
      }
      if (upd.price !== undefined && Number(upd.price) !== Number(it.price)) {
        changes.push(`price ₹${it.price} → ₹${upd.price}`);
      }
      if (changes.length) summaryLines.push(`${it.product_name}: ${changes.join(", ")}`);
    }

    // 3. Apply additions (require existing product_id)
    for (const add of payload.lineAdditions) {
      if (add.qty <= 0 || add.price < 0) return { error: "Invalid qty or price on new line" };
      const { data: prod, error: pErr } = await admin
        .from("products").select("*").eq("id", add.productId).single();
      if (pErr || !prod) return { error: `Product not found for new line` };

      const gstPct = Number(prod.gst_percent ?? 0);
      const totalPriceWithoutGst = add.price * add.qty;
      const totalGstAmount = totalPriceWithoutGst * (gstPct / 100);
      const totalPrice = totalPriceWithoutGst + totalGstAmount;

      const { error } = await admin.from("order_items").insert({
        order_id: orderId,
        product_id: prod.id,
        rupyz_product_id: prod.rupyz_id ?? 0,
        product_name: prod.name,
        product_code: prod.rupyz_code,
        hsn_code: prod.hsn_code,
        unit: prod.unit,
        qty: add.qty,
        price: add.price,
        mrp: prod.mrp,
        original_price: prod.base_price,
        gst_percent: gstPct,
        gst_amount: add.price * (gstPct / 100),
        total_gst_amount: totalGstAmount,
        total_price: totalPrice,
        total_price_without_gst: totalPriceWithoutGst,
      });
      if (error) return { error: `Adding line: ${error.message}` };
      summaryLines.push(`Added: ${prod.name} (${add.qty} ${prod.unit ?? ""} @ ₹${add.price})`);
    }

    // 4. Recompute order totals
    const { data: freshItems } = await admin.from("order_items").select("*").eq("order_id", orderId);
    const newAmount = (freshItems ?? []).reduce((s, it) => s + Number(it.total_price_without_gst ?? 0), 0);
    const newGst = (freshItems ?? []).reduce((s, it) => s + Number(it.total_gst_amount ?? 0), 0);
    const newTotal = newAmount + newGst;

    // 5. Compute next revision number
    const { data: maxRev } = await admin
      .from("order_revisions").select("revision_number")
      .eq("order_id", orderId)
      .order("revision_number", { ascending: false }).limit(1).maybeSingle();
    const nextRev = (maxRev?.revision_number ?? 0) + 1;

    // 6. Save snapshot
    await admin.from("order_revisions").insert({
      order_id: orderId,
      revision_number: nextRev,
      snapshot: { order, items },
      edited_by: actor.userId,
      edited_by_name: actor.fullName,
      change_summary: summaryLines.join(" · ") || "(no summary)",
    });

    // 7. Update order header
    const { error: hdrErr } = await admin.from("orders").update({
      amount: newAmount,
      gst_amount: newGst,
      total_amount: newTotal + Number(order.round_off_amount ?? 0),
      is_edited: true,
      edited_at: new Date().toISOString(),
      edited_by: actor.userId,
    }).eq("id", orderId);
    if (hdrErr) return { error: hdrErr.message };

    await logEvent(admin, orderId, "edited", actor, payload.comment, { summary: summaryLines });
    revalidatePath("/orders");
    return { ok: true, summary: summaryLines };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// =============================================================================
// CANCEL ORDER (soft cancel; usable by admin only)
// =============================================================================
export async function cancelOrder(orderId: string, reason: string) {
  try {
    if (!reason || reason.trim().length < 3) return { error: "Cancel reason required (min 3 chars)" };
    const actor = await requireRoles(["admin"]);
    const admin = createAdminClient();

    const { data: order } = await admin.from("orders").select("app_status").eq("id", orderId).single();
    if (!order) return { error: "Order not found" };
    if (["delivered", "closed", "rejected", "cancelled"].includes(order.app_status))
      return { error: `Cannot cancel — already ${order.app_status}` };

    const { error } = await admin.from("orders").update({
      app_status: "cancelled",
    }).eq("id", orderId);
    if (error) return { error: error.message };

    await logEvent(admin, orderId, "order_cancelled", actor, reason);
    revalidatePath("/orders");
    return { ok: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
