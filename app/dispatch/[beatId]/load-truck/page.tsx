// =============================================================================
// /dispatch/[beatId]/load-truck — wizard for "load multiple orders on a truck"
//
// Two-step wizard:
//   Step 1: pick which orders go on this truck
//   Step 2: enter vehicle/driver, confirm
//
// All client-side state — server just loads candidate orders.
// =============================================================================

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LoadTruckWizard } from "./load-truck-client";

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
    const remaining = Number(it.qty) - Number(it.total_dispatched_qty ?? 0);
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

export default async function LoadTruckPage({ params }: { params: Promise<{ beatId: string }> }) {
  const { beatId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/dispatch/${beatId}/load-truck`);

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
          <Link href={`/dispatch/${beatId}`} className="text-accent text-sm">← Back to beat</Link>
        </div>
      </div>
    );
  }
  const orderRows = (orders ?? []) as unknown as OrderRow[];

  return (
    <LoadTruckWizard
      beat={beat as { id: string; name: string }}
      orders={orderRows.map(o => ({
        id: o.id,
        rupyzOrderId: o.rupyz_order_id,
        totalAmount: Number(o.total_amount),
        appStatus: o.app_status,
        customerName: o.customer?.name ?? "—",
        customerCity: o.customer?.city ?? null,
        kg: kgForItems(o.items ?? []),
      }))}
    />
  );
}
