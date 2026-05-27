// =============================================================================
// /driver — driver app home (desktop redesign)
//
// Same data as before (the logged-in user's assigned dispatches as driver or
// helper, grouped by vehicle). Presentation reflowed to the /orders desktop
// language: PageHeader + KPI cards + per-vehicle delivery tables.
// Sits inside the sidebar shell on desktop; still works on mobile.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Truck, Clock, Package, UserPlus, IndianRupee } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/layout/page-header";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface DispatchRow {
  id: string;
  status: string;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_user_id: string | null;
  helper_user_id: string | null;
  total_qty: number;
  total_amount: number;
  created_at: string;
  shipped_at: string | null;
  order: {
    id: string;
    rupyz_order_id: string;
    customer: { name: string; city: string | null; beat: { name: string } | { name: string }[] | null } | { name: string; city: string | null; beat: { name: string } | { name: string }[] | null }[] | null;
  } | { id: string; rupyz_order_id: string; customer: { name: string; city: string | null; beat: { name: string } | { name: string }[] | null } | { name: string; city: string | null; beat: { name: string } | { name: string }[] | null }[] | null }[] | null;
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

function formatRelative(iso: string, t: TFunc): string {
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1)  return t("driver.just_now");
  if (mins < 60) return t("driver.mins_ago", { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return t("driver.hours_ago", { n: hrs });
  const days = Math.floor(hrs / 24);
  return t("driver.days_ago", { n: days });
}

export default async function DriverHomePage() {
  const t = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/driver");

  const { data: me } = await supabase
    .from("app_users")
    .select("full_name, role, active, phone")
    .eq("id", user.id)
    .single();
  if (!me?.active) redirect("/login");

  if (!["driver", "van_helper", "admin"].includes(me.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <h1 className="font-semibold text-base mb-1">{t("common.not_authorized")}</h1>
          <p className="text-sm text-ink-muted mb-4">{t("driver.not_authorized_body")}</p>
          <Link href="/dashboard" className="text-accent text-sm">{t("common.go_to_dashboard")}</Link>
        </div>
      </div>
    );
  }

  const { data: dispatches, error } = await supabase
    .from("dispatches")
    .select(`
      id, status, vehicle_number, driver_name, driver_user_id, helper_user_id,
      total_qty, total_amount, created_at, shipped_at,
      order:orders(
        id, rupyz_order_id,
        customer:customers(name, city, beat:beats(name))
      )
    `)
    .or(`driver_user_id.eq.${user.id},helper_user_id.eq.${user.id}`)
    .in("status", ["pending", "shipped"])
    .order("created_at", { ascending: true });

  if (error) {
    return (
      <div className="min-h-screen bg-paper p-4">
        <p className="text-sm font-semibold mb-1">{t("driver.cant_load_deliveries")}</p>
        <p className="text-xs text-ink-muted">{error.message}</p>
      </div>
    );
  }

  const dispatchRows = (dispatches ?? []) as unknown as DispatchRow[];

  type TruckBucket = {
    vehicleNumber: string;
    pending: DispatchRow[];
    shipped: DispatchRow[];
  };
  const buckets = new Map<string, TruckBucket>();
  for (const d of dispatchRows) {
    const v = d.vehicle_number ?? t("driver.no_vehicle_placeholder");
    if (!buckets.has(v)) buckets.set(v, { vehicleNumber: v, pending: [], shipped: [] });
    const b = buckets.get(v)!;
    if (d.status === "pending") b.pending.push(d);
    else if (d.status === "shipped") b.shipped.push(d);
  }
  const trucks = Array.from(buckets.values());

  function customerOf(d: DispatchRow): { name: string; city: string | null; beatName: string | null } {
    const order = Array.isArray(d.order) ? d.order[0] : d.order;
    const c = order?.customer ? (Array.isArray(order.customer) ? order.customer[0] : order.customer) : null;
    const beatRel = c?.beat;
    const beat = Array.isArray(beatRel) ? beatRel[0] : beatRel;
    return {
      name: c?.name ?? "—",
      city: c?.city ?? null,
      beatName: beat?.name ?? null,
    };
  }

  function rupyzOrderIdOf(d: DispatchRow): string {
    const order = Array.isArray(d.order) ? d.order[0] : d.order;
    return order?.rupyz_order_id ?? "—";
  }

  const isHelperRole = me.role === "van_helper";
  const roleLabel = isHelperRole ? t("driver.role_helper") : t("driver.role_driver");

  // Totals across all assigned trucks (KPI cards)
  const allShipped = trucks.flatMap(tr => tr.shipped);
  const allPending = trucks.flatMap(tr => tr.pending);
  const kpiReadyCount = allShipped.length;
  const kpiReadyAmount = allShipped.reduce((s, d) => s + Number(d.total_amount), 0);
  const kpiLoadingCount = allPending.length;

  return (
    <>
      <PageHeader
        title={t("driver.hi_name", { name: me.full_name })}
        subtitle={`${roleLabel}${me.phone ? ` · ${me.phone}` : ""}`}
        actions={<SignOutButton />}
      />

      <div className="p-3 sm:p-6">
        {trucks.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-8 text-center max-w-2xl">
            <Truck size={32} className="mx-auto text-ink-subtle mb-2" />
            <p className="font-semibold text-sm mb-0.5">{t("driver.no_deliveries_assigned")}</p>
            <p className="text-xs text-ink-muted">
              {isHelperRole ? t("driver.no_deliveries_body_helper") : t("driver.no_deliveries_body_driver")}
            </p>
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6 max-w-2xl">
              <KpiTile icon={Truck}       label={t("driver.ready_to_deliver_suffix")} value={kpiReadyCount.toLocaleString("en-IN")} />
              <KpiTile icon={IndianRupee} label={t("dispatch.kpi_value")}              value={formatINR(kpiReadyAmount)} />
              <KpiTile icon={Package}     label={t("driver.still_loading_suffix")}     value={kpiLoadingCount.toLocaleString("en-IN")} />
            </div>

            <div className="space-y-6 max-w-3xl">
              {trucks.map(truck => {
                const totalQtyShipped  = truck.shipped.reduce((s, d) => s + Number(d.total_qty), 0);
                const totalAmtShipped  = truck.shipped.reduce((s, d) => s + Number(d.total_amount), 0);
                const totalQtyPending  = truck.pending.reduce((s, d) => s + Number(d.total_qty), 0);
                const allDispatches = [...truck.shipped, ...truck.pending];
                const oldestTs = allDispatches.reduce((ts, d) => {
                  const cur = new Date(d.created_at).getTime();
                  return cur < ts ? cur : ts;
                }, Date.now());

                return (
                  <section key={truck.vehicleNumber} className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
                    {/* Vehicle header */}
                    <div className="bg-accent text-paper-card px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-mono font-semibold text-base">{truck.vehicleNumber}</div>
                        <div className="text-2xs opacity-90 mt-0.5 inline-flex items-center gap-1">
                          <Clock size={9} /> {t("driver.loaded_relative", { relative: formatRelative(new Date(oldestTs).toISOString(), t) })}
                        </div>
                      </div>
                      <div className="text-2xs opacity-90 text-right">
                        <strong className="tabular">{truck.shipped.length}</strong> {t("driver.ready_to_deliver_suffix")}
                        {truck.pending.length > 0 && <> · <strong className="tabular">{truck.pending.length}</strong> {t("driver.still_loading_suffix")}</>}
                      </div>
                    </div>

                    {/* Ready-to-deliver table */}
                    {truck.shipped.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[640px]">
                          <thead className="bg-paper-subtle/60 border-b border-paper-line">
                            <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                              <th className="px-3 py-2.5 font-medium">Customer</th>
                              <th className="px-3 py-2.5 font-medium">Order #</th>
                              <th className="px-3 py-2.5 font-medium">Beat</th>
                              <th className="px-3 py-2.5 font-medium text-right">{t("common.units")}</th>
                              <th className="px-3 py-2.5 font-medium text-right">Value</th>
                              <th className="px-3 py-2.5 font-medium text-right w-20"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-paper-line">
                            {truck.shipped.map(d => {
                              const c = customerOf(d);
                              const asHelper = d.helper_user_id === user.id && d.driver_user_id !== user.id;
                              return (
                                <tr key={d.id} className="hover:bg-paper-subtle/40 transition-colors">
                                  <td className="px-3 py-3">
                                    <Link href={`/driver/${d.id}`} className="font-medium hover:text-accent">
                                      {c.name}
                                    </Link>
                                    {c.city && <div className="text-2xs text-ink-subtle">{c.city}</div>}
                                    {asHelper && (
                                      <span className="inline-flex items-center gap-0.5 text-2xs text-accent mt-0.5">
                                        <UserPlus size={9} /> {t("driver.as_helper_badge")}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-3 font-mono text-xs text-ink-muted">{rupyzOrderIdOf(d)}</td>
                                  <td className="px-3 py-3 text-ink-muted">{c.beatName ?? "—"}</td>
                                  <td className="px-3 py-3 text-right tabular">{Number(d.total_qty)}</td>
                                  <td className="px-3 py-3 text-right tabular font-medium">{formatINR(Number(d.total_amount))}</td>
                                  <td className="px-3 py-3 text-right">
                                    <Link href={`/driver/${d.id}`} className="text-accent inline-flex items-center gap-1 hover:underline">
                                      Open <ChevronRight size={13} />
                                    </Link>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          {truck.shipped.length > 1 && (
                            <tfoot className="border-t border-paper-line bg-paper-subtle/40">
                              <tr className="text-2xs text-ink-muted">
                                <td className="px-3 py-2 font-medium" colSpan={3}>{t("driver.ready_header", { qty: totalQtyShipped, amount: formatINR(totalAmtShipped) })}</td>
                                <td className="px-3 py-2 text-right tabular font-medium">{totalQtyShipped}</td>
                                <td className="px-3 py-2 text-right tabular font-medium">{formatINR(totalAmtShipped)}</td>
                                <td className="px-3 py-2"></td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    )}

                    {/* Still-loading (preview-only) */}
                    {truck.pending.length > 0 && (
                      <div className="px-3 py-3 border-t border-paper-line bg-paper-subtle/20">
                        <h3 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold inline-flex items-center gap-1 mb-2">
                          <Package size={9} /> {truck.pending.length === 1
                            ? t("driver.still_loading_header_one", { n: truck.pending.length, qty: totalQtyPending })
                            : t("driver.still_loading_header_many", { n: truck.pending.length, qty: totalQtyPending })}
                        </h3>
                        <div className="space-y-1">
                          {truck.pending.map(d => {
                            const c = customerOf(d);
                            return (
                              <div key={d.id} className="text-xs text-ink-muted flex flex-wrap items-center gap-x-2">
                                <span className="font-medium text-ink">{c.name}</span>
                                <span className="font-mono text-2xs">{rupyzOrderIdOf(d)}</span>
                                {c.city && <span className="text-2xs">{c.city}</span>}
                                <span className="text-2xs text-ink-subtle italic">{t("driver.waiting_to_leave_godown")}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {truck.shipped.length === 0 && truck.pending.length > 0 && (
                      <p className="text-2xs text-ink-muted text-center py-3 italic">
                        {t("driver.nothing_ready_yet")}
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}

        <div className="mt-8 text-2xs text-ink-subtle lg:hidden">
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
