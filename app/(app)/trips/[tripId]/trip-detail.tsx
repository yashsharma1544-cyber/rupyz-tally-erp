"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Truck, MapPin, Printer, FileCheck2, AlertCircle, CheckCircle2,
  Smartphone, Ban, ArrowLeft, IndianRupee, Package, Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import type {
  AppUser, VanTrip, VanTripStatus, TripLoadItem, TripBill, VanTripKpis,
} from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";
import {
  markTripLoaded, markTripReturned, reconcileTrip, cancelTrip, type ReconcileInput,
} from "../actions";

function statusBadge(s: VanTripStatus): { variant: "neutral" | "ok" | "warn" | "danger" | "accent"; label: string } {
  return {
    planning:    { variant: "warn"   as const, label: "Planning" },
    loading:     { variant: "warn"   as const, label: "Loading" },
    in_progress: { variant: "accent" as const, label: "On Route" },
    returned:    { variant: "warn"   as const, label: "Awaiting Reconcile" },
    reconciled:  { variant: "ok"     as const, label: "Reconciled" },
    cancelled:   { variant: "danger" as const, label: "Cancelled" },
  }[s];
}

export function TripDetail({
  tripId, initialTrip, me,
}: {
  tripId: string;
  initialTrip: VanTrip;
  me: AppUser;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [trip, setTrip] = useState<VanTrip>(initialTrip);
  const [loadItems, setLoadItems] = useState<TripLoadItem[]>([]);
  const [bills, setBills] = useState<TripBill[]>([]);
  const [kpis, setKpis] = useState<VanTripKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  // Editable forms (loading + reconcile)
  const [loadedQtys, setLoadedQtys] = useState<Map<string, number>>(new Map());
  const [returnedQtys, setReturnedQtys] = useState<Map<string, number>>(new Map());
  const [actualCash, setActualCash] = useState<string>("");
  const [reconcileNotes, setReconcileNotes] = useState("");

  const canManage = ["admin", "van_lead"].includes(me.role);
  const canCancel = me.role === "admin";

  async function reload() {
    const [{ data: t }, { data: li }, { data: bl }, { data: kp }] = await Promise.all([
      supabase.from("van_trips").select("*, beat:beats(id,name), lead:app_users!van_trips_lead_id_fkey(id,full_name)").eq("id", tripId).single(),
      supabase.from("trip_load_items").select("*, product:products(id,name,unit)").eq("trip_id", tripId).order("created_at"),
      supabase.from("trip_bills").select("*, customer:customers(id,name,mobile,city), items:trip_bill_items(*)").eq("trip_id", tripId).order("created_at"),
      supabase.rpc("van_trip_kpis", { p_trip_id: tripId }),
    ]);
    if (t) setTrip(t as unknown as VanTrip);
    setLoadItems((li ?? []) as unknown as TripLoadItem[]);
    setBills((bl ?? []) as unknown as TripBill[]);
    if (Array.isArray(kp) && kp[0]) setKpis(kp[0] as VanTripKpis);
  }

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  useEffect(() => {
    // Pre-fill loaded qty form from planned qty
    if (trip.status === "planning" || trip.status === "loading") {
      const m = new Map<string, number>();
      for (const li of loadItems) m.set(li.product_id, Number(li.qty_loaded ?? li.qty_planned));
      setLoadedQtys(m);
    }
    // Pre-fill returned qty form (= loaded - sold)
    if (trip.status === "returned" || trip.status === "in_progress") {
      const billed = new Map<string, number>();
      for (const b of bills) {
        if (b.is_cancelled) continue;
        for (const it of b.items ?? []) {
          billed.set(it.product_id, (billed.get(it.product_id) ?? 0) + Number(it.qty));
        }
      }
      const m = new Map<string, number>();
      for (const li of loadItems) {
        const sold = billed.get(li.product_id) ?? 0;
        m.set(li.product_id, Math.max(0, Number(li.qty_loaded ?? li.qty_planned) - sold));
      }
      setReturnedQtys(m);
      if (kpis) setActualCash(String(kpis.expected_cash));
    }
  }, [trip.status, loadItems, bills, kpis]);

  const sb = statusBadge(trip.status);
  const billedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bills) {
      if (b.is_cancelled) continue;
      for (const it of b.items ?? []) {
        m.set(it.product_id, (m.get(it.product_id) ?? 0) + Number(it.qty));
      }
    }
    return m;
  }, [bills]);

  // ========== HANDLERS ==========

  function handleMarkLoaded() {
    const payload = Array.from(loadedQtys.entries()).map(([productId, qtyLoaded]) => ({ productId, qtyLoaded }));
    if (payload.some(p => p.qtyLoaded < 0)) { toast.error("Loaded qty cannot be negative"); return; }
    startTransition(async () => {
      const res = await markTripLoaded(tripId, payload);
      if (res.error) toast.error(res.error);
      else { toast.success("Trip marked loaded — van is on route"); await reload(); }
    });
  }

  function handleMarkReturned() {
    startTransition(async () => {
      const res = await markTripReturned(tripId);
      if (res.error) toast.error(res.error);
      else { toast.success("Trip marked returned"); await reload(); }
    });
  }

  function handleReconcile() {
    const cash = parseFloat(actualCash || "0");
    if (isNaN(cash) || cash < 0) { toast.error("Enter actual cash collected"); return; }
    const payload: ReconcileInput = {
      returnedQty: Array.from(returnedQtys.entries()).map(([productId, qtyReturned]) => ({ productId, qtyReturned })),
      cashCollectedActual: cash,
      notes: reconcileNotes.trim() || undefined,
    };
    startTransition(async () => {
      const res = await reconcileTrip(tripId, payload);
      if (res.error) toast.error(res.error);
      else { toast.success("Trip reconciled — locked"); await reload(); }
    });
  }

  function handleCancel() {
    const reason = prompt("Cancel reason (min 3 chars):");
    if (!reason || reason.trim().length < 3) return;
    startTransition(async () => {
      const res = await cancelTrip(tripId, reason);
      if (res.error) toast.error(res.error);
      else { toast.success("Trip cancelled"); router.push("/trips"); }
    });
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link href="/trips" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
        <ArrowLeft size={11}/> Back to trips
      </Link>

      {/* Header card */}
      <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-base">{trip.trip_number}</span>
              <Badge variant={sb.variant}>{sb.label}</Badge>
            </div>
            <div className="text-sm text-ink-muted">
              {trip.beat?.name} · {new Date(trip.trip_date).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
            </div>
            <div className="text-xs text-ink-muted mt-1">
              <span className="capitalize">{trip.vehicle_type}</span>
              {trip.vehicle_number && <> · <span className="tabular">{trip.vehicle_number}</span></>}
              {trip.vehicle_provided_by && <> · {trip.vehicle_provided_by}</>}
            </div>
            <div className="text-xs text-ink-muted">
              Lead: {trip.lead?.full_name ?? "—"}
              {trip.helpers.length > 0 && <> · Helpers: {trip.helpers.join(", ")}</>}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {trip.status === "in_progress" && (
              <a href={`/van/${trip.id}`} target="_blank" rel="noopener noreferrer">
                <Button size="sm"><Smartphone size={11}/> Open mobile billing</Button>
              </a>
            )}
            {canCancel && !["reconciled", "cancelled"].includes(trip.status) && (
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={pending}>
                <Ban size={11}/> Cancel trip
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPIs (visible from in_progress onwards) */}
      {kpis && ["in_progress", "returned", "reconciled"].includes(trip.status) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          <Kpi icon={Receipt}      label="Bills"     value={`${kpis.bills_count}`}       sub={`${kpis.pre_order_count} pre · ${kpis.spot_count} spot`} accent="accent" />
          <Kpi icon={IndianRupee}  label="Cash bills" value={formatINR(kpis.cash_bills_total)} sub={`+ outstanding ${formatINR(kpis.outstanding_collected)}`} accent="ok" />
          <Kpi icon={IndianRupee}  label="Expected cash" value={formatINR(kpis.expected_cash)} sub="cash + outstanding" accent="warn" />
          <Kpi icon={Package}      label="Stock remaining" value={`${kpis.total_kg_remaining.toFixed(0)} units`} sub={`${kpis.total_kg_billed.toFixed(0)} sold of ${kpis.total_kg_loaded.toFixed(0)}`} accent="accent" />
        </div>
      )}

      {/* Loading sheet (planning/loading) */}
      {(trip.status === "planning" || trip.status === "loading") && (
        <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Loading sheet</h2>
            <Button size="sm" variant="outline" onClick={() => window.print()}><Printer size={11}/> Print</Button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-2xs uppercase tracking-wide text-ink-muted border-b border-paper-line">
              <tr>
                <th className="px-2 py-1.5 text-left">Product</th>
                <th className="px-2 py-1.5 text-right">Pre-order qty</th>
                <th className="px-2 py-1.5 text-right">Buffer qty</th>
                <th className="px-2 py-1.5 text-right">Planned</th>
                <th className="px-2 py-1.5 text-right w-32">Actually loaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {loadItems.length === 0 ? (
                <tr><td colSpan={5} className="px-2 py-6 text-center text-ink-muted">No items planned for this trip.</td></tr>
              ) : loadItems.map(li => (
                <tr key={li.id}>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{li.product?.name ?? "—"}</div>
                    <div className="text-2xs text-ink-subtle">{li.product?.unit}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular text-ink-muted">{Number(li.source_pre_order_qty).toFixed(0)}</td>
                  <td className="px-2 py-1.5 text-right tabular text-ink-muted">{Number(li.source_buffer_qty).toFixed(0)}</td>
                  <td className="px-2 py-1.5 text-right tabular font-medium">{Number(li.qty_planned).toFixed(0)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {canManage ? (
                      <Input
                        type="number" step="0.001" min="0"
                        value={loadedQtys.get(li.product_id) ?? Number(li.qty_planned)}
                        onChange={(e) => {
                          const n = new Map(loadedQtys);
                          n.set(li.product_id, parseFloat(e.target.value) || 0);
                          setLoadedQtys(n);
                        }}
                        className="text-right tabular w-28 ml-auto"
                      />
                    ) : <span className="text-ink-muted tabular">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canManage && (
            <div className="mt-3 flex gap-2 justify-end">
              <Button onClick={handleMarkLoaded} disabled={pending || loadItems.length === 0}>
                <Truck size={11}/> {pending ? "Saving…" : "Mark loaded & start trip"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* In-progress: bills list (read-only) */}
      {(trip.status === "in_progress" || trip.status === "returned" || trip.status === "reconciled") && (
        <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Bills ({bills.length})</h2>
            {trip.status === "in_progress" && (
              <a href={`/van/${trip.id}`} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline"><Smartphone size={11}/> Add via mobile</Button>
              </a>
            )}
          </div>
          {loading ? (
            <div className="text-sm text-ink-muted">Loading…</div>
          ) : bills.length === 0 ? (
            <div className="text-sm text-ink-muted italic">No bills yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase tracking-wide text-ink-muted border-b border-paper-line">
                <tr>
                  <th className="px-2 py-1.5 text-left">Bill #</th>
                  <th className="px-2 py-1.5 text-left">Customer</th>
                  <th className="px-2 py-1.5 text-left">Type</th>
                  <th className="px-2 py-1.5 text-right">Total</th>
                  <th className="px-2 py-1.5 text-right">Old o/s collected</th>
                  <th className="px-2 py-1.5 text-left">Mode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {bills.map(b => (
                  <tr key={b.id} className={b.is_cancelled ? "opacity-40 line-through" : ""}>
                    <td className="px-2 py-1.5 font-mono text-2xs">{b.bill_number}{b.paper_bill_no && <span className="text-ink-subtle"> · {b.paper_bill_no}</span>}</td>
                    <td className="px-2 py-1.5">{b.customer?.name ?? "—"}</td>
                    <td className="px-2 py-1.5"><Badge variant={b.bill_type === "pre_order" ? "neutral" : "accent"}>{b.bill_type === "pre_order" ? "Pre-order" : "Spot"}</Badge></td>
                    <td className="px-2 py-1.5 text-right tabular">{formatINR(b.total_amount)}</td>
                    <td className="px-2 py-1.5 text-right tabular text-ink-muted">{formatINR(b.outstanding_collected)}</td>
                    <td className="px-2 py-1.5"><Badge variant={b.payment_mode === "cash" ? "ok" : "warn"}>{b.payment_mode}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {trip.status === "in_progress" && canManage && (
            <div className="mt-3 flex gap-2 justify-end">
              <Button onClick={handleMarkReturned} disabled={pending}>
                <FileCheck2 size={11}/> Mark returned (back at office)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Reconciliation panel */}
      {(trip.status === "returned" || trip.status === "reconciled") && (
        <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted mb-3">Reconciliation</h2>

          <h3 className="text-xs font-medium mb-2">Stock</h3>
          <table className="w-full text-sm mb-4">
            <thead className="text-2xs uppercase tracking-wide text-ink-muted border-b border-paper-line">
              <tr>
                <th className="px-2 py-1 text-left">Product</th>
                <th className="px-2 py-1 text-right">Loaded</th>
                <th className="px-2 py-1 text-right">Sold (per bills)</th>
                <th className="px-2 py-1 text-right">Expected return</th>
                <th className="px-2 py-1 text-right">Actually returned</th>
                <th className="px-2 py-1 text-center">Match?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {loadItems.map(li => {
                const loaded = Number(li.qty_loaded ?? 0);
                const sold = billedMap.get(li.product_id) ?? 0;
                const expected = Math.max(0, loaded - sold);
                const returned = trip.status === "reconciled"
                  ? Number(li.qty_returned ?? 0)
                  : (returnedQtys.get(li.product_id) ?? expected);
                const diff = returned - expected;
                return (
                  <tr key={li.id}>
                    <td className="px-2 py-1.5">{li.product?.name ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular">{loaded.toFixed(0)}</td>
                    <td className="px-2 py-1.5 text-right tabular">{sold.toFixed(0)}</td>
                    <td className="px-2 py-1.5 text-right tabular">{expected.toFixed(0)}</td>
                    <td className="px-2 py-1.5 text-right">
                      {trip.status === "returned" ? (
                        <Input type="number" step="0.001" min="0" value={returned}
                          onChange={(e) => {
                            const n = new Map(returnedQtys);
                            n.set(li.product_id, parseFloat(e.target.value) || 0);
                            setReturnedQtys(n);
                          }}
                          className="w-24 text-right tabular ml-auto"
                        />
                      ) : <span className="tabular">{returned.toFixed(0)}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-center text-xs">
                      {Math.abs(diff) < 0.01 ? <CheckCircle2 size={14} className="text-ok inline"/> : (
                        <span className="text-danger inline-flex items-center gap-0.5">
                          <AlertCircle size={12}/> {diff > 0 ? "+" : ""}{diff.toFixed(1)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="text-xs font-medium mb-2">Cash</h3>
          {kpis && (
            <div className="bg-paper-subtle/40 border border-paper-line rounded p-3 text-sm space-y-1 mb-3">
              <div className="flex justify-between"><span>Cash bills total</span><span className="tabular">{formatINR(kpis.cash_bills_total)}</span></div>
              <div className="flex justify-between"><span>+ Old outstanding collected</span><span className="tabular">{formatINR(kpis.outstanding_collected)}</span></div>
              <div className="flex justify-between font-semibold border-t border-paper-line pt-1 mt-1"><span>Expected cash</span><span className="tabular">{formatINR(kpis.expected_cash)}</span></div>
            </div>
          )}
          {trip.status === "returned" ? (
            <>
              <Label className="block mb-1">Actual cash handed over</Label>
              <Input type="number" step="0.01" value={actualCash} onChange={(e) => setActualCash(e.target.value)} className="tabular w-48 mb-3" />
              <Label className="block mb-1">Reconcile notes (optional)</Label>
              <Textarea value={reconcileNotes} onChange={(e) => setReconcileNotes(e.target.value)} rows={2} className="mb-3" />
            </>
          ) : (
            <div className="text-sm space-y-1 mb-3">
              <div className="flex justify-between"><span>Actual cash handed over</span><span className="tabular">{formatINR(trip.cash_collected_actual ?? 0)}</span></div>
              {trip.reconcile_notes && <div className="text-xs text-ink-muted mt-1">Notes: {trip.reconcile_notes}</div>}
            </div>
          )}

          {trip.status === "returned" && canManage && (
            <div className="flex gap-2 justify-end">
              <Button onClick={handleReconcile} disabled={pending}>
                {pending ? "Saving…" : "Confirm Reconciliation & Lock Trip"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, accent }: { icon: typeof MapPin; label: string; value: string; sub: string; accent: "warn" | "accent" | "ok" | "danger" | "neutral" }) {
  const accentText = { warn: "text-warn", accent: "text-accent", ok: "text-ok", danger: "text-danger", neutral: "text-ink" }[accent];
  const accentBg = { warn: "bg-warn-soft", accent: "bg-accent-soft", ok: "bg-ok-soft", danger: "bg-danger-soft", neutral: "bg-paper-subtle" }[accent];
  return (
    <div className="border border-paper-line rounded-md p-3 bg-paper-card">
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`p-1 rounded ${accentBg}`}><Icon size={12} className={accentText} /></span>
        <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">{label}</span>
      </div>
      <div className={`text-lg font-bold tabular ${accentText}`}>{value}</div>
      <div className="text-2xs text-ink-muted">{sub}</div>
    </div>
  );
}
