// =============================================================================
// /dispatch/[beatId] — orders list for one beat
//
// Shows every approved/partially-dispatched order in this beat. Each order is
// tappable and goes to the per-order dispatch screen.
//
// At the top there's a "Dispatch all" button that opens a modal to capture
// vehicle/driver and dispatches every order in this beat at remaining qty.
// =============================================================================

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BeatDispatchClient } from "./beat-dispatch-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface OrderRow {
  id: string;
  rupyz_order_id: string;
  total_amount: number;
  app_status: string;
  customer: { id: string; name: string; city: string | null } | null;
  items: { qty: number; total_dispatched_qty: number | null; unit: string | null; packaging_size: number | null; packaging_unit: string | null }[];
}

function kgForItems(items: OrderRow["items"]): number {
  let total = 0;
  for (const it of items) {
    const qty = Number(it.qty);
    const remaining = qty - Number(it.total_dispatched_qty ?? 0);
    if (remaining <= 0) continue;
    const unit = (it.unit ?? "").toLowerCase();
    const pUnit = (it.packaging_unit ?? "").toLowerCase();
    const pSize = Number(it.packaging_size ?? 0);
    if (unit === "kg") total += remaining;
    else if (unit === "g" || unit === "gm" || unit.startsWith("gram")) total += remaining / 1000;
    else if (pUnit === "kg") total += remaining * pSize;
    else if (pUnit === "g" || pUnit === "gm" || pUnit.startsWith("gram")) total += (remaining * pSize) / 1000;
  }
  return total;
}

export default async function BeatDispatchPage({ params }: { params: Promise<{ beatId: string }> }) {
  const { beatId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/dispatch/${beatId}`);

  const { data: me } = await supabase.from("app_users").select("full_name, role, active").eq("id", user.id).single();
  if (!me?.active || !["admin", "dispatch"].includes(me.role)) redirect("/dispatch");

  const { data: beat } = await supabase.from("beats").select("id, name").eq("id", beatId).maybeSingle();
  if (!beat) notFound();

  const { data: orders, error } = await supabase
    .from("orders")
    .select(`
      id, rupyz_order_id, total_amount, app_status,
      customer:customers!inner(id, name, city, beat_id),
      items:order_items(qty, total_dispatched_qty, unit, packaging_size, packaging_unit)
    `)
    .in("app_status", ["approved", "partially_dispatched"])
    .eq("customer.beat_id", beatId)
    .order("rupyz_created_at", { ascending: false });
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <p className="font-semibold text-sm mb-1">Couldn&apos;t load orders</p>
          <p className="text-xs text-ink-muted mb-3">{error.message}</p>
          <Link href="/dispatch" className="text-accent text-sm">← Back to beats</Link>
        </div>
      </div>
    );
  }
  const orderRows = (orders ?? []) as unknown as OrderRow[];

  return (
    <BeatDispatchClient
      beat={beat as { id: string; name: string }}
      orders={orderRows.map(o => ({
        id: o.id,
        rupyzOrderId: o.rupyz_order_id,
        totalAmount: Number(o.total_amount),
        appStatus: o.app_status,
        customerName: o.customer?.name ?? "—",
        customerCity: o.customer?.city ?? null,
        kg: kgForItems(o.items ?? []),
        itemCount: (o.items ?? []).length,
      }))}
    />
  );
}
