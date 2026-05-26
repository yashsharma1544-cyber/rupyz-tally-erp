"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Truck, Send, Clock, ChevronDown, ChevronRight, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { shipTruck } from "@/app/(app)/dispatches/actions";

interface OrderInTruck {
  orderId: string;
  rupyzOrderId: string;
  customerName: string;
  beatName: string | null;
  qty: number;
  amount: number;
}

interface TruckLoading {
  loadId: string;
  vehicleNumber: string;
  loaders: string;
  dispatchCount: number;
  orderCount: number;
  totalQty: number;
  totalAmount: number;
  oldestLoadedAt: string;
  orders: OrderInTruck[];
}

interface PersonOption {
  id: string;
  name: string;
  phone: string | null;
  role: string;
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export function TrucksLoadingPanel({ trucks, people }: { trucks: TruckLoading[]; people: PersonOption[] }) {
  const router = useRouter();
  const [pendingLoad, setPendingLoad] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  // dispatch dialog state
  const [dialogLoad, setDialogLoad] = useState<TruckLoading | null>(null);
  const [driverId, setDriverId] = useState("");
  const [helperId, setHelperId] = useState("");

  function formatRelative(iso: string): string {
    const ts = new Date(iso).getTime();
    const now = Date.now();
    const mins = Math.floor((now - ts) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function toggleExpand(key: string) {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
  }

  function openDispatchDialog(truck: TruckLoading) {
    setDialogLoad(truck);
    setDriverId("");
    setHelperId("");
  }

  function confirmDispatch() {
    if (!dialogLoad) return;
    if (!driverId) { toast.error("Select a driver"); return; }
    const loadId = dialogLoad.loadId;
    setPendingLoad(loadId);
    startTransition(async () => {
      const res = await shipTruck({
        loadId,
        driverUserId: driverId,
        helperUserId: helperId || undefined,
      });
      setPendingLoad(null);
      if ("error" in res && res.error) { toast.error(res.error); return; }
      const dispatchCount = res.dispatchCount ?? 0;
      toast.success(dispatchCount === 1 ? "1 order dispatched" : `${dispatchCount} orders dispatched`);
      setDialogLoad(null);
      router.refresh();
    });
  }

  return (
    <div className="mb-3">
      <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold mb-2 flex items-center gap-1.5">
        <Truck size={11}/> Vehicles loading
      </h2>
      <div className="space-y-2">
        {trucks.map(truck => {
          const key = truck.loadId;
          const isExpanded = expanded.has(key);
          const orderWord = truck.orderCount === 1 ? "order" : "orders";
          return (
            <div key={key} className="bg-paper-card border border-warn/40 bg-warn-soft/20 rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => toggleExpand(key)}
                className="w-full text-left p-3 hover:bg-warn-soft/10 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="font-semibold text-sm font-mono inline-flex items-center gap-1.5">
                    {isExpanded ? <ChevronDown size={12} className="text-ink-muted"/> : <ChevronRight size={12} className="text-ink-muted"/>}
                    {truck.vehicleNumber || "No vehicle"}
                  </div>
                  <div className="text-2xs text-ink-muted inline-flex items-center gap-1 shrink-0">
                    <Clock size={9}/> {formatRelative(truck.oldestLoadedAt)}
                  </div>
                </div>
                {truck.loaders && (
                  <div className="text-2xs text-ink-muted mb-1 ml-4 inline-flex items-center gap-1">
                    <Users size={9}/> {truck.loaders}
                  </div>
                )}
                <div className="text-2xs text-ink-muted ml-4">
                  <span className="tabular"><strong className="text-ink">{truck.orderCount}</strong> {orderWord}</span>
                  <span className="text-ink-subtle"> · </span>
                  <span className="tabular"><strong className="text-ink">{truck.totalQty.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</strong> units</span>
                  <span className="text-ink-subtle"> · </span>
                  <span className="tabular">{formatINR(truck.totalAmount)}</span>
                </div>
              </button>

              {isExpanded && truck.orders.length > 0 && (
                <div className="border-t border-warn/30 bg-paper-card/60 divide-y divide-paper-line">
                  {truck.orders.map(o => (
                    <div key={o.orderId} className="px-3 py-2 text-xs">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium truncate">{o.customerName}</span>
                        <span className="text-2xs text-ink-muted tabular shrink-0">
                          {o.qty.toLocaleString("en-IN", { maximumFractionDigits: 1 })} units · {formatINR(o.amount)}
                        </span>
                      </div>
                      <div className="text-2xs text-ink-subtle mt-0.5">
                        <span className="font-mono">{o.rupyzOrderId}</span>
                        {o.beatName && <> · {o.beatName}</>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-warn/30 bg-paper-card/40 p-2.5">
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => openDispatchDialog(truck)}
                  disabled={!!pendingLoad}
                >
                  <Send size={12}/> Vehicle left / dispatched
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Driver + helper dialog */}
      {dialogLoad && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={() => !pendingLoad && setDialogLoad(null)}>
          <div className="bg-paper-card border border-paper-line rounded-lg w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Dispatch {dialogLoad.vehicleNumber}</h3>
              <button type="button" onClick={() => !pendingLoad && setDialogLoad(null)} className="text-ink-subtle hover:text-ink">
                <X size={16}/>
              </button>
            </div>
            <p className="text-2xs text-ink-muted mb-3">
              {dialogLoad.orderCount} order{dialogLoad.orderCount === 1 ? "" : "s"} · who is driving?
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1">Driver <span className="text-danger">*</span></label>
                <select
                  className="w-full px-3 py-2 text-sm bg-paper-card border border-paper-line rounded focus:outline-none focus:ring-2 focus:ring-accent/30"
                  value={driverId}
                  onChange={e => setDriverId(e.target.value)}
                  autoFocus
                >
                  <option value="">Select driver…</option>
                  {people.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.phone ? ` · ${p.phone}` : ""}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1">Helper <span className="text-2xs text-ink-subtle font-normal">(optional)</span></label>
                <select
                  className="w-full px-3 py-2 text-sm bg-paper-card border border-paper-line rounded focus:outline-none focus:ring-2 focus:ring-accent/30"
                  value={helperId}
                  onChange={e => setHelperId(e.target.value)}
                >
                  <option value="">No helper</option>
                  {people.filter(p => p.id !== driverId).map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.phone ? ` · ${p.phone}` : ""}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <Button className="flex-1" onClick={confirmDispatch} disabled={!!pendingLoad || !driverId}>
                <Send size={13}/> {pendingLoad ? "Dispatching…" : "Confirm dispatch"}
              </Button>
              <Button variant="outline" onClick={() => setDialogLoad(null)} disabled={!!pendingLoad}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
