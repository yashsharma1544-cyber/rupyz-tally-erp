"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Truck, CheckSquare, Square, ChevronDown, ChevronRight, MapPin, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { dispatchSelectedOrders, createVehicle } from "@/app/(app)/dispatches/actions";

interface OrderItem {
  id: string;
  rupyzOrderId: string;
  totalAmount: number;
  appStatus: string;
  customerName: string;
  customerCity: string | null;
  kg: number;
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

  // ---- Step 1 state: vehicle + loaders ----
  const [vehicleOptions, setVehicleOptions] = useState<VehicleOption[]>(vehicles);
  const [vehicleId, setVehicleId] = useState<string>("");
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [newVehNumber, setNewVehNumber] = useState("");
  const [newVehMake, setNewVehMake] = useState("");
  const [newVehCap, setNewVehCap] = useState("");
  const [addingVehicle, startAddVehicle] = useTransition();
  const [loaderIds, setLoaderIds] = useState<Set<string>>(new Set());

  // ---- Step 2 state: order selection ----
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  const selectedOrders = useMemo(
    () => Array.from(selected).map(id => allOrdersFlat.get(id)).filter((x): x is { beatName: string; order: OrderItem } => !!x),
    [selected, allOrdersFlat],
  );
  const totalKg     = selectedOrders.reduce((s, x) => s + x.order.kg, 0);
  const totalAmount = selectedOrders.reduce((s, x) => s + x.order.totalAmount, 0);

  const selectedVehicle = vehicleOptions.find(v => v.id === vehicleId);

  function toggleLoader(id: string) {
    setLoaderIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
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

  function toggleOne(id: string) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }
  function toggleBeatExpanded(beatId: string) {
    setExpandedBeats(prev => { const s = new Set(prev); s.has(beatId) ? s.delete(beatId) : s.add(beatId); return s; });
  }
  function selectAllInBeat(beatId: string) {
    const beat = beatGroups.find(b => b.beatId === beatId);
    if (!beat) return;
    setSelected(prev => { const s = new Set(prev); for (const o of beat.orders) s.add(o.id); return s; });
  }
  function clearBeat(beatId: string) {
    const beat = beatGroups.find(b => b.beatId === beatId);
    if (!beat) return;
    setSelected(prev => { const s = new Set(prev); for (const o of beat.orders) s.delete(o.id); return s; });
  }
  function clearAll() { setSelected(new Set()); }

