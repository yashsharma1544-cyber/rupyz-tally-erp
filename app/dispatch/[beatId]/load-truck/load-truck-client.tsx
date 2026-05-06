"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Truck, CheckSquare, Square } from "lucide-react";
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
  beat, orders,
}: {
  beat: { id: string; name: string };
  orders: OrderItem[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("pick");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  const selectedOrders = orders.filter(o => selected.has(o.id));
  const totalKg     = selectedOrders.reduce((s, o) => s + o.kg, 0);
  const totalAmount = selectedOrders.reduce((s, o) => s + o.totalAmount, 0);

  function toggleOne(id: string) {
    setSelected(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }
  function selectAll() { setSelected(new Set(orders.map(o => o.id))); }
  function clearAll()  { setSelected(new Set()); }

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
      router.push(`/dispatch/${beat.id}`);
    });
  }

  // ============ STEP 1: PICK ============
  if (step === "pick") {
    return (
      <div className="min-h-screen bg-paper pb-24">
        <div className="max-w-md mx-auto px-3 py-4">
          <Link href={`/dispatch/${beat.id}`} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
            <ArrowLeft size={11}/> Cancel
          </Link>

          <div className="text-2xs text-accent mb-1">Step 1 of 2</div>
          <h1 className="text-base font-semibold leading-tight">
            Which orders go on this truck?
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">{beat.name}</p>

          <div className="flex items-center gap-3 mt-3 mb-2 text-xs">
            <button type="button" onClick={selectAll} className="text-accent hover:underline">
              Select all
            </button>
            <span className="text-ink-subtle">·</span>
            <button type="button" onClick={clearAll} className="text-ink-muted hover:underline" disabled={selected.size === 0}>
              Clear
            </button>
          </div>

          {orders.length === 0 ? (
            <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
              <p className="text-sm font-semibold mb-0.5">Nothing to load</p>
              <p className="text-xs text-ink-muted">No approved orders in this beat right now.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {orders.map(o => {
                const isSelected = selected.has(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggleOne(o.id)}
                    className={`w-full text-left bg-paper-card border rounded p-3 flex items-center gap-3 transition-colors ${
                      isSelected ? "border-accent bg-accent-soft/30" : "border-paper-line"
                    }`}
                  >
                    <div className="shrink-0">
                      {isSelected
                        ? <CheckSquare size={18} className="text-accent"/>
                        : <Square size={18} className="text-ink-subtle"/>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{o.customerName}</div>
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

        {/* Sticky bottom bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-paper-card/95 backdrop-blur border-t border-paper-line p-3">
          <div className="max-w-md mx-auto">
            <div className="text-2xs text-center text-ink-muted mb-1.5">
              {selected.size === 0
                ? "Tap orders above to select"
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
        </p>

        {/* Selected orders preview */}
        <div className="mt-4">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold mb-2">
            Orders on this truck
          </h2>
          <div className="bg-paper-card border border-paper-line rounded divide-y divide-paper-line">
            {selectedOrders.map(o => (
              <div key={o.id} className="px-3 py-2 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium truncate flex-1">{o.customerName}</span>
                <span className="text-2xs text-ink-muted tabular shrink-0">
                  {formatKg(o.kg)} · {formatINR(o.totalAmount)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Vehicle / driver */}
        <div className="mt-5 pt-4 border-t border-paper-line space-y-3">
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
