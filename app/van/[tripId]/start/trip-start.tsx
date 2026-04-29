"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Truck, Package, AlertCircle, Receipt, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { AppUser, VanTrip, TripLoadItem, TripBill } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";
import { markTripLoaded } from "@/app/(app)/trips/actions";

type Step = "orders" | "loading";

export function TripStart({
  me, trip, initialLoadItems, initialBills,
}: {
  me: AppUser;
  trip: VanTrip;
  initialLoadItems: TripLoadItem[];
  initialBills: TripBill[];
}) {
  const router = useRouter();
  const [items] = useState<TripLoadItem[]>(initialLoadItems);
  const [bills] = useState<TripBill[]>(initialBills);
  const [loadedQtys, setLoadedQtys] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const li of initialLoadItems) {
      m.set(li.product_id, Number(li.qty_loaded ?? li.qty_planned));
    }
    return m;
  });
  const [pending, startTransition] = useTransition();

  // Wizard step. Default to "orders" if any pre-orders attached, else jump
  // straight to "loading" (nothing useful in the orders view to look at).
  const [step, setStep] = useState<Step>(initialBills.length > 0 ? "orders" : "loading");

  const isLeadOrAdmin = me.role === "admin" || me.id === trip.lead_id;

  const totalPlanned = items.reduce((s, li) => s + Number(li.qty_planned), 0);
  const totalLoaded = Array.from(loadedQtys.values()).reduce((s, q) => s + q, 0);

  // Pre-order bills only — spot bills can't exist before in_progress
  const preOrderBills = useMemo(
    () => bills.filter(b => b.bill_type === "pre_order"),
    [bills],
  );
  const preOrderTotal = preOrderBills.reduce((s, b) => s + Number(b.total_amount), 0);

  function handleStart() {
    if (items.length === 0) {
      toast.error("This trip has no items to load. Add buffer first from desktop.");
      return;
    }
    const payload = Array.from(loadedQtys.entries()).map(([productId, qtyLoaded]) => ({ productId, qtyLoaded }));
    if (payload.some(p => p.qtyLoaded < 0)) {
      toast.error("Loaded qty cannot be negative");
      return;
    }
    startTransition(async () => {
      const res = await markTripLoaded(trip.id, payload);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Trip started — let's go!");
      router.push(`/van/${trip.id}`);
    });
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <Link href="/van" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> All trips
        </Link>

        <div className="mb-4">
          <div className="flex items-baseline gap-2 mb-1">
            <h1 className="text-lg font-bold">{trip.beat?.name ?? "—"}</h1>
            <Badge variant="warn">Ready to start</Badge>
          </div>
          <p className="text-xs text-ink-muted font-mono">{trip.trip_number}</p>
          <p className="text-xs text-ink-muted">
            {new Date(trip.trip_date).toLocaleDateString("en-IN", {
              weekday: "short", day: "2-digit", month: "short", year: "numeric",
            })}
            {trip.vehicle_number && <> · {trip.vehicle_number}</>}
          </p>
        </div>

        {/* Summary pill */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-paper-card border border-paper-line rounded p-2.5">
            <div className="text-2xs text-ink-muted uppercase tracking-wide">Pre-orders</div>
            <div className="text-lg font-bold tabular">{preOrderBills.length}</div>
            <div className="text-2xs text-ink-subtle">{formatINR(preOrderTotal)}</div>
          </div>
          <div className="bg-paper-card border border-paper-line rounded p-2.5">
            <div className="text-2xs text-ink-muted uppercase tracking-wide">Planned</div>
            <div className="text-lg font-bold tabular text-accent">{totalPlanned.toFixed(0)}</div>
            <div className="text-2xs text-ink-subtle">{items.length} SKU{items.length !== 1 ? "s" : ""}</div>
          </div>
        </div>

        {/* Step tabs */}
        <div className="grid grid-cols-2 gap-1 mb-3 bg-paper-subtle border border-paper-line rounded p-0.5">
          <button
            onClick={() => setStep("orders")}
            className={`text-xs font-medium py-2 rounded transition-colors flex items-center justify-center gap-1.5 ${
              step === "orders" ? "bg-paper-card shadow-sm text-ink" : "text-ink-muted"
            }`}
          >
            <ShoppingBag size={11}/> Orders ({preOrderBills.length})
          </button>
          <button
            onClick={() => setStep("loading")}
            className={`text-xs font-medium py-2 rounded transition-colors flex items-center justify-center gap-1.5 ${
              step === "loading" ? "bg-paper-card shadow-sm text-ink" : "text-ink-muted"
            }`}
          >
            <Package size={11}/> Loading sheet
          </button>
        </div>

        {/* STEP 1 — Orders view */}
        {step === "orders" && (
          <>
            {preOrderBills.length === 0 ? (
              <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center mb-3">
                <Receipt size={28} className="mx-auto text-ink-subtle mb-2"/>
                <h2 className="font-semibold text-sm mb-1">No pre-orders yet</h2>
                <p className="text-xs text-ink-muted mb-3">
                  Office can attach approved orders to this trip from the desktop. You can also start with buffer-only stock.
                </p>
              </div>
            ) : (
              <div className="bg-paper-card border border-paper-line rounded-md mb-3 divide-y divide-paper-line">
                <div className="px-3 py-2 bg-paper-subtle/40 text-2xs uppercase tracking-wide text-ink-muted font-semibold flex items-center gap-1.5">
                  <ShoppingBag size={12}/> {preOrderBills.length} pre-order{preOrderBills.length === 1 ? "" : "s"} attached
                </div>
                {preOrderBills.map(b => {
                  const cust = Array.isArray(b.customer) ? b.customer[0] : b.customer;
                  type BillItem = { qty: number; product: { id: string; name: string; unit: string } | { id: string; name: string; unit: string }[] | null };
                  const billItems = (b.items ?? []) as BillItem[];
                  return (
                    <div key={b.id} className="px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-2 mb-0.5">
                        <span className="font-semibold text-sm flex-1 min-w-0 truncate">{cust?.name ?? "—"}</span>
                        <span className="font-mono text-sm tabular shrink-0">{formatINR(b.total_amount)}</span>
                      </div>
                      <div className="text-2xs text-ink-muted mb-1">
                        {b.bill_number}
                        {cust?.city && <> · {cust.city}</>}
                        {b.payment_mode && <> · {b.payment_mode}</>}
                      </div>
                      {billItems.length > 0 && (
                        <div className="text-2xs text-ink-subtle">
                          {billItems.slice(0, 3).map((it, i) => {
                            const p = Array.isArray(it.product) ? it.product[0] : it.product;
                            return (
                              <span key={i}>
                                {i > 0 && " · "}
                                <span className="tabular text-ink">{Number(it.qty).toFixed(0)}</span> {p?.name ?? "—"}
                              </span>
                            );
                          })}
                          {billItems.length > 3 && <> · +{billItems.length - 3} more</>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Next button */}
            <Button
              className="w-full"
              size="lg"
              variant="outline"
              onClick={() => setStep("loading")}
            >
              Next: Loading sheet <ArrowRight size={14}/>
            </Button>
          </>
        )}

        {/* STEP 2 — Loading sheet */}
        {step === "loading" && (
          <>
        {/* Empty state */}
        {items.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
            <AlertCircle size={28} className="mx-auto text-warn mb-2"/>
            <h2 className="font-semibold text-sm mb-1">No items planned for this trip</h2>
            <p className="text-xs text-ink-muted mb-3">
              Office will need to add buffer products on the desktop trip detail page before you can start.
            </p>
          </div>
        ) : (
          <>
            {/* Load list */}
            <div className="bg-paper-card border border-paper-line rounded-md mb-4 divide-y divide-paper-line">
              <div className="px-3 py-2 bg-paper-subtle/40 text-2xs uppercase tracking-wide text-ink-muted font-semibold flex items-center gap-1.5">
                <Package size={12}/> Verify load
              </div>
              {items.map(li => {
                const planned = Number(li.qty_planned);
                const loaded = loadedQtys.get(li.product_id) ?? planned;
                const mismatch = Math.abs(loaded - planned) > 0.01;
                return (
                  <div key={li.id} className="px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="font-semibold text-sm flex-1 min-w-0 truncate">{li.product?.name ?? "—"}</span>
                      <span className="text-2xs text-ink-muted whitespace-nowrap">
                        Planned: <span className="tabular font-medium text-ink">{planned.toFixed(0)}</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-2xs text-ink-subtle flex-1">
                        {li.product?.unit}
                        {Number(li.source_buffer_qty) > 0 && Number(li.source_pre_order_qty) > 0 && (
                          <> · {Number(li.source_pre_order_qty).toFixed(0)} pre-order + {Number(li.source_buffer_qty).toFixed(0)} buffer</>
                        )}
                        {Number(li.source_buffer_qty) > 0 && Number(li.source_pre_order_qty) === 0 && <> · buffer only</>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-2xs text-ink-muted">Loaded:</span>
                        <Input
                          type="number"
                          step="0.001"
                          inputMode="decimal"
                          value={loaded}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value) || 0;
                            const n = new Map(loadedQtys); n.set(li.product_id, v); setLoadedQtys(n);
                          }}
                          className={`text-right tabular w-20 h-8 text-sm ${mismatch ? "border-warn" : ""}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mismatch banner */}
            {Array.from(loadedQtys.entries()).some(([pid, q]) => {
              const li = items.find(x => x.product_id === pid);
              return li && Math.abs(q - Number(li.qty_planned)) > 0.01;
            }) && (
              <div className="bg-warn-soft border border-warn/30 rounded p-2.5 mb-4 text-xs text-warn flex items-start gap-1.5">
                <AlertCircle size={12} className="shrink-0 mt-0.5"/>
                <span>
                  Some quantities differ from plan. That&apos;s fine — make sure they reflect what&apos;s actually on the truck.
                </span>
              </div>
            )}
          </>
        )}

        {!isLeadOrAdmin && (
          <div className="bg-paper-subtle border border-paper-line rounded p-2.5 mb-4 text-xs text-ink-muted">
            You&apos;re not the lead for this trip. {trip.lead?.full_name ?? "The lead"} needs to start it from their phone.
          </div>
        )}

        {/* "To load" total — small reminder right above the start button */}
        {items.length > 0 && (
          <div className="text-center mb-2 text-xs text-ink-muted">
            Total to load: <span className="font-semibold text-ink tabular">{totalLoaded.toFixed(0)}</span>
          </div>
        )}

        {/* Action */}
        <Button
          className="w-full"
          size="lg"
          onClick={handleStart}
          disabled={pending || items.length === 0 || !isLeadOrAdmin}
        >
          <Truck size={14}/> {pending ? "Starting…" : "Start Trip"}
        </Button>
        <p className="text-2xs text-center text-ink-subtle mt-2">
          Once started, you&apos;ll go straight to the billing screen.
        </p>

        {/* Back to orders */}
        {preOrderBills.length > 0 && (
          <Button
            className="w-full mt-3"
            variant="ghost"
            size="sm"
            onClick={() => setStep("orders")}
          >
            <ArrowLeft size={11}/> Back to orders
          </Button>
        )}
          </>
        )}
      </div>
    </div>
  );
}
