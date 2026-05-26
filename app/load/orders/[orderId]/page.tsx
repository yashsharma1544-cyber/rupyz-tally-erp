// =============================================================================
// /load/orders/[orderId] — per-order loading screen (vehicle-aware)
//
// Requires an active load session (?load=<vehicleLoadId>). Shows order lines
// with pre-filled qty inputs (ordered qty). Team marks "All loaded" or edits
// qtys, then submits → markOrderLoaded creates a pending dispatch on that
// vehicle load and sets the order to 'loaded' (or 'partially_dispatched').
//
// Approved orders (no invoice yet) get a friendly gate: billing must invoice.
// =============================================================================

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Receipt, Truck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LoadOrderClient } from "./load-order-client";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LoadOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ load?: string }>;
}) {
  const { orderId } = await params;
  const { load: loadId } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/load/orders/${orderId}${loadId ? `?load=${loadId}` : ""}`);

  const { t } = await getT();

  const { data: me } = await supabase
    .from("app_users")
    .select("full_name, role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || !["admin", "dispatch"].includes(me.role)) {
    redirect("/load");
  }

  // Must have an active load session
  if (!loadId) {
    redirect("/load");
  }
  const { data: vl } = await supabase
    .from("vehicle_loads")
    .select("id, status, vehicles(number)")
    .eq("id", loadId)
    .maybeSingle();
  if (!vl || vl.status !== "loading") {
    redirect("/load");
  }
  const vehicleNumber = Array.isArray(vl.vehicles)
    ? (vl.vehicles[0] as { number?: string } | undefined)?.number
    : (vl.vehicles as { number?: string } | null)?.number;

  const { data: order } = await supabase
    .from("orders")
    .select(`
      id, rupyz_order_id, total_amount, app_status, invoice_number,
      customer:customers(id, name, city, mobile),
      items:order_items(id, product_name, qty, loaded_qty, total_dispatched_qty, price, unit)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (!order) notFound();

  // Friendly gate: approved order means billing hasn't entered the invoice yet.
  if (order.app_status === "approved") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div className="max-w-sm">
          <Link href={`/load?load=${loadId}`} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
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
          <Link href={`/load?load=${loadId}`} className="inline-block text-accent text-sm hover:underline">
            ← Back to queue
          </Link>
        </div>
      </div>
    );
  }

  // Only invoiced / loaded / partially_dispatched orders can be loaded onto a vehicle.
  if (!["invoiced", "loading", "loaded", "partially_dispatched"].includes(order.app_status)) {
    const statusText = t(`status.${order.app_status}`);
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <Link href={`/load?load=${loadId}`} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
            <ArrowLeft size={11}/> {t("loading.back_to_queue")}
          </Link>
          <p className="font-semibold text-sm mb-1">{t("loading.already_handled")}</p>
          <p className="text-xs text-ink-muted mb-3">{t("loading.already_handled_desc", { status: statusText })}</p>
          <Link href={`/load?load=${loadId}`} className="text-accent text-sm">← {t("loading.back_to_queue_full")}</Link>
        </div>
      </div>
    );
  }

  const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;

  return (
    <LoadOrderClient
      loadId={loadId}
      vehicleNumber={vehicleNumber ?? "—"}
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
          total_dispatched_qty: number | null;
          price: number;
          unit: string | null;
        }) => {
          const remaining = Number(it.qty) - Number(it.total_dispatched_qty ?? 0);
          return {
            id: it.id,
            productName: it.product_name,
            orderedQty: remaining > 0 ? remaining : 0,
            loadedQty: it.loaded_qty != null ? Number(it.loaded_qty) : null,
            price: Number(it.price),
            unit: it.unit,
          };
        }).filter((it: { orderedQty: number }) => it.orderedQty > 0),
      }}
    />
  );
}
