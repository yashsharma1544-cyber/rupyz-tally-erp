// =============================================================================
// /dispatch/[beatId] — orders list for one beat
//
// Special case: beatId = '00000000-0000-0000-0000-000000000000' is a synthetic
// UUID for the "No beat assigned" tile. We don't look that up in beats table;
// instead we fetch orders where customer.beat_id IS NULL.
//
// Filtered to Jalna area only (beat.city = jalna OR customer.city = jalna,
// case-insensitive).
// =============================================================================
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BeatDispatchClient } from "./beat-dispatch-client";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_BEAT_ID = "00000000-0000-0000-0000-000000000000";

interface OrderRow {
  id: string;
  rupyz_order_id: string;
  total_amount: number;
  app_status: string;
  customer: { id: string; name: string; city: string | null } | null;
  items: { qty: number; total_dispatched_qty: number | null; unit: string | null; packaging_size: number | null; packaging_unit: string | null }[];
}

function isJalna(city: string | null | undefined): boolean {
  if (!city) return false;
  return city.trim().toLowerCase() === "jalna";
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

  // SPECIAL CASE: "No beat assigned" synthetic tile
  const isNoBeatTile = beatId === NO_BEAT_ID;

  // Real beat lookup (skip for synthetic)
  let beat: { id: string; name: string; city: string | null };
  if (isNoBeatTile) {
    beat = { id: NO_BEAT_ID, name: "No beat assigned", city: null };
  } else {
    const { data } = await supabase.from("beats").select("id, name, city").eq("id", beatId).maybeSingle();
    if (!data) notFound();
    beat = data;
  }

  // Build orders query — different filter depending on synthetic vs real
  let ordersQuery = supabase
    .from("orders")
    .select(`
      id, rupyz_order_id, total_amount, app_status,
      customer:customers!inner(id, name, city, beat_id),
      items:order_items(qty, total_dispatched_qty, unit, packaging_size, packaging_unit)
    `)
    .in("app_status", ["approved", "partially_dispatched", "loaded"]);

  if (isNoBeatTile) {
    // Fetch orders where customer has NO beat
    ordersQuery = ordersQuery.is("customer.beat_id", null);
  } else {
    ordersQuery = ordersQuery.eq("customer.beat_id", beatId);
  }

  const [{ data: orders, error }, { data: helpers }] = await Promise.all([
    ordersQuery.order("rupyz_created_at", { ascending: false }),
    supabase
      .from("app_users")
      .select("id, full_name, phone")
      .eq("role", "van_helper")
      .eq("active", true)
      .order("full_name"),
  ]);

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
  const allOrders = (orders ?? []) as unknown as OrderRow[];

  // Filter to Jalna. For the no-beat tile, beat.city is null so we MUST check
  // customer.city. For real beats, either side suffices.
  const orderRows = allOrders.filter(o =>
    isJalna(beat.city) || isJalna(o.customer?.city)
  );

  return (
    <BeatDispatchClient
      beat={{ id: beat.id, name: beat.name }}
      isNoBeatTile={isNoBeatTile}
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
      helpers={(helpers ?? []).map(h => ({
        id: h.id,
        name: h.full_name,
        phone: h.phone ?? null,
      }))}
    />
  );
}
