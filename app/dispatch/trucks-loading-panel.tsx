"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Truck, Send, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { shipTruck } from "@/app/(app)/dispatches/actions";

interface TruckLoading {
  vehicleNumber: string;
  driverName: string;
  driverPhone: string;
  dispatchCount: number;
  orderCount: number;
  totalQty: number;
  totalAmount: number;
  oldestLoadedAt: string;
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function TrucksLoadingPanel({ trucks }: { trucks: TruckLoading[] }) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleShip(t: TruckLoading) {
    if (!confirm(
      `Mark ${t.vehicleNumber} (driver ${t.driverName}) as dispatched?\n\n${t.orderCount} order${t.orderCount === 1 ? "" : "s"} will move to "dispatched" status.`
    )) return;

    const key = `${t.vehicleNumber}::${t.driverName}`;
    setPendingKey(key);
    startTransition(async () => {
      const res = await shipTruck({
        vehicleNumber: t.vehicleNumber,
        driverName: t.driverName,
      });
      setPendingKey(null);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${res.dispatchCount} dispatch${res.dispatchCount === 1 ? "" : "es"} marked as truck-dispatched`);
      router.refresh();
    });
  }

  return (
    <div className="mb-3">
      <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold mb-2 flex items-center gap-1.5">
        <Truck size={11}/> Trucks loading
      </h2>
      <div className="space-y-2">
        {trucks.map(t => {
          const key = `${t.vehicleNumber}::${t.driverName}`;
          const isPending = pendingKey === key;
          return (
            <div
              key={key}
              className="bg-paper-card border border-warn/40 bg-warn-soft/20 rounded-md p-3"
            >
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <div className="font-semibold text-sm font-mono">
                  {t.vehicleNumber || "(no vehicle)"}
                </div>
                <div className="text-2xs text-ink-muted inline-flex items-center gap-1 shrink-0">
                  <Clock size={9}/> {formatRelative(t.oldestLoadedAt)}
                </div>
              </div>
              <div className="text-2xs text-ink-muted mb-2">
                Driver: <strong className="text-ink">{t.driverName || "(no driver)"}</strong>
                {t.driverPhone && <> · {t.driverPhone}</>}
              </div>
              <div className="text-2xs text-ink-muted mb-2.5">
                <span className="tabular"><strong className="text-ink">{t.orderCount}</strong> order{t.orderCount === 1 ? "" : "s"}</span>
                <span className="text-ink-subtle"> · </span>
                <span className="tabular"><strong className="text-ink">{t.totalQty.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</strong> units</span>
                <span className="text-ink-subtle"> · </span>
                <span className="tabular">{formatINR(t.totalAmount)}</span>
              </div>
              <Button
                className="w-full"
                size="sm"
                onClick={() => handleShip(t)}
                disabled={isPending || !!pendingKey}
              >
                <Send size={12}/> {isPending ? "Marking…" : "Mark dispatched (truck left)"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
