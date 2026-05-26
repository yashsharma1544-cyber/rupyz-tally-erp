"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Truck, CheckSquare, Square, ChevronDown, ChevronRight, MapPin, Plus, Users, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { dispatchSelectedOrders, createVehicle } from "@/app/(app)/dispatches/actions";

interface ItemOption {
  id: string;
  name: string;
  unit: string | null;
  remaining: number;
}

interface OrderItem {
  id: string;
  rupyzOrderId: string;
  totalAmount: number;
  appStatus: string;
  customerName: string;
  customerCity: string | null;
  kg: number;
  items: ItemOption[];
}

interface BeatGroup {
  beatId: string;
  beatName: string;
  orders: OrderItem[];
}

interface VehicleOption {
  id: string;
  number: string;
  make: string | null;
  capacityKg: number | null;
}

interface LoaderOption {
  id: string;
  name: string;
  phone: string | null;
  role: string;
}

interface LineState {
  checked: boolean;
  qty: number;
}

interface LoadedOrder {
  lines: { orderItemId: string; qty: number }[];
  totalUnits: number;
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
}

type Step = "vehicle" | "orders";

export function LoadTruckWizard({
  beatGroups, focusBeatId, vehicles, loaders,
}: {
  beatGroups: BeatGroup[];
  focusBeatId: string | null;
  vehicles: VehicleOption[];
  loaders: LoaderOption[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("vehicle");

  // ---- Step 1: vehicle + loaders ----
  const [vehicleOptions, setVehicleOptions] = useState<VehicleOption[]>(vehicles);
  const [vehicleId, setVehicleId] = useState<string>("");
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [newVehNumber, setNewVehNumber] = useState("");
  const [newVehMake, setNewVehMake] = useState("");
  const [newVehCap, setNewVehCap] = useState("");
  const [addingVehicle, startAddVehicle] = useTransition();
  const [loaderIds, setLoaderIds] = useState<Set<string>>(new Set());

  // ---- Step 2: open-each-order loading ----
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [lineState, setLineState] = useState<Record<string, LineState>>({});
  const [loaded, setLoaded] = useState<Record<string, LoadedOrder>>({});
  const [expandedBeats, setExpandedBeats] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (focusBeatId) s.add(focusBeatId);
    else if (beatGroups.length <= 2) for (const b of beatGroups) s.add(b.beatId);
    return s;
  });
  const [pending, startTransition] = useTransition();

  const allOrdersFlat = useMemo(() => {
    const m = new Map<string, { beatName: string; order: OrderItem }>();
    for (const g of beatGroups) for (const o of g.orders) m.set(o.id, { beatName: g.beatName, order: o });
    return m;
  }, [beatGroups]);

  const selectedVehicle = vehicleOptions.find(v => v.id === vehicleId);
  const loadedCount = Object.keys(loaded).length;
  const loadedUnits = Object.values(loaded).reduce((s, l) => s + l.totalUnits, 0);

  function toggleLoader(id: string) {
    setLoaderIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  function handleAddVehicle() {
    if (!newVehNumber.trim()) { toast.error("Vehicle number is required"); return; }
    startAddVehicle(async () => {
      const res = await createVehicle({
        number: newVehNumber.trim(),
        make: newVehMake.trim() || undefined,
        capacityKg: newVehCap.trim() ? Number(newVehCap) : undefined,
      });
      if ("error" in res && res.error) { toast.error(res.error); return; }
      const v = res.vehicle!;
      const opt: VehicleOption = { id: v.id, number: v.number, make: v.make ?? null, capacityKg: v.capacity_kg ?? null };
      setVehicleOptions(prev => prev.some(x => x.id === opt.id) ? prev : [...prev, opt].sort((a, b) => a.number.localeCompare(b.number)));
      setVehicleId(opt.id);
      setShowAddVehicle(false);
      setNewVehNumber(""); setNewVehMake(""); setNewVehCap("");
      toast.success(`Vehicle ${opt.number} added`);
    });
  }

  function toggleBeatExpanded(beatId: string) {
    setExpandedBeats(prev => { const s = new Set(prev); s.has(beatId) ? s.delete(beatId) : s.add(beatId); return s; });
  }

  function openOrder(order: OrderItem) {
    const existing = loaded[order.id];
    const init: Record<string, LineState> = {};
    for (const it of order.items) {
      if (existing) {
        const ln = existing.lines.find(l => l.orderItemId === it.id);
        init[it.id] = { checked: !!ln && ln.qty > 0, qty: ln ? ln.qty : it.remaining };
      } else {
        init[it.id] = { checked: true, qty: it.remaining };
      }
    }
    setLineState(init);
    setOpenOrderId(order.id);
  }

  function closeOrder() {
    setOpenOrderId(null);
    setLineState({});
  }

  function setLineChecked(itemId: string, checked: boolean) {
    setLineState(prev => ({ ...prev, [itemId]: { ...prev[itemId], checked } }));
  }
  function setLineQty(itemId: string, qty: number, max: number) {
    const clamped = Math.max(0, Math.min(qty, max));
    setLineState(prev => ({ ...prev, [itemId]: { ...prev[itemId], qty: clamped, checked: clamped > 0 } }));
  }

  function markLoaded(order: OrderItem) {
    const lines = order.items
      .map(it => ({ orderItemId: it.id, qty: lineState[it.id]?.checked ? lineState[it.id].qty : 0 }))
      .filter(l => l.qty > 0);
    if (lines.length === 0) { toast.error("Tick at least one item (qty > 0) to load this order"); return; }
    const totalUnits = lines.reduce((s, l) => s + l.qty, 0);
    setLoaded(prev => ({ ...prev, [order.id]: { lines, totalUnits } }));
    closeOrder();
    toast.success(`${order.customerName} marked loaded`);
  }

  function unloadOrder(orderId: string) {
    setLoaded(prev => { const c = { ...prev }; delete c[orderId]; return c; });
  }

  function handleLoadVehicle() {
    if (!vehicleId) { toast.error("Select a vehicle"); return; }
    const loadLines = Object.entries(loaded).map(([orderId, l]) => ({ orderId, items: l.lines }));
    if (loadLines.length === 0) { toast.error("Mark at least one order loaded"); return; }
    startTransition(async () => {
      const res = await dispatchSelectedOrders({
        loadLines,
        vehicleId,
        loaderUserIds: Array.from(loaderIds),
      });
      if ("error" in res && res.error) { toast.error(res.error); return; }
      const succeeded = res.succeeded ?? 0;
      const failed = res.failed ?? 0;
      const total = res.total ?? 0;
      const firstErr = res.results?.find(r => !r.ok)?.error;
      if (succeeded === 0) { toast.error(firstErr ?? `All ${total} failed`, { duration: 10000 }); return; }
      if (failed > 0) toast.warning(`${succeeded} of ${total} loaded · ${failed} failed`, { description: firstErr, duration: 9000 });
      else toast.success(succeeded === 1 ? "1 order loaded onto vehicle" : `${succeeded} orders loaded onto vehicle`);
      router.push("/dispatch");
    });
  }

  // ============ STEP 1: VEHICLE + LOADERS ============
  if (step === "vehicle") {
    return (
      <div className="min-h-screen bg-paper pb-24">
        <div className="max-w-md mx-auto px-3 py-4">
          <Link href="/dispatch" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
            <ArrowLeft size={11}/> Cancel
          </Link>
          <div className="text-2xs text-accent mb-1">Step 1 of 2</div>
          <h1 className="text-base font-semibold leading-tight">Vehicle &amp; loaders</h1>
          <p className="text-xs text-ink-muted mt-0.5">Pick the vehicle to load and who is loading it.</p>

          <div className="mt-4">
            <Label className="text-xs">Vehicle <span className="text-danger">*</span></Label>
            {!showAddVehicle ? (
              <div className="flex items-center gap-2 mt-1">
                <select
                  className="flex-1 px-3 py-2 text-sm bg-paper-card border border-paper-line rounded focus:outline-none focus:ring-2 focus:ring-accent/30"
                  value={vehicleId}
                  onChange={e => setVehicleId(e.target.value)}
                >
                  <option value="">Select a vehicle…</option>
                  {vehicleOptions.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.number}{v.make ? ` · ${v.make}` : ""}{v.capacityKg ? ` · ${v.capacityKg}kg` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowAddVehicle(true)}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 text-xs rounded border border-paper-line bg-paper-card hover:bg-paper-subtle"
                >
                  <Plus size={13}/> Add
                </button>
              </div>
            ) : (
              <div className="mt-1 border border-paper-line rounded-md p-3 bg-paper-subtle/30 space-y-2">
                <div className="text-2xs uppercase tracking-wide text-ink-muted">New vehicle</div>
                <Input placeholder="Number e.g. MH-20 AB 1234" value={newVehNumber} onChange={e => setNewVehNumber(e.target.value)} autoFocus />
                <div className="flex gap-2">
                  <Input placeholder="Make (optional)" value={newVehMake} onChange={e => setNewVehMake(e.target.value)} />
                  <Input placeholder="Capacity kg" inputMode="numeric" value={newVehCap} onChange={e => setNewVehCap(e.target.value)} className="w-28" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleAddVehicle} disabled={addingVehicle}>{addingVehicle ? "Adding…" : "Add vehicle"}</Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowAddVehicle(false); setNewVehNumber(""); setNewVehMake(""); setNewVehCap(""); }}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5">
            <Label className="text-xs inline-flex items-center gap-1">
              <Users size={12}/> Loaders <span className="text-2xs text-ink-subtle font-normal">(who is loading)</span>
            </Label>
            {loaders.length === 0 ? (
              <p className="text-2xs text-ink-subtle mt-1"><em>No loaders configured (van_helper / dispatch users).</em></p>
            ) : (
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                {loaders.map(l => {
                  const on = loaderIds.has(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => toggleLoader(l.id)}
                      className={`text-left px-2.5 py-2 rounded border text-xs transition-colors flex items-center gap-2 ${
                        on ? "border-accent bg-accent-soft/40" : "border-paper-line bg-paper-card hover:bg-paper-subtle"
                      }`}
                    >
                      {on ? <CheckSquare size={14} className="text-accent shrink-0"/> : <Square size={14} className="text-ink-subtle shrink-0"/>}
                      <span className="truncate">{l.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-paper-card/95 backdrop-blur border-t border-paper-line p-3">
          <div className="max-w-md mx-auto">
            <div className="text-2xs text-center text-ink-muted mb-1.5">
              {selectedVehicle
                ? <>Vehicle <strong className="text-ink">{selectedVehicle.number}</strong> · <strong className="text-ink">{loaderIds.size}</strong> loader{loaderIds.size === 1 ? "" : "s"}</>
                : "Select a vehicle to continue"}
            </div>
            <Button className="w-full" size="lg" disabled={!vehicleId} onClick={() => setStep("orders")}>
              Next: load orders <ArrowRight size={14}/>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ============ STEP 2: OPEN EACH ORDER & LOAD ============
  const totalAvailableOrders = beatGroups.reduce((s, b) => s + b.orders.length, 0);
  const openOrder_ = openOrderId ? allOrdersFlat.get(openOrderId)?.order ?? null : null;

  return (
    <div className="min-h-screen bg-paper pb-24">
      <div className="max-w-md mx-auto px-3 py-4">
        <button
          type="button"
          onClick={() => setStep("vehicle")}
          className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft size={11}/> Back to vehicle
        </button>

        <div className="text-2xs text-accent mb-1">Step 2 of 2</div>
        <h1 className="text-base font-semibold leading-tight">Load orders</h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Into <strong className="text-ink">{selectedVehicle?.number}</strong>. Open each order, confirm items, mark loaded.
        </p>

        {totalAvailableOrders === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center mt-4">
            <p className="text-sm font-semibold mb-0.5">Nothing to load</p>
            <p className="text-xs text-ink-muted">No approved orders right now.</p>
          </div>
        ) : (
          <div className="space-y-2 mt-3">
            {beatGroups.map(group => {
              const isExpanded = expandedBeats.has(group.beatId);
              const beatLoadedCount = group.orders.filter(o => loaded[o.id]).length;
              return (
                <div key={group.beatId} className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleBeatExpanded(group.beatId)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-paper-subtle/50 transition-colors text-left"
                  >
                    <div className="shrink-0">
                      {isExpanded ? <ChevronDown size={14} className="text-ink-muted"/> : <ChevronRight size={14} className="text-ink-muted"/>}
                    </div>
                    <div className="w-7 h-7 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
                      <MapPin size={12}/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{group.beatName}</div>
                      <div className="text-2xs text-ink-muted mt-0.5">
                        {beatLoadedCount > 0
                          ? <><span className="text-accent tabular font-semibold">{beatLoadedCount} loaded</span> · {group.orders.length} order{group.orders.length === 1 ? "" : "s"}</>
                          : <>{group.orders.length} order{group.orders.length === 1 ? "" : "s"}</>}
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-paper-line divide-y divide-paper-line">
                      {group.orders.map(o => {
                        const isLoaded = !!loaded[o.id];
                        return (
                          <div key={o.id} className={`flex items-center ${isLoaded ? "bg-accent-soft/30" : ""}`}>
                            <button
                              type="button"
                              onClick={() => openOrder(o)}
                              className="flex-1 text-left px-3 py-2.5 flex items-center gap-3 hover:bg-paper-subtle/40 transition-colors min-w-0"
                            >
                              <div className="shrink-0">
                                {isLoaded
                                  ? <span className="w-5 h-5 rounded-full bg-accent text-paper-card flex items-center justify-center"><Check size={13}/></span>
                                  : <span className="w-5 h-5 rounded-full border border-paper-line flex items-center justify-center text-ink-subtle"><Pencil size={11}/></span>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{o.customerName}</div>
                                <div className="text-2xs text-ink-muted mt-0.5">
                                  <span className="font-mono">{o.rupyzOrderId}</span>
                                  {o.items.length > 0 && <> · {o.items.length} item{o.items.length === 1 ? "" : "s"}</>}
                                  {isLoaded && <> · <span className="text-accent font-semibold">{loaded[o.id].totalUnits.toLocaleString("en-IN", { maximumFractionDigits: 1 })} units</span></>}
                                </div>
                              </div>
                            </button>
                            {isLoaded
                              ? <button type="button" onClick={() => unloadOrder(o.id)} className="shrink-0 px-3 py-2.5 text-2xs text-ink-muted hover:text-danger">Remove</button>
                              : <ChevronRight size={14} className="text-ink-subtle shrink-0 mr-3"/>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Open-order loading sheet */}
      {openOrder_ && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={closeOrder}>
          <div className="bg-paper-card border border-paper-line rounded-t-lg sm:rounded-lg w-full sm:max-w-md max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-paper-card border-b border-paper-line px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm truncate">{openOrder_.customerName}</h3>
                  <p className="text-2xs text-ink-muted font-mono">{openOrder_.rupyzOrderId}</p>
                </div>
                <button type="button" onClick={closeOrder} className="text-ink-subtle hover:text-ink text-xs">Close</button>
              </div>
            </div>

            <div className="px-4 py-2">
              <p className="text-2xs text-ink-muted mb-2">Tick items to load. Reduce the qty if an item is short; untick if unavailable.</p>
              {openOrder_.items.length === 0 ? (
                <p className="text-xs text-ink-muted py-3">No remaining items on this order.</p>
              ) : (
                <div className="divide-y divide-paper-line">
                  {openOrder_.items.map(it => {
                    const ls = lineState[it.id] ?? { checked: true, qty: it.remaining };
                    const partial = ls.checked && ls.qty < it.remaining;
                    return (
                      <div key={it.id} className="py-2.5 flex items-center gap-3">
                        <button type="button" onClick={() => setLineChecked(it.id, !ls.checked)} className="shrink-0">
                          {ls.checked ? <CheckSquare size={18} className="text-accent"/> : <Square size={18} className="text-ink-subtle"/>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{it.name}</div>
                          <div className="text-2xs text-ink-muted">
                            Ordered: {it.remaining.toLocaleString("en-IN", { maximumFractionDigits: 1 })}{it.unit ? ` ${it.unit}` : ""}
                            {partial && <span className="text-warn"> · loading {ls.qty}</span>}
                          </div>
                        </div>
                        <input
                          type="number"
                          className="w-20 px-2 py-1.5 text-sm bg-paper-card border border-paper-line rounded text-right focus:outline-none focus:ring-2 focus:ring-accent/30"
                          value={ls.checked ? ls.qty : 0}
                          min={0}
                          max={it.remaining}
                          disabled={!ls.checked}
                          onChange={e => setLineQty(it.id, Number(e.target.value), it.remaining)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-paper-card border-t border-paper-line p-3 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={closeOrder}>Cancel</Button>
              <Button className="flex-1" onClick={() => markLoaded(openOrder_)} disabled={openOrder_.items.length === 0}>
                <Check size={14}/> Mark loaded
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-paper-card/95 backdrop-blur border-t border-paper-line p-3">
        <div className="max-w-md mx-auto">
          <div className="text-2xs text-center text-ink-muted mb-1.5">
            {loadedCount === 0
              ? "Open an order and mark it loaded"
              : <><strong className="text-ink tabular">{loadedCount}</strong> order{loadedCount === 1 ? "" : "s"} loaded · <strong className="text-ink tabular">{loadedUnits.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</strong> units</>}
          </div>
          <Button className="w-full" size="lg" onClick={handleLoadVehicle} disabled={pending || loadedCount === 0}>
            <Truck size={14}/> {pending ? "Loading…" : loadedCount === 1 ? "Load 1 order onto vehicle" : `Load ${loadedCount} orders onto vehicle`}
          </Button>
        </div>
      </div>
    </div>
  );
}
