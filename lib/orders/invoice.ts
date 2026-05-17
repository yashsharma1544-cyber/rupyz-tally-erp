/**
 * Order invoice step — billing team enters Tally invoice number, order
 * advances from 'approved' to 'invoiced'. Required before 'loading'.
 *
 * Auth: admin OR billing role only.
 */

import { createClient } from "@/lib/supabase/server";

export type InvoiceActionResult = {
  ok: boolean;
  error?: string;
  order?: {
    id: string;
    invoice_number: string;
    invoiced_at: string;
    invoiced_by: string;
    app_status: string;
  };
};

async function requireBillingOrAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: me } = await supabase
    .from("app_users")
    .select("role, active, full_name")
    .eq("id", user.id)
    .single();
  if (!me?.active) throw new Error("Account inactive");
  if (me.role !== "admin" && me.role !== "billing") {
    throw new Error("Not authorized — billing or admin only");
  }
  return { supabase, userId: user.id, role: me.role as "admin" | "billing" };
}

/**
 * Set or update the invoice number on an order. If the order is currently
 * 'approved' it advances to 'invoiced'. If it's already 'invoiced',
 * the invoice number is overwritten (typo fix). Locked once it leaves
 * 'invoiced' state (i.e., after loading starts).
 */
export async function setInvoiceNumber(
  orderId: string,
  rawInvoiceNumber: string,
): Promise<InvoiceActionResult> {
  try {
    const { supabase, userId } = await requireBillingOrAdmin();

    const invoiceNumber = rawInvoiceNumber.trim();
    if (!invoiceNumber) {
      return { ok: false, error: "Invoice number is required" };
    }
    if (invoiceNumber.length > 50) {
      return { ok: false, error: "Invoice number is too long (max 50 chars)" };
    }

    // Snapshot current status to enforce allowed transitions
    const { data: existing, error: fetchErr } = await supabase
      .from("orders")
      .select("id, app_status, invoice_number")
      .eq("id", orderId)
      .single();
    if (fetchErr || !existing) {
      return { ok: false, error: fetchErr?.message || "Order not found" };
    }

    if (existing.app_status !== "approved" && existing.app_status !== "invoiced") {
      return {
        ok: false,
        error: `Cannot set invoice — order is '${existing.app_status}'. Allowed only when approved or invoiced.`,
      };
    }

    const nowIso = new Date().toISOString();

    const { data: updated, error: upErr } = await supabase
      .from("orders")
      .update({
        invoice_number: invoiceNumber,
        invoiced_at: nowIso,
        invoiced_by: userId,
        app_status: "invoiced",
      })
      .eq("id", orderId)
      .select("id, invoice_number, invoiced_at, invoiced_by, app_status")
      .single();

    if (upErr || !updated) {
      return { ok: false, error: upErr?.message || "Update failed" };
    }

    return { ok: true, order: updated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Clear the invoice number on an order (in case it was entered in error
 * before loading started). Reverts status from 'invoiced' to 'approved'.
 * Locked once loading has started.
 */
export async function clearInvoiceNumber(
  orderId: string,
): Promise<InvoiceActionResult> {
  try {
    const { supabase } = await requireBillingOrAdmin();

    const { data: existing, error: fetchErr } = await supabase
      .from("orders")
      .select("id, app_status")
      .eq("id", orderId)
      .single();
    if (fetchErr || !existing) {
      return { ok: false, error: fetchErr?.message || "Order not found" };
    }
    if (existing.app_status !== "invoiced") {
      return {
        ok: false,
        error: `Cannot clear invoice — order is '${existing.app_status}'. Loading already started.`,
      };
    }

    const { error: upErr } = await supabase
      .from("orders")
      .update({
        invoice_number: null,
        invoiced_at: null,
        invoiced_by: null,
        app_status: "approved",
      })
      .eq("id", orderId);

    if (upErr) return { ok: false, error: upErr.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Guard for the load action — call this from wherever loading is initiated.
 * Returns true if the order is ready to load (invoiced + has invoice_number).
 *
 * Usage in your existing load action:
 *   const ready = await assertReadyToLoad(orderId);
 *   if (!ready.ok) return { ok: false, error: ready.error };
 *   // ...proceed with load
 */
export async function assertReadyToLoad(
  orderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("app_status, invoice_number")
    .eq("id", orderId)
    .single();
  if (error || !order) {
    return { ok: false, error: error?.message || "Order not found" };
  }
  if (order.app_status !== "invoiced") {
    return {
      ok: false,
      error: `Order must be invoiced before loading. Current status: ${order.app_status}.`,
    };
  }
  if (!order.invoice_number) {
    return { ok: false, error: "Invoice number is missing." };
  }
  return { ok: true };
}
