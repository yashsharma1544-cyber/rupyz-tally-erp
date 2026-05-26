// =============================================================================
// /dispatch/load-truck — vehicle-first truck loading wizard
//
// Step 1: pick the vehicle (managed list, inline add) + the loaders (people
//         loading the vehicle: van_helper + dispatch roles).
// Step 2: pick the orders (grouped by beat).
// Driver/helper are NOT chosen here — they're captured later at "Vehicle left".
//
// Loads ALL approved/partly-dispatched/loaded Jalna orders, grouped by beat.
// Optional ?beat=<id> hints which beat section to expand by default.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LoadTruckWizard } from "./load-truck-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_BEAT_ID = "00000000-0000-0000-0000-000000000000";

interface OrderRow {
  id: string;
  rupyz_order_id: string;
  total_amount: number;
  app_status: string;
  customer: { id: string; name: string; city: string | null; beat_id: string | null } | null;
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

function isJalna(city: string | null | undefined): boolean {
  if (!city) return false;
  return city.trim().toLowerCase() === "jalna";
}

export default async function LoadTruckPage({
  searchParams,
}: {
  searchParams: Promise<{ beat?: string }>;
}) {
  const { beat: focusBeatId } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?from=/dispatch/load-truck${focusBeatId ? `?beat=${focusBeatId}` : ""}`);

  const { data: me } = await supabase.from("app_users").select("full_name, role, active").eq("id", user.id).single();
  if (!me?.active || !["admin", "dispatch"].includes(me.role)) redirect("/dispatch");

  const { data: beats } = await supabase
    .from("beats")
    .select("id, name")
    .order("name");

  const { data: orders, error } = await supabase
    .from("orders")
    .select(`
      id, rupyz_order_id, total_amount, app_status,
      customer:customers!inner(id, name, city, beat_id),
      items:order_items(qty, total_dispatched_qty, unit, packaging_size, packaging_unit)
    `)
    .in("app_status", ["approved", "partially_dispatched", "loaded"])
    .order("rupyz_created_at", { ascending: false });
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <p className="font-semibold text-sm mb-1">Couldn&apos;t load orders</p>
          <p className="text-xs text-ink-muted mb-3">{error.message}</p>
          <Link href="/dispatch" className="text-accent text-sm">← Back</Link>
        </div>
      </div>
    );
  }
  const orderRows = (orders ?? []) as unknown as OrderRow[];

  // Jalna filter — applied to customer.city
  const filteredOrderRows = orderRows.filter(o => isJalna(o.customer?.city));

  const byBeat = new Map<string, { beatId: string; beatName: string; orders: Array<{
    id: string; rupyzOrderId: string; totalAmount: number; appStatus: string;
    customerName: string; customerCity: string | null; kg: number;
  }>}>();

  const beatNameMap = new Map<string, string>((beats ?? []).map(b => [b.id, b.name]));

  for (const o of filteredOrderRows) {
    const beatId = o.customer?.beat_id ?? NO_BEAT_ID;
    const beatName = beatId === NO_BEAT_ID ? "No beat assigned" : (beatNameMap.get(beatId) ?? "Unknown beat");
    if (!byBeat.has(beatId)) {
      byBeat.set(beatId, { beatId, beatName, orders: [] });
    }
    byBeat.get(beatId)!.orders.push({
      id: o.id,
      rupyzOrderId: o.rupyz_order_id,
      totalAmount: Number(o.total_amount),
      appStatus: o.app_status,
      customerName: o.customer?.name ?? "—",
      customerCity: o.customer?.city ?? null,
      kg: kgForItems(o.items ?? []),
    });
  }

  const beatGroups = Array.from(byBeat.values()).sort((a, b) => {
    if (a.beatId === NO_BEAT_ID) return -1;
    if (b.beatId === NO_BEAT_ID) return 1;
    return a.beatName.localeCompare(b.beatName);
  });

  // Vehicles — managed list for the dropdown
  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, number, make, capacity_kg")
    .eq("active", true)
    .order("number");
  const vehicleList = (vehicles ?? []) as Array<{ id: string; number: string; make: string | null; capacity_kg: number | null }>;

  // Loaders — people who physically load the vehicle (van_helper + dispatch)
  const { data: loaders } = await supabase
    .from("app_users")
    .select("id, full_name, phone, role")
    .in("role", ["van_helper", "dispatch"])
    .eq("active", true)
    .order("full_name");
  const loaderList = (loaders ?? []) as Array<{ id: string; full_name: string; phone: string | null; role: string }>;

  return (
    <LoadTruckWizard
      beatGroups={beatGroups}
      focusBeatId={focusBeatId ?? null}
      vehicles={vehicleList.map(v => ({ id: v.id, number: v.number, make: v.make, capacityKg: v.capacity_kg }))}
      loaders={loaderList.map(l => ({ id: l.id, name: l.full_name, phone: l.phone, role: l.role }))}
    />
  );
}
