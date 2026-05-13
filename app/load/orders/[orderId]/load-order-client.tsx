"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, AlertCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { markOrderLoaded } from "./actions";

interface OrderLine {
  id: string;
  productName: string;
  orderedQty: number;
  loadedQty: number | null;  // from DB; might already have a value if order was partially saved
  price: number;
  unit: string | null;
}

interface OrderForLoad {
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

export function LoadOrderClient({ order }: { order: OrderForLoad }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Initialize qty inputs: prefilled with loaded_qty if previously saved, else ordered_qty.
  // (Auto-fill the ordered qty per user's spec.)
  const [qtys, setQtys] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const it of order.items) {
      const val = it.loadedQty != null ? it.loadedQty : it.orderedQty;
      m.set(it.id, String(val));
    }
    return m;
  });

  // Confirmation modal for partial loads
  const [confirmPartial, setConfirmPartial] = useState(false);

  function setQty(id: string, v: string) {
    setQtys(prev => {
      const m = new Map(prev);
      m.set(id, v);
      return m;
    });
  }

  // Parse current state. Empty / NaN → 0.
  const parsedQtys = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of order.items) {
      const raw = qtys.get(it.id) ?? "";
      const n = parseFloat(raw);
      m.set(it.id, Number.isFinite(n) && n >= 0 ? n : 0);
    }
    return m;
  }, [qtys, order.items]);

  // Is this a partial load? (any line where loaded_qty < ordered_qty AND ordered_qty > 0)
  const isPartial = useMemo(() => {
    return order.items.some(it => {
      const loaded = parsedQtys.get(it.id) ?? 0;
      return it.orderedQty > 0 && loaded < it.orderedQty;
    });
  }, [order.items, parsedQtys]);

  const totalLoaded = useMemo(() => {
    let s = 0;
    for (const n of parsedQtys.values()) s += n;
    return s;
  }, [parsedQtys]);

  const canSubmit = totalLoaded > 0 && !pending;

  function buildLines() {
    return order.items.map(it => ({
      orderItemId: it.id,
      loadedQty: parsedQtys.get(it.id) ?? 0,
    }));
  }

  function submit(markPartial: boolean) {
    startTransition(async () => {
      const res = await markOrderLoaded(order.id, buildLines(), { markPartial });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        markPartial ? "Marked as partially loaded" : "Order loaded — ready for dispatch",
      );
      setConfirmPartial(false);
      router.push("/load");
    });
  }

  function handleAllLoaded() {
    // Set every input to its ordered qty
    const m = new Map<string, string>();
    for (const it of order.items) m.set(it.id, String(it.orderedQty));
    setQtys(m);
    // Submit immediately as a full load
    setTimeout(() => submit(false), 0);
  }

  function handleSubmitClick() {
    if (isPartial) {
      setConfirmPartial(true);
    } else {
      submit(false);
    }
  }

  const itemCount = order.items.length;

  return (
    <div className="min-h-screen bg-paper pb-32">
      <div className="max-w-md mx-auto px-3 py-4">
        <Link
          href="/load"
          className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft size={11}/> Back to queue
        </Link>

        <h1 className="text-lg font-semibold leading-tight">{order.customer?.name ?? "—"}</h1>
        <div className="text-2xs text-ink-muted mt-0.5 flex items-center gap-1 flex-wrap">
          <span className="font-mono">{order.rupyzOrderId}</span>
          {order.customer?.city && <><span className="text-ink-subtle">·</span><span>{order.customer.city}</span></>}
          {order.customer?.mobile && (
            <>
              <span className="text-ink-subtle">·</span>
              <a href={`tel:${order.customer.mobile}`} className="inline-flex items-center gap-0.5 text-accent hover:underline">
                <Phone size={9}/> {order.customer.mobile}
              </a>
            </>
          )}
        </div>

        <div className="mt-2 pb-3 border-b border-paper-line text-sm">
          <span className="font-semibold tabular">{itemCount}</span>
          <span className="text-ink-muted"> item{itemCount === 1 ? "" : "s"} · </span>
          <span className="font-semibold tabular">{formatINR(order.totalAmount)}</span>
          {order.appStatus === "loading" && (
            <span className="ml-2 text-2xs text-warn font-semibold">· in progress</span>
          )}
        </div>

        {/* Mark all loaded button — quick path */}
        <div className="mt-3">
          <Button
            onClick={handleAllLoaded}
            disabled={pending || itemCount === 0}
            className="w-full"
            size="lg"
          >
            <CheckCircle2 size={15}/> All loaded as ordered
          </Button>
          <p className="text-2xs text-ink-muted text-center mt-1">
            Fills every line with ordered quantity and marks loaded
          </p>
        </div>

        {/* Or adjust per-line */}
        <div className="mt-5">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold mb-2">
            Or adjust each line
          </h2>
          {order.items.length === 0 ? (
            <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center text-sm text-ink-muted">
              This order has no line items.
            </div>
          ) : (
            <div className="bg-paper-card border border-paper-line rounded-md divide-y divide-paper-line">
              {order.items.map(it => {
                const cur = parsedQtys.get(it.id) ?? 0;
                const isLess = cur < it.orderedQty;
                return (
                  <div key={it.id} className="px-3 py-3">
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                      <div className="font-medium text-sm flex-1 min-w-0">{it.productName}</div>
                      <div className="text-2xs text-ink-subtle tabular shrink-0">
                        ordered: {it.orderedQty}{it.unit && <span> {it.unit}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={qtys.get(it.id) ?? ""}
                        onChange={e => setQty(it.id, e.target.value)}
                        className={`text-center tabular font-mono ${isLess ? "text-warn font-semibold" : ""}`}
                        disabled={pending}
                      />
                      {it.unit && (
                        <span className="text-2xs text-ink-muted whitespace-nowrap">{it.unit}</span>
                      )}
                    </div>
                    {isLess && cur > 0 && (
                      <div className="text-2xs text-warn mt-1.5 inline-flex items-center gap-1">
                        <AlertCircle size={10}/> Less than ordered ({it.orderedQty - cur} {it.unit ?? ""} short)
                      </div>
                    )}
                    {cur === 0 && (
                      <div className="text-2xs text-ink-subtle mt-1.5">Nothing loaded for this line</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-paper-card/95 backdrop-blur border-t border-paper-line p-3">
        <div className="max-w-md mx-auto space-y-1">
          {isPartial && totalLoaded > 0 && (
            <p className="text-2xs text-warn text-center">
              ⚠ Some lines are short — you&apos;ll be asked to confirm
            </p>
          )}
          {totalLoaded === 0 && (
            <p className="text-2xs text-danger text-center">
              At least one line must have quantity &gt; 0
            </p>
          )}
          <Button
            onClick={handleSubmitClick}
            disabled={!canSubmit}
            variant="outline"
            className="w-full"
            size="lg"
          >
            {pending ? "Saving…" : isPartial ? "Mark loaded with adjustments" : "Mark loaded"}
          </Button>
        </div>
      </div>

      {/* Confirm partial dialog */}
      {confirmPartial && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-3"
          onClick={() => !pending && setConfirmPartial(false)}
        >
          <div
            className="bg-paper-card border border-paper-line rounded-lg shadow-xl w-full max-w-sm p-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle size={18} className="text-warn shrink-0"/>
              <h2 className="font-semibold">Some lines were short</h2>
            </div>
            <p className="text-sm text-ink-muted mb-3">
              Lines below have less loaded than ordered:
            </p>
            <div className="bg-paper-subtle/50 rounded p-2 mb-4 max-h-40 overflow-y-auto text-xs space-y-0.5">
              {order.items
                .filter(it => (parsedQtys.get(it.id) ?? 0) < it.orderedQty && it.orderedQty > 0)
                .map(it => {
                  const cur = parsedQtys.get(it.id) ?? 0;
                  return (
                    <div key={it.id} className="tabular flex justify-between gap-2">
                      <span className="truncate">{it.productName}</span>
                      <span className="text-warn shrink-0">{cur} / {it.orderedQty}{it.unit ? ` ${it.unit}` : ""}</span>
                    </div>
                  );
                })}
            </div>
            <p className="text-xs text-ink-muted mb-4">
              Mark this order as <strong>partially dispatched</strong>? You can dispatch the remaining
              items in a separate run later.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="ghost"
                onClick={() => setConfirmPartial(false)}
                disabled={pending}
                className="sm:flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={() => submit(true)}
                disabled={pending}
                className="sm:flex-1"
              >
                {pending ? "Saving…" : "Confirm partial"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
