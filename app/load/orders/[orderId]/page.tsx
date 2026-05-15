// =============================================================================
// /load/orders/[orderId] — per-order loading screen
//
// Auto-changes status from 'approved' to 'loading' when team opens.
// Shows order lines with pre-filled qty inputs (ordered qty).
// Team marks "All loaded" or edits qtys, then submits.
//
// i18n: this server-rendered shell reads language from cookie; the client
// child component reads from the i18n React context.
// =============================================================================

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
      id, rupyz_order_id, total_amount, app_status,
      customer:customers(id, name, city, mobile),
      items:order_items(id, product_name, qty, loaded_qty, price, unit)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (!order) notFound();

  // Auto-status change: if approved, move to loading on open.
  // This happens server-side so the next time anyone loads this page they see
  // it as already being worked on.
  if (order.app_status === "approved") {
    const { error: updErr } = await supabase
      .from("orders")
      .update({ app_status: "loading" })
      .eq("id", orderId)
      .eq("app_status", "approved"); // Concurrency guard: don't overwrite if someone else moved it
    if (updErr) {
      console.error("Failed to auto-transition approved→loading:", updErr);
      // Continue — the user can still try to load, the action will fail with a clear error
    } else {
      order.app_status = "loading";
    }
  }

  // Show "already handled" if order is past loading state.
  if (!["approved", "loading"].includes(order.app_status)) {
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
