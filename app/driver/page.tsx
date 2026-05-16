// =============================================================================
// /driver — driver app home
//
// Shows the logged-in user their assigned dispatches:
//   - As driver (dispatch.driver_user_id = me)
//   - As helper (dispatch.helper_user_id = me)
//
// Both 'pending' (loading) and 'shipped' (ready to deliver) statuses are shown,
// grouped by truck. Pending = preview-only.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Truck, MapPin, Clock, Package, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";
import { AutoRefresh } from "@/components/auto-refresh";
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

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-full bg-accent text-paper-card flex items-center justify-center shrink-0">
            {isHelperRole ? <UserPlus size={16}/> : <Truck size={16}/>}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-base leading-tight">{t("driver.hi_name", { name: me.full_name })}</h1>
            <p className="text-2xs text-ink-muted">{roleLabel}{me.phone ? ` · ${me.phone}` : ""}</p>
          </div>
          <SignOutButton />
        </div>

        {trucks.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center mt-6">
            <Truck size={32} className="mx-auto text-ink-subtle mb-2"/>
            <p className="font-semibold text-sm mb-0.5">{t("driver.no_deliveries_assigned")}</p>
            <p className="text-xs text-ink-muted">
              {isHelperRole ? t("driver.no_deliveries_body_helper") : t("driver.no_deliveries_body_driver")}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
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
                <section key={truck.vehicleNumber}>
                  <div className="bg-accent text-paper-card rounded-md p-3 mb-2">
                    <div className="font-mono font-semibold text-base">{truck.vehicleNumber}</div>
                    <div className="text-2xs opacity-90 mt-0.5 inline-flex items-center gap-1">
                      <Clock size={9}/> {t("driver.loaded_relative", { relative: formatRelative(new Date(oldestTs).toISOString(), t) })}
                    </div>
                    <div className="text-2xs opacity-90 mt-0.5">
                      <strong className="tabular">{truck.shipped.length}</strong> {t("driver.ready_to_deliver_suffix")}
                      {truck.pending.length > 0 && <> · <strong className="tabular">{truck.pending.length}</strong> {t("driver.still_loading_suffix")}</>}
                    </div>
                  </div>

                  {truck.shipped.length > 0 && (
                    <div className="space-y-2">
                      <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold">
                        {t("driver.ready_header", { qty: totalQtyShipped, amount: formatINR(totalAmtShipped) })}
                      </h2>
                      {truck.shipped.map(d => {
                        const c = customerOf(d);
                        const asHelper = d.helper_user_id === user.id && d.driver_user_id !== user.id;
                        return (
                          <Link
                            key={d.id}
                            href={`/driver/${d.id}`}
                            className="block bg-paper-card border border-paper-line rounded-md p-3 hover:bg-paper-subtle/40 active:bg-paper-subtle transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
                                <MapPin size={13}/>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-sm truncate">{c.name}</div>
                                <div className="text-2xs text-ink-muted mt-0.5">
                                  {c.city && <>{c.city} · </>}
                                  <span className="font-mono">{rupyzOrderIdOf(d)}</span>
                                  {c.beatName && <> · {c.beatName}</>}
                                </div>
                                <div className="text-2xs text-ink-muted mt-0.5">
                                  <span className="tabular"><strong className="text-ink">{Number(d.total_qty)}</strong> {t("common.units")}</span>
                                  <span className="text-ink-subtle"> · </span>
                                  <span className="tabular">{formatINR(Number(d.total_amount))}</span>
                                  {asHelper && (
                                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-accent">
                                      <UserPlus size={9}/> {t("driver.as_helper_badge")}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <ChevronRight size={14} className="text-ink-subtle shrink-0"/>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}

                  {truck.pending.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold inline-flex items-center gap-1">
                        <Package size={9}/> {truck.pending.length === 1
                          ? t("driver.still_loading_header_one", { n: truck.pending.length, qty: totalQtyPending })
                          : t("driver.still_loading_header_many", { n: truck.pending.length, qty: totalQtyPending })}
                      </h2>
                      {truck.pending.map(d => {
                        const c = customerOf(d);
                        return (
                          <div
                            key={d.id}
                            className="bg-paper-card/60 border border-paper-line/70 rounded-md px-3 py-2 opacity-70"
                          >
                            <div className="text-sm font-medium truncate">{c.name}</div>
                            <div className="text-2xs text-ink-muted mt-0.5">
                              <span className="font-mono">{rupyzOrderIdOf(d)}</span>
                              {c.city && <> · {c.city}</>}
                              <span className="text-ink-subtle"> · {t("driver.waiting_to_leave_godown")}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {truck.shipped.length === 0 && truck.pending.length > 0 && (
                    <p className="text-2xs text-ink-muted text-center mt-3 italic">
                      {t("driver.nothing_ready_yet")}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <div className="mt-8 text-center text-2xs text-ink-subtle">
          <Link href="/" className="hover:text-ink-muted">← {t("common.back_to_main")}</Link>
        </div>

        <AutoRefresh />
      </div>
    </div>
  );
}
