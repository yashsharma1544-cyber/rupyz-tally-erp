// =============================================================================
// /dispatch — godown dispatch app home
//
// Mobile-first PWA at /dispatch. Shows beats with approved orders, each as a
// big tappable tile with order count + kg + amount.
//
// Auth: admin and dispatch only.
// i18n: server component, reads cookie via getT().
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { Truck, ChevronRight, MapPin, Package, IndianRupee } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { TrucksLoadingPanel } from "./trucks-loading-panel";
import { AutoRefresh } from "@/components/auto-refresh";
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
  vehicle_number: string;
  driver_name: string;
  driver_phone: string;
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
  const truckOrdersByKey = new Map<string, Array<{
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
        id, vehicle_number, driver_name, total_qty, total_amount,
        order:orders(
          id, rupyz_order_id,
          customer:customers(name, beat:beats(name))
        )
      `)
      .in("id", allDispatchIds);

    for (const d of (dispatches ?? []) as Array<{
      id: string;
      vehicle_number: string | null;
      driver_name: string | null;
      total_qty: number;
      total_amount: number;
      order: { id: string; rupyz_order_id: string; customer: { name: string; beat: { name: string } | { name: string }[] | null } | { name: string; beat: { name: string } | { name: string }[] | null }[] | null } | { id: string; rupyz_order_id: string; customer: { name: string; beat: { name: string } | { name: string }[] | null } | { name: string; beat: { name: string } | { name: string }[] | null }[] | null }[] | null;
    }>) {
      const key = `${d.vehicle_number ?? ""}::${d.driver_name ?? ""}`;
      const order = Array.isArray(d.order) ? d.order[0] : d.order;
      if (!order) continue;
      const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer;
      const beatRel = customer?.beat;
      const beat = Array.isArray(beatRel) ? beatRel[0] : beatRel;
      if (!truckOrdersByKey.has(key)) truckOrdersByKey.set(key, []);
      truckOrdersByKey.get(key)!.push({
        orderId: order.id,
        rupyzOrderId: order.rupyz_order_id,
        customerName: customer?.name ?? "—",
        beatName: beat?.name ?? null,
        qty: Number(d.total_qty),
        amount: Number(d.total_amount),
      });
    }
  }

  const totalOrders = beatRows.reduce((s, b) => s + Number(b.order_count), 0);
  const totalKg     = beatRows.reduce((s, b) => s + Number(b.total_kg), 0);
  const totalAmount = beatRows.reduce((s, b) => s + Number(b.total_amount), 0);

  const beatsCount = beatRows.length;
  const acrossBeatsLabel = beatsCount === 1
    ? t("dispatch.across_n_beats_one", { n: beatsCount.toLocaleString("en-IN") })
    : t("dispatch.across_n_beats", { n: beatsCount.toLocaleString("en-IN") });

  const ordersWord = t("dispatch.orders_word");

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded bg-accent text-paper-card flex items-center justify-center shrink-0">
            <Truck size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold leading-tight">{t("dispatch.page_title")}</h1>
            <p className="text-2xs text-ink-muted">{me.full_name}</p>
          </div>
        </div>

        <div className="bg-paper-card border border-paper-line rounded-md p-3 my-3">
          <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">{t("dispatch.approved_ready")}</div>
          <div className="grid grid-cols-3 gap-2">
            <KpiTile icon={Package}   label={t("dispatch.kpi_orders")} value={totalOrders.toLocaleString("en-IN")} />
            <KpiTile icon={Package}   label={t("dispatch.kpi_total")} value={formatKg(totalKg)} />
            <KpiTile icon={IndianRupee} label={t("dispatch.kpi_value")} value={formatINR(totalAmount)} />
          </div>
          <div className="text-2xs text-ink-subtle mt-2 text-center">
            {acrossBeatsLabel}
          </div>
        </div>

        {beatRows.length > 0 && (
          <Link
            href="/dispatch/load-truck"
            className="w-full mb-3 inline-flex items-center justify-center gap-1.5 h-11 rounded-md bg-accent text-paper-card text-sm font-semibold hover:bg-accent/90 active:bg-accent/80 transition-colors"
          >
            <Truck size={14}/> {t("dispatch.load_a_truck")}
          </Link>
        )}

        {truckRows.length > 0 && (
          <TrucksLoadingPanel
            trucks={truckRows.map(t => {
              const key = `${t.vehicle_number ?? ""}::${t.driver_name ?? ""}`;
              return {
                vehicleNumber: t.vehicle_number,
                driverName: t.driver_name,
                driverPhone: t.driver_phone,
                dispatchCount: Number(t.dispatch_count),
                orderCount: Number(t.order_count),
                totalQty: Number(t.total_qty),
                totalAmount: Number(t.total_amount),
                oldestLoadedAt: t.oldest_loaded_at,
                orders: truckOrdersByKey.get(key) ?? [],
              };
            })}
          />
        )}

        {beatRows.length > 0 && (
          <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold mb-2 mt-4">
            {t("dispatch.approved_ready_to_load")}
          </h2>
        )}

        {beatRows.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
            <Truck size={28} className="mx-auto text-ink-subtle mb-2"/>
            <p className="font-semibold text-sm mb-0.5">{t("dispatch.nothing_to_dispatch")}</p>
            <p className="text-xs text-ink-muted">{t("dispatch.empty_desc")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {beatRows.map(b => (
              <Link
                key={b.beat_id}
                href={`/dispatch/${b.beat_id}`}
                className="block bg-paper-card border border-paper-line rounded-md p-3.5 hover:bg-paper-subtle/40 active:bg-paper-subtle transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
                    <MapPin size={15}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-sm truncate">{b.beat_name}</h2>
                    <div className="text-2xs text-ink-muted flex items-center gap-2 mt-0.5">
                      <span className="tabular"><strong className="text-ink">{b.order_count}</strong> {ordersWord}</span>
                      <span className="text-ink-subtle">·</span>
                      <span className="tabular"><strong className="text-ink">{formatKg(b.total_kg)}</strong></span>
                      <span className="text-ink-subtle">·</span>
                      <span className="tabular">{formatINR(b.total_amount)}</span>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-ink-subtle shrink-0"/>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-6 text-center text-2xs text-ink-subtle">
          <Link href="/" className="hover:text-ink-muted">← {t("common.back_to_main")}</Link>
        </div>

        <AutoRefresh />
      </div>
    </div>
  );
}

function KpiTile({
  icon: Icon, label, value,
}: { icon: typeof Package; label: string; value: string }) {
  void Icon;
  return (
    <div className="bg-paper-subtle/50 rounded p-2 text-center">
      <div className="text-2xs text-ink-muted mb-0.5">{label}</div>
      <div className="font-bold text-sm tabular truncate">{value}</div>
    </div>
  );
}
