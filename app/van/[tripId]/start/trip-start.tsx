"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Truck, Package, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { AppUser, VanTrip, TripLoadItem } from "@/lib/types";
import { toast } from "sonner";
import { markTripLoaded } from "@/app/(app)/trips/actions";

export function TripStart({
  me, trip, initialLoadItems,
}: {
  me: AppUser;
  trip: VanTrip;
  initialLoadItems: TripLoadItem[];
}) {
  const router = useRouter();
  const [items] = useState<TripLoadItem[]>(initialLoadItems);
  const [loadedQtys, setLoadedQtys] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const li of initialLoadItems) {
      m.set(li.product_id, Number(li.qty_loaded ?? li.qty_planned));
    }
    return m;
  });
  const [pending, startTransition] = useTransition();

  const isLeadOrAdmin = me.role === "admin" || me.id === trip.lead_id;

  const totalPlanned = items.reduce((s, li) => s + Number(li.qty_planned), 0);
  const totalLoaded = Array.from(loadedQtys.values()).reduce((s, q) => s + q, 0);

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
            <div className="text-2xs text-ink-muted uppercase tracking-wide">Planned</div>
            <div className="text-lg font-bold tabular">{totalPlanned.toFixed(0)}</div>
            <div className="text-2xs text-ink-subtle">{items.length} SKU{items.length !== 1 ? "s" : ""}</div>
          </div>
          <div className="bg-paper-card border border-paper-line rounded p-2.5">
            <div className="text-2xs text-ink-muted uppercase tracking-wide">To load</div>
            <div className="text-lg font-bold tabular text-accent">{totalLoaded.toFixed(0)}</div>
            <div className="text-2xs text-ink-subtle">edit below if different</div>
          </div>
        </div>

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
      </div>
    </div>
  );
}
