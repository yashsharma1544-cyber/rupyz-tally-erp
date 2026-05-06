// =============================================================================
// /driver — driver app home
//
// Shows the logged-in driver their assigned dispatches (where
// dispatches.driver_user_id = current user). Both 'pending' (loading) and
// 'shipped' (ready to deliver) statuses are shown, grouped by truck.
//
// Pending dispatches are preview-only — driver can see what's being loaded
// but can't deliver yet. Once dispatcher marks the truck dispatched (status
// flips to 'shipped'), the driver can open the stop and capture POD.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Truck, MapPin, Clock, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface DispatchRow {
  id: string;
  status: string;
  vehicle_number: string | null;
  driver_name: string | null;
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

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default async function DriverHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/driver");

  const { data: me } = await supabase
    .from("app_users")
    .select("full_name, role, active, phone")
    .eq("id", user.id)
    .single();
  if (!me?.active) redirect("/login");
  if (me.role !== "driver" && me.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <h1 className="font-semibold text-base mb-1">Not authorized</h1>
          <p className="text-sm text-ink-muted mb-4">Driver app is for drivers only.</p>
          <Link href="/dashboard" className="text-accent text-sm">Go to dashboard</Link>
        </div>
      </div>
    );
  }

  // Fetch all current dispatches assigned to this driver (pending + shipped)
  const { data: dispatches, error } = await supabase
    .from("dispatches")
    .select(`
      id, status, vehicle_number, driver_name, total_qty, total_amount, created_at, shipped_at,
      order:orders(
        id, rupyz_order_id,
        customer:customers(name, city, beat:beats(name))
      )
    `)
    .eq("driver_user_id", user.id)
    .in("status", ["pending", "shipped"])
    .order("created_at", { ascending: true });

  if (error) {
    return (
      <div className="min-h-screen bg-paper p-4">
        <p className="text-sm font-semibold mb-1">Couldn&apos;t load deliveries</p>
        <p className="text-xs text-ink-muted">{error.message}</p>
      </div>
    );
  }

  const dispatchRows = (dispatches ?? []) as unknown as DispatchRow[];

  // Group by truck (vehicle_number + status)
  // Within a truck, separate pending vs shipped — pending is preview-only.
  type TruckBucket = {
    vehicleNumber: string;
    pending: DispatchRow[];
    shipped: DispatchRow[];
  };
  const buckets = new Map<string, TruckBucket>();
  for (const d of dispatchRows) {
    const v = d.vehicle_number ?? "(no vehicle)";
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

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-full bg-accent text-paper-card flex items-center justify-center shrink-0">
            <Truck size={16}/>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-base leading-tight">Hi, {me.full_name}</h1>
            {me.phone && <p className="text-2xs text-ink-muted font-mono">{me.phone}</p>}
          </div>
          <SignOutButton />
        </div>

        {trucks.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center mt-6">
            <Truck size={32} className="mx-auto text-ink-subtle mb-2"/>
            <p className="font-semibold text-sm mb-0.5">No deliveries assigned</p>
            <p className="text-xs text-ink-muted">When you&apos;re assigned to a truck, it&apos;ll appear here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {trucks.map(t => {
              const totalQtyShipped  = t.shipped.reduce((s, d) => s + Number(d.total_qty), 0);
              const totalAmtShipped  = t.shipped.reduce((s, d) => s + Number(d.total_amount), 0);
              const totalQtyPending  = t.pending.reduce((s, d) => s + Number(d.total_qty), 0);
              const allDispatches = [...t.shipped, ...t.pending];
              const oldestTs = allDispatches.reduce((ts, d) => {
                const t = new Date(d.created_at).getTime();
                return t < ts ? t : ts;
              }, Date.now());

              return (
                <section key={t.vehicleNumber}>
                  {/* Truck header */}
                  <div className="bg-accent text-paper-card rounded-md p-3 mb-2">
                    <div className="font-mono font-semibold text-base">{t.vehicleNumber}</div>
                    <div className="text-2xs opacity-90 mt-0.5 inline-flex items-center gap-1">
                      <Clock size={9}/> Loaded {formatRelative(new Date(oldestTs).toISOString())}
                    </div>
                    <div className="text-2xs opacity-90 mt-0.5">
                      <strong className="tabular">{t.shipped.length}</strong> ready to deliver
                      {t.pending.length > 0 && <> · <strong className="tabular">{t.pending.length}</strong> still loading</>}
                    </div>
                  </div>

                  {/* Shipped (ready to deliver) — actionable */}
                  {t.shipped.length > 0 && (
                    <div className="space-y-2">
                      <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold">
                        Ready to deliver · {totalQtyShipped} units · {formatINR(totalAmtShipped)}
                      </h2>
                      {t.shipped.map(d => {
                        const c = customerOf(d);
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
                                  <span className="tabular"><strong className="text-ink">{Number(d.total_qty)}</strong> units</span>
                                  <span className="text-ink-subtle"> · </span>
                                  <span className="tabular">{formatINR(Number(d.total_amount))}</span>
                                </div>
                              </div>
                              <ChevronRight size={14} className="text-ink-subtle shrink-0"/>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}

                  {/* Pending (still being loaded) — preview only */}
                  {t.pending.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold inline-flex items-center gap-1">
                        <Package size={9}/> Still loading · {t.pending.length} stop{t.pending.length === 1 ? "" : "s"} · {totalQtyPending} units
                      </h2>
                      {t.pending.map(d => {
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
                              <span className="text-ink-subtle"> · waiting to leave godown</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Edge case: no shipped at all on this truck */}
                  {t.shipped.length === 0 && t.pending.length > 0 && (
                    <p className="text-2xs text-ink-muted text-center mt-3 italic">
                      Nothing ready to deliver yet — wait for dispatcher to dispatch this truck.
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <div className="mt-8 text-center text-2xs text-ink-subtle">
          <Link href="/" className="hover:text-ink-muted">← Main app</Link>
        </div>
      </div>
    </div>
  );
}
