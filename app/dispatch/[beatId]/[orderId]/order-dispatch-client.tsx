"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Truck, Minus, Plus, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { createDispatch } from "@/app/(app)/dispatches/actions";

interface OrderLine {
  id: string;
  productName: string;
  orderedQty: number;
  alreadyDispatched: number;
  remaining: number;
  price: number;
  unit: string | null;
}

interface OrderForDispatch {
  id: string;
  rupyzOrderId: string;
  totalAmount: number;
  appStatus: string;
  customer: { id: string; name: string; city: string | null; mobile: string | null } | null;
  items: OrderLine[];
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export function OrderDispatchClient({
  beatId, order,
}: {
  beatId: string;
  order: OrderForDispatch;
}) {
  const router = useRouter();

  // Per-line dispatch quantities. Default: full remaining (so "Confirm" sends
  // everything as ordered). Edit mode reveals controls so dispatcher can
  // reduce specific lines.
  const [qtys, setQtys] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const it of order.items) m.set(it.id, it.remaining);
    return m;
  });
  const [editMode, setEditMode] = useState(false);

  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  function setQty(itemId: string, qty: number) {
    setQtys(prev => {
      const m = new Map(prev);
      m.set(itemId, Math.max(0, qty));
      return m;
    });
  }
  function bumpQty(itemId: string, delta: number, max: number) {
    setQtys(prev => {
      const m = new Map(prev);
      const cur = m.get(itemId) ?? 0;
      m.set(itemId, Math.min(max, Math.max(0, cur + delta)));
      return m;
    });
  }

  // Lines actually being dispatched (qty > 0)
  const dispatchableLines = useMemo(
    () => order.items
      .map(it => ({ orderItemId: it.id, qty: qtys.get(it.id) ?? 0, line: it }))
      .filter(l => l.qty > 0),
    [order.items, qtys],
  );

  const totalAmt = useMemo(
    () => dispatchableLines.reduce((s, l) => s + l.line.price * l.qty, 0),
    [dispatchableLines],
  );

  // Will the dispatch be partial? (any line short of remaining)
  const isPartial = useMemo(() => {
    return order.items.some(it => {
      if (it.remaining <= 0) return false;
      return (qtys.get(it.id) ?? 0) < it.remaining;
    });
  }, [order.items, qtys]);

  const canDispatch = vehicle.trim().length > 0 && driver.trim().length > 0 && dispatchableLines.length > 0;

  function handleConfirm() {
    if (!canDispatch) {
      toast.error("Vehicle # and driver name are required");
      return;
    }
    startTransition(async () => {
      const res = await createDispatch(
        order.id,
        dispatchableLines.map(l => ({ orderItemId: l.orderItemId, qty: l.qty })),
        {
          vehicleNumber: vehicle.trim(),
          driverName: driver.trim(),
          driverPhone: driverPhone.trim() || undefined,
          notes: notes.trim() || undefined,
          shipImmediately: true,
        },
      );
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Dispatched · ${res.dispatchNumber}`);
      router.push(`/dispatch/${beatId}`);
    });
  }

  const itemCount = order.items.filter(it => it.remaining > 0).length;

  return (
    <div className="min-h-screen bg-paper pb-24">
      <div className="max-w-md mx-auto px-3 py-4">
        <Link href={`/dispatch/${beatId}`} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> Back
        </Link>

        {/* Customer header */}
        <h1 className="text-lg font-semibold leading-tight">{order.customer?.name ?? "—"}</h1>
        <div className="text-xs text-ink-muted mt-0.5">
          {[order.customer?.city, order.customer?.mobile].filter(Boolean).join(" · ")}
        </div>
        <div className="text-2xs font-mono text-ink-subtle mt-0.5">{order.rupyzOrderId}</div>

        {/* Single-line summary */}
        <div className="mt-3 pb-3 border-b border-paper-line text-sm">
          <span className="font-semibold tabular">{itemCount}</span>
          <span className="text-ink-muted"> item{itemCount === 1 ? "" : "s"} · </span>
          <span className="font-semibold tabular">{formatINR(totalAmt)}</span>
          {order.appStatus === "partially_dispatched" && (
            <span className="ml-2 text-2xs text-warn">· partly sent already</span>
          )}
        </div>

        {/* Items list — comes first now (vehicle/driver moved below) */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold">
              Items in this order
            </h2>
            {!editMode ? (
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="text-xs text-accent inline-flex items-center gap-1 hover:underline"
              >
                <Pencil size={10}/> Edit quantities
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  // Reset to full remaining when leaving edit mode
                  const m = new Map<string, number>();
                  for (const it of order.items) m.set(it.id, it.remaining);
                  setQtys(m);
                  setEditMode(false);
                }}
                className="text-xs text-ink-muted inline-flex items-center gap-1 hover:underline"
              >
                <X size={10}/> Reset all
              </button>
            )}
          </div>

          <div className="bg-paper-card border border-paper-line rounded divide-y divide-paper-line">
            {order.items.map(it => {
              const dispatching = qtys.get(it.id) ?? 0;
              const max = it.remaining;
              const noRemaining = max <= 0;

              return (
                <div key={it.id} className={`px-3 py-2.5 ${noRemaining ? "opacity-50" : ""}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-medium text-sm flex-1 min-w-0">{it.productName}</div>
                    {!editMode && (
                      <div className="text-sm font-semibold tabular shrink-0">
                        {dispatching}
                        {it.unit && <span className="text-2xs text-ink-muted ml-0.5">{it.unit}</span>}
                      </div>
                    )}
                  </div>

                  {!editMode && noRemaining && (
                    <div className="text-2xs text-ok mt-0.5">Fully sent earlier</div>
                  )}

                  {editMode && !noRemaining && (
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => bumpQty(it.id, -1, max)}
                        disabled={dispatching <= 0}
                        className="w-9 h-9 rounded border border-paper-line flex items-center justify-center disabled:opacity-30 active:bg-paper-subtle"
                        aria-label="Decrease"
                      >
                        <Minus size={14}/>
                      </button>
                      <Input
                        inputMode="decimal"
                        className="text-center font-mono tabular flex-1 max-w-[100px]"
                        value={dispatching}
                        onChange={(e) => {
                          const n = parseFloat(e.target.value);
                          if (Number.isFinite(n)) setQty(it.id, Math.min(max, n));
                          else if (e.target.value === "") setQty(it.id, 0);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => bumpQty(it.id, 1, max)}
                        disabled={dispatching >= max}
                        className="w-9 h-9 rounded border border-paper-line flex items-center justify-center disabled:opacity-30 active:bg-paper-subtle"
                        aria-label="Increase"
                      >
                        <Plus size={14}/>
                      </button>
                      <span className="text-2xs text-ink-muted whitespace-nowrap">
                        / {max} max
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {order.items.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-ink-muted">
                This order has no line items.
              </div>
            )}
          </div>
        </div>

        {/* Vehicle + driver — now BELOW items */}
        <div className="mt-5 pt-4 border-t border-paper-line space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold">
            Truck details
          </h2>
          <div>
            <Label className="text-xs">Vehicle # <span className="text-danger">*</span></Label>
            <Input
              className="mt-1"
              placeholder="MH-20 AB 1234"
              value={vehicle}
              onChange={e => setVehicle(e.target.value)}
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

      {/* Sticky footer: confirm button anchored to bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-paper-card/95 backdrop-blur border-t border-paper-line p-3">
        <div className="max-w-md mx-auto">
          {isPartial && dispatchableLines.length > 0 && (
            <p className="text-2xs text-warn text-center mb-2">
              ⚠ Some lines reduced — order will be marked &ldquo;partly sent&rdquo;
            </p>
          )}
          <Button
            className="w-full"
            size="lg"
            onClick={handleConfirm}
            disabled={!canDispatch || pending}
          >
            <Truck size={14}/>
            {pending
              ? "Dispatching…"
              : isPartial
                ? `Confirm partial dispatch · ${formatINR(totalAmt)}`
                : `Dispatch full order · ${formatINR(totalAmt)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
