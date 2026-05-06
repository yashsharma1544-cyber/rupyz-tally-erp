"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Truck, Minus, Plus, Package, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  const [qtys, setQtys] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const it of order.items) m.set(it.id, it.remaining);
    return m;
  });
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

  // Reset all dispatching qtys back to remaining (default)
  function resetAll() {
    const m = new Map<string, number>();
    for (const it of order.items) m.set(it.id, it.remaining);
    setQtys(m);
  }

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

  const canDispatch = vehicle.trim().length > 0 && driver.trim().length > 0 && dispatchableLines.length > 0;

  function handleConfirm() {
    if (!canDispatch) {
      toast.error("Vehicle # and driver name are required, and at least one item must have qty > 0");
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

  const isPartial = dispatchableLines.some(l => l.qty < l.line.remaining)
    || order.items.some(it => it.remaining > 0 && (qtys.get(it.id) ?? 0) === 0);

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <Link href={`/dispatch/${beatId}`} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> Back to beat
        </Link>

        <h1 className="text-base font-semibold leading-tight">{order.customer?.name ?? "—"}</h1>
        <div className="text-2xs text-ink-muted mb-3">
          <span className="font-mono">{order.rupyzOrderId}</span>
          {order.customer?.city && <> · {order.customer.city}</>}
          {order.customer?.mobile && <> · {order.customer.mobile}</>}
          {order.appStatus === "partially_dispatched" && <> · <Badge variant="warn">partly sent</Badge></>}
        </div>

        {/* Summary */}
        <div className="bg-paper-card border border-paper-line rounded-md p-2.5 mb-3 text-xs flex items-center justify-between flex-wrap gap-2">
          <div>
            <span className="text-ink-muted">Dispatching:</span>{" "}
            <span className="font-semibold tabular">{dispatchableLines.length}</span>
            <span className="text-ink-subtle"> of </span>
            <span className="tabular">{order.items.filter(it => it.remaining > 0).length}</span>
            <span className="text-ink-muted"> lines</span>
          </div>
          <div className="font-mono tabular">{formatINR(totalAmt)}</div>
        </div>

        {/* Reset link */}
        <div className="flex justify-end mb-1.5">
          <button
            type="button"
            onClick={resetAll}
            className="text-2xs text-ink-muted hover:text-ink inline-flex items-center gap-1"
          >
            <RotateCcw size={9}/> Reset to full
          </button>
        </div>

        {/* Lines */}
        <div className="space-y-2 mb-4">
          {order.items.map(it => {
            const dispatching = qtys.get(it.id) ?? 0;
            const max = it.remaining;
            const noRemaining = max <= 0;

            return (
              <div
                key={it.id}
                className={`bg-paper-card border rounded p-3 ${noRemaining ? "border-paper-line opacity-60" : "border-paper-line"}`}
              >
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <div className="font-medium text-sm flex-1 min-w-0 truncate">{it.productName}</div>
                  <div className="text-2xs text-ink-muted shrink-0">
                    {formatINR(it.price)}/unit
                  </div>
                </div>
                <div className="text-2xs text-ink-muted mb-2">
                  Ordered: <span className="tabular">{it.orderedQty}</span>
                  {it.alreadyDispatched > 0 && <> · already sent: <span className="tabular">{it.alreadyDispatched}</span></>}
                  {!noRemaining && <> · <strong className="text-ink">remaining: <span className="tabular">{it.remaining}</span></strong></>}
                  {noRemaining && <> · <span className="text-ok">fully sent</span></>}
                </div>

                {!noRemaining && (
                  <div className="flex items-center gap-2">
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
                  </div>
                )}
              </div>
            );
          })}
          {order.items.length === 0 && (
            <div className="text-center py-6 bg-paper-card border border-paper-line rounded">
              <Package size={24} className="mx-auto text-ink-subtle mb-2"/>
              <p className="text-sm text-ink-muted">This order has no line items.</p>
            </div>
          )}
        </div>

        {/* Vehicle + driver */}
        <div className="bg-paper-card border border-paper-line rounded p-3 mb-3">
          <Label className="text-2xs uppercase tracking-wide text-ink-muted">Vehicle # *</Label>
          <Input
            className="mt-1 mb-3"
            placeholder="MH-20 AB 1234"
            value={vehicle}
            onChange={e => setVehicle(e.target.value)}
          />

          <Label className="text-2xs uppercase tracking-wide text-ink-muted">Driver name *</Label>
          <Input
            className="mt-1 mb-3"
            placeholder="e.g. Ramesh"
            value={driver}
            onChange={e => setDriver(e.target.value)}
          />

          <Label className="text-2xs uppercase tracking-wide text-ink-muted">Driver phone (optional)</Label>
          <Input
            className="mt-1 mb-3"
            placeholder="9876543210"
            inputMode="tel"
            value={driverPhone}
            onChange={e => setDriverPhone(e.target.value)}
          />

          <Label className="text-2xs uppercase tracking-wide text-ink-muted">Notes (optional)</Label>
          <Textarea
            className="mt-1"
            rows={2}
            placeholder="e.g. partial dispatch — no stock for Red Label"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        {/* Partial dispatch warning */}
        {isPartial && dispatchableLines.length > 0 && (
          <p className="text-2xs text-warn text-center mb-2">
            ⚠ Partial dispatch — some lines short. Order will be marked &ldquo;partly sent.&rdquo;
          </p>
        )}

        {/* Confirm */}
        <Button
          className="w-full"
          size="lg"
          onClick={handleConfirm}
          disabled={!canDispatch || pending}
        >
          <Truck size={14}/> {pending ? "Dispatching…" : `Confirm dispatch · ${formatINR(totalAmt)}`}
        </Button>
      </div>
    </div>
  );
}
