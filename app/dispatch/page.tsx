// =============================================================================
// /dispatch — godown dispatch home (desktop redesign)
//
// Same data + vehicle-first flow as before. Presentation reflowed to the
// /orders desktop language: PageHeader + KPI cards + a bordered beats table.
// Sits inside the sidebar shell on desktop; still works on mobile.
//
// Auth: admin and dispatch only.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { Truck, ChevronRight, MapPin, Package, IndianRupee } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { TrucksLoadingPanel } from "./trucks-loading-panel";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
}

interface BeatRow {
  beat_id: string;
  beat_name: string;
  order_count: number;
  total_kg: number;
  total_amount: number;
}

interface TruckRow {
  load_id: string;
  vehicle_number: string;
  vehicle_id: string;
  loaders: string;
  dispatch_count: number;
  order_count: number;
  total_qty: number;
  total_amount: number;
  oldest_loaded_at: string;
  dispatch_ids: string[];
}

export default async function DispatchHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/dispatch");

  const { t } = await getT();

  const { data: me } = await supabase.from("app_users").select("full_name, role, active").eq("id", user.id).single();
  if (!me?.active) redirect("/login");
  if (!["admin", "dispatch"].includes(me.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <h1 className="font-semibold text-base mb-1">{t("common.not_authorized")}</h1>
          <p className="text-sm text-ink-muted mb-4">{t("dispatch.role_required")}</p>
          <Link href="/dashboard" className="text-accent text-sm">{t("common.go_to_dashboard")}</Link>
        </div>
      </div>
    );
  }

  const [{ data: kpis }, { data: trucks }] = await Promise.all([
    supabase.rpc("dispatch_kpis_by_beat"),
    supabase.rpc("trucks_loading"),
  ]);
  const beatRows = (kpis ?? []) as BeatRow[];
  const truckRows = (trucks ?? []) as TruckRow[];

  const allDispatchIds = truckRows.flatMap(t => t.dispatch_ids);
  const truckOrdersByLoad = new Map<string, Array<{
    orderId: string;
    rupyzOrderId: string;
    customerName: string;
    beatName: string | null;
    qty: number;
    amount: number;
  }>>();

  if (allDispatchIds.length > 0) {
    const { data: dispatches } = await supabase
      .from("dispatches")
      .select(`
        id, load_id, total_qty, total_amount,
        order:orders(
          id, rupyz_order_id,
          customer:customers(name, beat:beats(name))
        )
      `)
      .in("id", allDispatchIds);

    for (const d of (dispatches ?? []) as Array<{
      id: string;
      load_id: string | null;
      total_qty: number;
      total_amount: number;
      order: { id: string; rupyz_order_id: string; customer: { name: string; beat: { name: string } | { name: string }[] | null } | { name: string; beat: { name: string } | { name: string }[] | null }[] | null } | { id: string; rupyz_order_id: string; customer: { name: string; beat: { name: string } | { name: string }[] | null } | { name: string; beat: { name: string } | { name: string }[] | null }[] | null }[] | null;
    }>) {
      const key = d.load_id ?? "";
      const order = Array.isArray(d.order) ? d.order[0] : d.order;
      if (!order) continue;
      const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;
      const beatRel = customer?.beat;
      const beat = Array.isArray(beatRel) ? beatRel[0] : beatRel;
      if (!truckOrdersByLoad.has(key)) truckOrdersByLoad.set(key, []);
      truckOrdersByLoad.get(key)!.push({
        orderId: order.id,
        rupyzOrderId: order.rupyz_order_id,
        customerName: customer?.name ?? "—",
        beatName: beat?.name ?? null,
        qty: Number(d.total_qty),
        amount: Number(d.total_amount),
      });
    }
  }

  // Driver/helper pool for the "Vehicle left" dialog: driver + van_helper users
  const { data: people } = await supabase
    .from("app_users")
    .select("id, full_name, phone, role")
    .in("role", ["driver", "van_helper"])
    .eq("active", true)
    .order("full_name");
  const peopleList = (people ?? []).map(p => ({ id: p.id, name: p.full_name, phone: p.phone, role: p.role }));

  const totalOrders = beatRows.reduce((s, b) => s + Number(b.order_count), 0);
  const totalKg     = beatRows.reduce((s, b) => s + Number(b.total_kg), 0);
  const totalAmount = beatRows.reduce((s, b) => s + Number(b.total_amount), 0);

  const beatsCount = beatRows.length;
  const acrossBeatsLabel = beatsCount === 1
    ? t("dispatch.across_n_beats_one", { n: beatsCount.toLocaleString("en-IN") })
    : t("dispatch.across_n_beats", { n: beatsCount.toLocaleString("en-IN") });

  const ordersWord = t("dispatch.orders_word");

  return (
    <>
      <PageHeader
        title={t("dispatch.page_title")}
        subtitle={me.full_name}
        actions={
          beatRows.length > 0 ? (
            <Link href="/load">
              <Button size="sm"><Truck size={14} /> {t("dispatch.load_a_truck")}</Button>
            </Link>
          ) : undefined
        }
      />

      <div className="p-3 sm:p-6">
        {/* KPI cards */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-2 max-w-2xl">
          <KpiTile icon={Package}     label={t("dispatch.kpi_orders")} value={totalOrders.toLocaleString("en-IN")} />
          <KpiTile icon={Package}     label={t("dispatch.kpi_total")}  value={formatKg(totalKg)} />
          <KpiTile icon={IndianRupee} label={t("dispatch.kpi_value")}  value={formatINR(totalAmount)} />
        </div>
        <p className="text-2xs text-ink-subtle mb-5">{acrossBeatsLabel}</p>

        {/* Trucks currently loading */}
        {truckRows.length > 0 && (
          <div className="mb-6 max-w-3xl">
            <TrucksLoadingPanel
              people={peopleList}
              trucks={truckRows.map(t => ({
                loadId: t.load_id,
                vehicleNumber: t.vehicle_number,
                loaders: t.loaders,
                dispatchCount: Number(t.dispatch_count),
                orderCount: Number(t.order_count),
                totalQty: Number(t.total_qty),
                totalAmount: Number(t.total_amount),
                oldestLoadedAt: t.oldest_loaded_at,
                orders: truckOrdersByLoad.get(t.load_id) ?? [],
              }))}
            />
          </div>
        )}

        {/* Approved & ready to load — beats table */}
        <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold mb-2">
          {t("dispatch.approved_ready_to_load")}
        </h2>

        {beatRows.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-8 text-center max-w-2xl">
            <Truck size={28} className="mx-auto text-ink-subtle mb-2" />
            <p className="font-semibold text-sm mb-0.5">{t("dispatch.nothing_to_dispatch")}</p>
            <p className="text-xs text-ink-muted">{t("dispatch.empty_desc")}</p>
          </div>
        ) : (
          <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden max-w-3xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-paper-subtle/60 border-b border-paper-line">
                  <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-2.5 font-medium">Beat</th>
                    <th className="px-3 py-2.5 font-medium text-right">{ordersWord}</th>
                    <th className="px-3 py-2.5 font-medium text-right">Total</th>
                    <th className="px-3 py-2.5 font-medium text-right">Value</th>
                    <th className="px-3 py-2.5 font-medium text-right w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-line">
                  {beatRows.map(b => (
                    <tr key={b.beat_id} className="hover:bg-paper-subtle/40 transition-colors">
                      <td className="px-3 py-3">
                        <Link href={`/dispatch/${b.beat_id}`} className="font-medium inline-flex items-center gap-2 hover:text-accent">
                          <span className="w-7 h-7 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
                            <MapPin size={13} />
                          </span>
                          {b.beat_name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right tabular">{b.order_count}</td>
                      <td className="px-3 py-3 text-right tabular">{formatKg(b.total_kg)}</td>
                      <td className="px-3 py-3 text-right tabular font-medium">{formatINR(b.total_amount)}</td>
                      <td className="px-3 py-3 text-right">
                        <Link href={`/dispatch/${b.beat_id}`} className="text-accent inline-flex items-center gap-1 hover:underline">
                          Open <ChevronRight size={13} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-6 text-2xs text-ink-subtle lg:hidden">
          <Link href="/" className="hover:text-ink-muted">← {t("common.back_to_main")}</Link>
        </div>

        <AutoRefresh />
      </div>
    </>
  );
}

function KpiTile({
  icon: Icon, label, value,
}: { icon: typeof Package; label: string; value: string }) {
  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="p-1 rounded bg-accent-soft">
          <Icon size={12} className="text-accent" />
        </span>
        <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium leading-tight">{label}</span>
      </div>
      <div className="text-lg sm:text-xl font-bold tabular truncate">{value}</div>
    </div>
  );
}
