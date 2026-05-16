// =============================================================================
// /dispatch/load-truck — cross-beat truck loading wizard
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LoadTruckWizard } from "./load-truck-client";
import { getT } from "@/lib/i18n/server";

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

  const { t } = await getT();

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
          <p className="font-semibold text-sm mb-1">{t("truck_wizard.couldnt_load")}</p>
          <p className="text-xs text-ink-muted mb-3">{error.message}</p>
          <Link href="/dispatch" className="text-accent text-sm">← {t("truck_wizard.back")}</Link>
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
  const noBeatLabel = t("loading.no_beat_assigned");

  for (const o of filteredOrderRows) {
    const beatId = o.customer?.beat_id ?? NO_BEAT_ID;
    const beatName = beatId === NO_BEAT_ID ? noBeatLabel : (beatNameMap.get(beatId) ?? "Unknown beat");
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

  // Sort: no-beat group first, then real beats alphabetically
  const beatGroups = Array.from(byBeat.values()).sort((a, b) => {
    if (a.beatId === NO_BEAT_ID) return -1;
    if (b.beatId === NO_BEAT_ID) return 1;
    return a.beatName.localeCompare(b.beatName);
  });

  const { data: drivers } = await supabase
    .from("active_drivers")
    .select("id, full_name, phone")
    .order("full_name");
  const driverList = (drivers ?? []) as Array<{ id: string; full_name: string; phone: string | null }>;

  const { data: helpers } = await supabase
    .from("app_users")
    .select("id, full_name, phone")
    .eq("role", "van_helper")
    .eq("active", true)
    .order("full_name");
  const helperList = (helpers ?? []) as Array<{ id: string; full_name: string; phone: string | null }>;

  return (
    <LoadTruckWizard
      beatGroups={beatGroups}
      focusBeatId={focusBeatId ?? null}
      drivers={driverList.map(d => ({ id: d.id, name: d.full_name, phone: d.phone }))}
      helpers={helperList.map(h => ({ id: h.id, name: h.full_name, phone: h.phone }))}
    />
  );
}
