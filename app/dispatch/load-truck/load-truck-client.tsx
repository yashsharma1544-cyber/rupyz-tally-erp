"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Truck, CheckSquare, Square, ChevronDown, ChevronRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { dispatchSelectedOrders } from "@/app/(app)/dispatches/actions";

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

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
}

type Step = "pick" | "details";

export function LoadTruckWizard({
  beatGroups, focusBeatId,
}: {
  beatGroups: BeatGroup[];
  focusBeatId: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("pick");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Beats expanded by default: just the focusBeatId if set, else all if there
  // are 2 or fewer beats, else none.
  const [expandedBeats, setExpandedBeats] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (focusBeatId) s.add(focusBeatId);
    else if (beatGroups.length <= 2) for (const b of beatGroups) s.add(b.beatId);
    return s;
  });

  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  // Flat lookup: orderId -> {beatName, order}
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

  function toggleOne(id: string) {
    setSelected(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }
  function toggleBeatExpanded(beatId: string) {
    setExpandedBeats(prev => {
      const s = new Set(prev);
      if (s.has(beatId)) s.delete(beatId);
      else s.add(beatId);
      return s;
    });
  }

  function selectAllInBeat(beatId: string) {
    const beat = beatGroups.find(b => b.beatId === beatId);
    if (!beat) return;
    setSelected(prev => {
      const s = new Set(prev);
      for (const o of beat.orders) s.add(o.id);
      return s;
    });
  }
  function clearBeat(beatId: string) {
    const beat = beatGroups.find(b => b.beatId === beatId);
    if (!beat) return;
    setSelected(prev => {
      const s = new Set(prev);
      for (const o of beat.orders) s.delete(o.id);
      return s;
    });
  }
  function clearAll() { setSelected(new Set()); }

  function handleConfirm() {
    if (!vehicle.trim() || !driver.trim()) {
      toast.error("Vehicle # and driver name are required");
      return;
    }
    startTransition(async () => {
      const res = await dispatchSelectedOrders({
        orderIds: Array.from(selected),
        vehicleNumber: vehicle.trim(),
        driverName: driver.trim(),
        driverPhone: driverPhone.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      if (res.failed && res.failed > 0) {
        toast.warning(`${res.succeeded} of ${res.total} dispatched · ${res.failed} failed`);
      } else {
        toast.success(`${res.succeeded} order${res.succeeded === 1 ? "" : "s"} dispatched`);
      }
      router.push(`/dispatch`);
    });
  }

  // ============ STEP 1: PICK ============
  if (step === "pick") {
    const totalAvailableOrders = beatGroups.reduce((s, b) => s + b.orders.length, 0);

    return (
      <div className="min-h-screen bg-paper pb-24">
        <div className="max-w-md mx-auto px-3 py-4">
          <Link href="/dispatch" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
            <ArrowLeft size={11}/> Cancel
          </Link>

          <div className="text-2xs text-accent mb-1">Step 1 of 2</div>
          <h1 className="text-base font-semibold leading-tight">
            Which orders go on this truck?
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            Pick from any beat. Orders can be combined across beats.
          </p>

          {selected.size > 0 && (
            <div className="flex items-center gap-3 mt-3 mb-1 text-xs">
              <button type="button" onClick={clearAll} className="text-ink-muted hover:underline">
                Clear all selections
              </button>
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
                  <div
                    key={group.beatId}
                    className="bg-paper-card border border-paper-line rounded-md overflow-hidden"
                  >
                    {/* Beat header — tap to expand/collapse */}
                    <button
                      type="button"
                      onClick={() => toggleBeatExpanded(group.beatId)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-paper-subtle/50 transition-colors text-left"
                    >
                      <div className="shrink-0">
                        {isExpanded
                          ? <ChevronDown size={14} className="text-ink-muted"/>
                          : <ChevronRight size={14} className="text-ink-muted"/>
                        }
                      </div>
                      <div className="w-7 h-7 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
                        <MapPin size={12}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{group.beatName}</div>
                        <div className="text-2xs text-ink-muted mt-0.5">
                          {beatSelectedCount > 0
                            ? <><strong className="text-accent tabular">{beatSelectedCount}</strong> of {group.orders.length} selected · <span className="tabular">{formatKg(beatTotalKg)}</span></>
                            : <>{group.orders.length} order{group.orders.length === 1 ? "" : "s"} available</>
                          }
                        </div>
                      </div>
                    </button>

                    {/* Beat orders — only when expanded */}
                    {isExpanded && (
                      <div className="border-t border-paper-line divide-y divide-paper-line">
                        {/* Beat-level select-all/clear row */}
                        <div className="px-3 py-1.5 bg-paper-subtle/40 flex items-center gap-3 text-2xs">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); allInBeatSelected ? clearBeat(group.beatId) : selectAllInBeat(group.beatId); }}
                            className="text-accent hover:underline"
                          >
                            {allInBeatSelected ? "Clear this beat" : "Select all in this beat"}
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
                                {isSelected
                                  ? <CheckSquare size={16} className="text-accent"/>
                                  : <Square size={16} className="text-ink-subtle"/>
                                }
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{o.customerName}</div>
                                <div className="text-2xs text-ink-muted mt-0.5">
                                  <span className="font-mono">{o.rupyzOrderId}</span>
                                  {o.customerCity && <> · {o.customerCity}</>}
                                  {o.appStatus === "partially_dispatched" && <> · <span className="text-warn">partly sent</span></>}
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

        {/* Sticky bottom: count + Next */}
        <div className="fixed bottom-0 left-0 right-0 bg-paper-card/95 backdrop-blur border-t border-paper-line p-3">
          <div className="max-w-md mx-auto">
            <div className="text-2xs text-center text-ink-muted mb-1.5">
              {selected.size === 0
                ? "Tap orders to add them to the truck"
                : <><strong className="text-ink tabular">{selected.size}</strong> selected · <strong className="text-ink tabular">{formatKg(totalKg)}</strong> · <strong className="text-ink tabular">{formatINR(totalAmount)}</strong></>
              }
            </div>
            <Button
              className="w-full"
              size="lg"
              disabled={selected.size === 0}
              onClick={() => setStep("details")}
            >
              Next: Truck details <ArrowRight size={14}/>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ============ STEP 2: DETAILS ============
  // Group selected orders by beat for the preview list
  const selectedByBeat = new Map<string, { beatName: string; orders: OrderItem[] }>();
  for (const x of selectedOrders) {
    const key = x.beatName;
    if (!selectedByBeat.has(key)) selectedByBeat.set(key, { beatName: x.beatName, orders: [] });
    selectedByBeat.get(key)!.orders.push(x.order);
  }
  const previewGroups = Array.from(selectedByBeat.values()).sort((a, b) => a.beatName.localeCompare(b.beatName));

  return (
    <div className="min-h-screen bg-paper pb-24">
      <div className="max-w-md mx-auto px-3 py-4">
        <button
          type="button"
          onClick={() => setStep("pick")}
          className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft size={11}/> Back to selection
        </button>

        <div className="text-2xs text-accent mb-1">Step 2 of 2</div>
        <h1 className="text-base font-semibold leading-tight">Truck details</h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Loading <strong className="text-ink tabular">{selected.size}</strong> order{selected.size === 1 ? "" : "s"} ·
          {" "}<strong className="text-ink tabular">{formatKg(totalKg)}</strong> ·
          {" "}<strong className="text-ink tabular">{formatINR(totalAmount)}</strong>
          {previewGroups.length > 1 && <> · across <strong className="text-ink">{previewGroups.length}</strong> beats</>}
        </p>

        {/* Selected orders preview, grouped by beat */}
        <div className="mt-4">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold mb-2">
            Orders on this truck
          </h2>
          <div className="space-y-2">
            {previewGroups.map(g => (
              <div key={g.beatName} className="bg-paper-card border border-paper-line rounded overflow-hidden">
                <div className="px-3 py-1.5 bg-paper-subtle/40 text-2xs font-semibold text-ink-muted uppercase tracking-wide">
                  {g.beatName} · {g.orders.length} order{g.orders.length === 1 ? "" : "s"}
                </div>
                <div className="divide-y divide-paper-line">
                  {g.orders.map(o => (
                    <div key={o.id} className="px-3 py-2 flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium truncate flex-1">{o.customerName}</span>
                      <span className="text-2xs text-ink-muted tabular shrink-0">
                        {formatKg(o.kg)} · {formatINR(o.totalAmount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Vehicle / driver — below the preview */}
        <div className="mt-5 pt-4 border-t border-paper-line space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold">
            Vehicle &amp; driver
          </h2>
          <div>
            <Label className="text-xs">Vehicle # <span className="text-danger">*</span></Label>
            <Input
              className="mt-1"
              placeholder="MH-20 AB 1234"
              value={vehicle}
              onChange={e => setVehicle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs">Driver name <span className="text-danger">*</span></Label>
            <Input
              className="mt-1"
              placeholder="e.g. Ramesh"
              value={driver}
              onChange={e => setDriver(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs text-ink-muted">Driver phone</Label>
            <Input
              className="mt-1"
              placeholder="9876543210 (optional)"
              inputMode="tel"
              value={driverPhone}
              onChange={e => setDriverPhone(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs text-ink-muted">Notes</Label>
            <Textarea
              className="mt-1"
              rows={2}
              placeholder="Any extra info (optional)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Sticky confirm */}
      <div className="fixed bottom-0 left-0 right-0 bg-paper-card/95 backdrop-blur border-t border-paper-line p-3">
        <div className="max-w-md mx-auto">
          <Button
            className="w-full"
            size="lg"
            onClick={handleConfirm}
            disabled={pending || !vehicle.trim() || !driver.trim()}
          >
            <Truck size={14}/> {pending ? "Dispatching…" : `Dispatch ${selected.size} order${selected.size === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