  function handleConfirm() {
    if (!vehicleId) { toast.error("Select a vehicle"); return; }
    if (selected.size === 0) { toast.error("Select at least one order"); return; }
    startTransition(async () => {
      const res = await dispatchSelectedOrders({
        orderIds: Array.from(selected),
        vehicleId,
        loaderUserIds: Array.from(loaderIds),
      });
      if ("error" in res && res.error) { toast.error(res.error); return; }
      const succeeded = res.succeeded ?? 0;
      const failed = res.failed ?? 0;
      const total = res.total ?? 0;
      const firstFailureErr = res.results?.find(r => !r.ok)?.error;
      if (succeeded === 0) {
        toast.error(firstFailureErr ?? `All ${total} failed`, { duration: 10000 });
        return;
      }
      if (failed > 0) {
        toast.warning(`${succeeded} of ${total} loaded · ${failed} failed`, { description: firstFailureErr, duration: 9000 });
      } else {
        toast.success(succeeded === 1 ? `1 order loaded` : `${succeeded} orders loaded`);
      }
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

          {/* Vehicle */}
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
                  <Button size="sm" onClick={handleAddVehicle} disabled={addingVehicle}>
                    {addingVehicle ? "Adding…" : "Add vehicle"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setShowAddVehicle(false); setNewVehNumber(""); setNewVehMake(""); setNewVehCap(""); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Loaders */}
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
              Next: pick orders <ArrowRight size={14}/>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ============ STEP 2: PICK ORDERS ============
  const totalAvailableOrders = beatGroups.reduce((s, b) => s + b.orders.length, 0);

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
        <h1 className="text-base font-semibold leading-tight">Which orders?</h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Loading into <strong className="text-ink">{selectedVehicle?.number}</strong>. Tap orders to load them.
        </p>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 mt-3 mb-1 text-xs">
            <button type="button" onClick={clearAll} className="text-ink-muted hover:underline">Clear all selections</button>
          </div>
        )}

        {totalAvailableOrders === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center mt-4">
            <p className="text-sm font-semibold mb-0.5">Nothing to load</p>
            <p className="text-xs text-ink-muted">No approved orders right now.</p>
          </div>
        ) : (
          <div className="space-y-2 mt-3">
            {beatGroups.map(group => {
              const isExpanded = expandedBeats.has(group.beatId);
              const beatSelectedCount = group.orders.filter(o => selected.has(o.id)).length;
              const beatTotalKg = group.orders.reduce((s, o) => s + (selected.has(o.id) ? o.kg : 0), 0);
              const allInBeatSelected = beatSelectedCount === group.orders.length;
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
                        {beatSelectedCount > 0
                          ? <><span className="text-accent tabular font-semibold">{beatSelectedCount} of {group.orders.length} selected</span> · <span className="tabular">{formatKg(beatTotalKg)}</span></>
                          : <>{group.orders.length} order{group.orders.length === 1 ? "" : "s"} available</>}
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-paper-line divide-y divide-paper-line">
                      <div className="px-3 py-1.5 bg-paper-subtle/40 flex items-center gap-3 text-2xs">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); allInBeatSelected ? clearBeat(group.beatId) : selectAllInBeat(group.beatId); }}
                          className="text-accent hover:underline"
                        >
                          {allInBeatSelected ? "Clear this beat" : "Select all in beat"}
                        </button>
                      </div>

                      {group.orders.map(o => {
                        const isSelected = selected.has(o.id);
                        return (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => toggleOne(o.id)}
                            className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
                              isSelected ? "bg-accent-soft/30" : "hover:bg-paper-subtle/40"
                            }`}
                          >
                            <div className="shrink-0">
                              {isSelected ? <CheckSquare size={16} className="text-accent"/> : <Square size={16} className="text-ink-subtle"/>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">{o.customerName}</div>
                              <div className="text-2xs text-ink-muted mt-0.5">
                                <span className="font-mono">{o.rupyzOrderId}</span>
                                {o.customerCity && <> · {o.customerCity}</>}
                                {o.appStatus === "partially_dispatched" && <> · <span className="text-warn">partly sent</span></>}
                                {o.appStatus === "loaded" && <> · <span className="text-accent">loaded</span></>}
                              </div>
                              <div className="text-2xs text-ink-muted mt-0.5">
                                <span className="tabular"><strong className="text-ink">{formatKg(o.kg)}</strong></span>
                                <span className="text-ink-subtle"> · </span>
                                <span className="tabular">{formatINR(o.totalAmount)}</span>
                              </div>
                            </div>
                          </button>
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

      <div className="fixed bottom-0 left-0 right-0 bg-paper-card/95 backdrop-blur border-t border-paper-line p-3">
        <div className="max-w-md mx-auto">
          <div className="text-2xs text-center text-ink-muted mb-1.5">
            {selected.size === 0
              ? "Select orders to load"
              : <><strong className="text-ink tabular">{selected.size}</strong> · <strong className="text-ink tabular">{formatKg(totalKg)}</strong> · <strong className="text-ink tabular">{formatINR(totalAmount)}</strong></>}
          </div>
          <Button className="w-full" size="lg" onClick={handleConfirm} disabled={pending || selected.size === 0}>
            <Truck size={14}/> {pending
              ? "Loading…"
              : selected.size === 1 ? "Load 1 order" : `Load ${selected.size} orders`}
          </Button>
        </div>
      </div>
    </div>
  );
}
