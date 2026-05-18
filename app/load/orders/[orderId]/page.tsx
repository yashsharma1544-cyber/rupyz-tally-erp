// =============================================================================
// /load/orders/[orderId] — per-order loading screen
//
// Auto-changes status from 'invoiced' to 'loading' when team opens.
// Shows order lines with pre-filled qty inputs (ordered qty).
// Team marks "All loaded" or edits qtys, then submits.
//
// Approved orders (no invoice yet) get a friendly gate explaining that billing
// needs to add an invoice first.
//
// i18n: this server-rendered shell reads language from cookie; the client
// child component reads from the i18n React context.
// =============================================================================

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Receipt } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LoadOrderClient } from "./load-order-client";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LoadOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/load/orders/${orderId}`);

  const { t } = await getT();

  const { data: me } = await supabase
    .from("app_users")
    .select("full_name, role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || !["admin", "dispatch"].includes(me.role)) {
    redirect("/load");
  }

  const { data: order } = await supabase
    .from("orders")
    .select(`
      id, rupyz_order_id, total_amount, app_status, invoice_number,
      customer:customers(id, name, city, mobile),
      items:order_items(id, product_name, qty, loaded_qty, price, unit)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (!order) notFound();

  // Friendly gate: approved order means billing hasn't entered the invoice yet.
  // Loading is blocked at the data layer; explain it here too so the loader
  // knows what to do.
  if (order.app_status === "approved") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div className="max-w-sm">
          <Link href="/load" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
            <ArrowLeft size={11}/> Back to queue
          </Link>
          <div className="w-12 h-12 mx-auto rounded-full bg-warn-soft text-warn flex items-center justify-center mb-3">
            <Receipt size={20}/>
          </div>
          <p className="font-semibold text-base mb-1">Waiting for invoice</p>
          <p className="text-sm text-ink-muted mb-3">
            This order hasn&apos;t been invoiced yet. Billing needs to enter the Tally
            invoice number before it can be loaded.
          </p>
          <Link
            href="/load"
            className="inline-block text-accent text-sm hover:underline"
          >
            ← Back to queue
          </Link>
        </div>
      </div>
    );
  }

  // Auto-status change: if invoiced, move to loading on open. This signals to
  // the rest of the team that someone is actively pulling the order.
  if (order.app_status === "invoiced") {
    const { error: updErr } = await supabase
      .from("orders")
      .update({ app_status: "loading" })
      .eq("id", orderId)
      .eq("app_status", "invoiced"); // Concurrency guard
    if (updErr) {
      console.error("Failed to auto-transition invoiced→loading:", updErr);
      // Continue — the user can still try to load, the action will fail with a clear error
    } else {
      order.app_status = "loading";
    }
  }

  // Show "already handled" for any state past loading.
  if (!["invoiced", "loading"].includes(order.app_status)) {
    const statusText = t(`status.${order.app_status}`);
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <Link href="/load" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
            <ArrowLeft size={11}/> {t("loading.back_to_queue")}
          </Link>
          <p className="font-semibold text-sm mb-1">{t("loading.already_handled")}</p>
          <p className="text-xs text-ink-muted mb-3">
            {t("loading.already_handled_desc", { status: statusText })}
          </p>
          <Link href="/load" className="text-accent text-sm">← {t("loading.back_to_queue_full")}</Link>
        </div>
      </div>
    );
  }

  const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;

  return (
    <LoadOrderClient
      order={{
        id: order.id,
        rupyzOrderId: order.rupyz_order_id,
        invoiceNumber: order.invoice_number ?? null,
        totalAmount: Number(order.total_amount),
        appStatus: order.app_status,
        customer: customer ? {
          id: customer.id,
          name: customer.name,
          city: customer.city,
          mobile: customer.mobile,
        } : null,
        items: (order.items ?? []).map((it: {
          id: string;
          product_name: string;
          qty: number;
          loaded_qty: number | null;
          price: number;
          unit: string | null;
        }) => ({
          id: it.id,
          productName: it.product_name,
          orderedQty: Number(it.qty),
          loadedQty: it.loaded_qty != null ? Number(it.loaded_qty) : null,
          price: Number(it.price),
          unit: it.unit,
        })),
      }}
    />
  );
}
