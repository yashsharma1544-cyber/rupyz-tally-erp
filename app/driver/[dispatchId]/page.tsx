// =============================================================================
// /driver/[dispatchId] — driver opens a stop to deliver
//
// Loads the dispatch + its order + items + customer, then hands off to the
// client component which renders POD capture + Mark delivered flow.
//
// Authorization: dispatch must be assigned to the current user (or admin).
// =============================================================================

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DriverStopClient } from "./stop-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DriverStopPage({
  params,
}: {
  params: Promise<{ dispatchId: string }>;
}) {
  const { dispatchId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/driver/${dispatchId}`);

  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active) redirect("/login");
  if (me.role !== "driver" && me.role !== "admin") redirect("/dashboard");

  const { data: dispatch } = await supabase
    .from("dispatches")
    .select(`
      id, status, vehicle_number, driver_name, driver_user_id,
      total_qty, total_amount, notes,
      order:orders(
        id, rupyz_order_id, total_amount, app_status,
        customer:customers(id, name, city, mobile, address, beat:beats(name))
      ),
      items:dispatch_items(
        id, qty, price,
        order_item:order_items(product_name, unit, packaging_size, packaging_unit)
      )
    `)
    .eq("id", dispatchId)
    .maybeSingle();

  if (!dispatch) notFound();

  // Authorization: must be assigned to this driver (or admin)
  if (me.role === "driver" && dispatch.driver_user_id !== user.id) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <p className="font-semibold text-sm mb-1">Not assigned to you</p>
          <p className="text-xs text-ink-muted mb-3">This delivery isn&apos;t on your truck.</p>
          <Link href="/driver" className="text-accent text-sm">← Back to my deliveries</Link>
        </div>
      </div>
    );
  }

  // Already-delivered or cancelled — show terminal state
  if (dispatch.status === "delivered" || dispatch.status === "cancelled") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <p className="font-semibold text-sm mb-1">
            {dispatch.status === "delivered" ? "Already delivered" : "Cancelled"}
          </p>
          <Link href="/driver" className="text-accent text-sm">← Back to my deliveries</Link>
        </div>
      </div>
    );
  }

  const order = Array.isArray(dispatch.order) ? dispatch.order[0] : dispatch.order;
  const customer = order?.customer
    ? (Array.isArray(order.customer) ? order.customer[0] : order.customer)
    : null;
  const beatRel = customer?.beat;
  const beat = Array.isArray(beatRel) ? beatRel[0] : beatRel;

  return (
    <DriverStopClient
      dispatch={{
        id: dispatch.id,
        status: dispatch.status,
        vehicleNumber: dispatch.vehicle_number,
        driverName: dispatch.driver_name,
        totalQty: Number(dispatch.total_qty),
        totalAmount: Number(dispatch.total_amount),
        notes: dispatch.notes,
        rupyzOrderId: order?.rupyz_order_id ?? "—",
        customer: {
          name: customer?.name ?? "—",
          city: customer?.city ?? null,
          mobile: customer?.mobile ?? null,
          address: customer?.address ?? null,
          beatName: beat?.name ?? null,
        },
        items: ((dispatch.items ?? []) as Array<{ id: string; qty: number; price: number; order_item: { product_name: string; unit: string | null } | { product_name: string; unit: string | null }[] | null }>).map(it => {
          const oi = Array.isArray(it.order_item) ? it.order_item[0] : it.order_item;
          return {
            id: it.id,
            productName: oi?.product_name ?? "—",
            qty: Number(it.qty),
            price: Number(it.price),
            unit: oi?.unit ?? null,
          };
        }),
      }}
    />
  );
}
