// =============================================================================
// /dispatch/[beatId]/[orderId] — per-order dispatch screen
// =============================================================================

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { OrderDispatchClient } from "./order-dispatch-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrderDispatchPage({
  params,
}: {
  params: Promise<{ beatId: string; orderId: string }>;
}) {
  const { beatId, orderId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/dispatch/${beatId}/${orderId}`);

  const { data: me } = await supabase.from("app_users").select("full_name, role, active").eq("id", user.id).single();
  if (!me?.active || !["admin", "dispatch"].includes(me.role)) redirect("/dispatch");

  // Fetch order + drivers + helpers in parallel
  const [{ data: order }, { data: drivers }, { data: helpers }] = await Promise.all([
    supabase
      .from("orders")
      .select(`
        id, rupyz_order_id, total_amount, app_status,
        customer:customers(id, name, city, mobile),
        items:order_items(id, product_name, qty, total_dispatched_qty, price, unit, packaging_size, packaging_unit)
      `)
      .eq("id", orderId)
      .maybeSingle(),
    supabase
      .from("app_users")
      .select("id, full_name, phone")
      .eq("role", "driver")
      .eq("active", true)
      .order("full_name"),
    supabase
      .from("app_users")
      .select("id, full_name, phone")
      .eq("role", "van_helper")
      .eq("active", true)
      .order("full_name"),
  ]);

  if (!order) notFound();

  if (!["approved", "partially_dispatched", "loaded"].includes(order.app_status)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <p className="font-semibold text-sm mb-1">Already handled</p>
          <p className="text-xs text-ink-muted mb-3">
            This order is &ldquo;{order.app_status}&rdquo; — nothing to dispatch.
          </p>
          <Link href={`/dispatch/${beatId}`} className="text-accent text-sm">← Back to beat</Link>
        </div>
      </div>
    );
  }

  return (
    <OrderDispatchClient
      beatId={beatId}
      order={{
        id: order.id,
        rupyzOrderId: order.rupyz_order_id,
        totalAmount: Number(order.total_amount),
        appStatus: order.app_status,
        customer: Array.isArray(order.customer) ? order.customer[0] : order.customer,
        items: (order.items ?? []).map((it: { id: string; product_name: string; qty: number; total_dispatched_qty: number | null; price: number; unit: string | null; packaging_size: number | null; packaging_unit: string | null }) => ({
          id: it.id,
          productName: it.product_name,
          orderedQty: Number(it.qty),
          alreadyDispatched: Number(it.total_dispatched_qty ?? 0),
          remaining: Number(it.qty) - Number(it.total_dispatched_qty ?? 0),
          price: Number(it.price),
          unit: it.unit,
        })),
      }}
      drivers={(drivers ?? []).map(d => ({
        id: d.id,
        name: d.full_name,
        phone: d.phone ?? null,
      }))}
      helpers={(helpers ?? []).map(h => ({
        id: h.id,
        name: h.full_name,
        phone: h.phone ?? null,
      }))}
    />
  );
}
