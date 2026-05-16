"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Truck, Send, Clock, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/context";
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
  vehicleNumber: string;
  driverName: string;
  driverPhone: string;
  dispatchCount: number;
  orderCount: number;
  totalQty: number;
  totalAmount: number;
  oldestLoadedAt: string;
  orders: OrderInTruck[];
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export function TrucksLoadingPanel({ trucks }: { trucks: TruckLoading[] }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  function formatRelative(iso: string): string {
    const ts = new Date(iso).getTime();
    const now = Date.now();
    const mins = Math.floor((now - ts) / 60000);
    if (mins < 1) return t("trucks.just_now");
    if (mins < 60) return t("trucks.m_ago", { n: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t("trucks.h_ago", { n: hrs });
    const days = Math.floor(hrs / 24);
    return t("trucks.d_ago", { n: days });
  }

  function toggleExpand(key: string) {
    setExpanded(prev => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return s;
    });
  }

  function handleShip(truck: TruckLoading) {
    const orderWord = truck.orderCount === 1 ? t("common.order") : t("common.orders");
    const confirmMsg = t("trucks.confirm_ship", {
      vehicle: truck.vehicleNumber,
      driver: truck.driverName,
      count: truck.orderCount,
      orderWord,
    });
    if (!confirm(confirmMsg)) return;

    const key = `${truck.vehicleNumber}::${truck.driverName}`;
    setPendingKey(key);
    startTransition(async () => {
      const res = await shipTruck({
        vehicleNumber: truck.vehicleNumber,
        driverName: truck.driverName,
      });
      setPendingKey(null);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      const successMsg = res.dispatchCount === 1
        ? t("trucks.toast_marked_one", { n: res.dispatchCount })
        : t("trucks.toast_marked_many", { n: res.dispatchCount });
      toast.success(successMsg);
      router.refresh();
    });
  }

  const orderWordSingle = t("common.order");
  const orderWordPlural = t("common.orders");
  const unitsLabel = t("common.units");

  return (
    <div className="mb-3">
      <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold mb-2 flex items-center gap-1.5">
        <Truck size={11}/> {t("trucks.trucks_loading")}
      </h2>
      <div className="space-y-2">
        {trucks.map(truck => {
          const key = `${truck.vehicleNumber}::${truck.driverName}`;
          const isPending = pendingKey === key;
          const isExpanded = expanded.has(key);
          const orderWord = truck.orderCount === 1 ? orderWordSingle : orderWordPlural;
          return (
            <div
              key={key}
              className="bg-paper-card border border-warn/40 bg-warn-soft/20 rounded-md overflow-hidden"
            >
              {/* Tappable header (expand/collapse) */}
              <button
                type="button"
                onClick={() => toggleExpand(key)}
                className="w-full text-left p-3 hover:bg-warn-soft/10 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="font-semibold text-sm font-mono inline-flex items-center gap-1.5">
                    {isExpanded
                      ? <ChevronDown size={12} className="text-ink-muted"/>
                      : <ChevronRight size={12} className="text-ink-muted"/>
                    }
                    {truck.vehicleNumber || t("trucks.no_vehicle")}
                  </div>
                  <div className="text-2xs text-ink-muted inline-flex items-center gap-1 shrink-0">
                    <Clock size={9}/> {formatRelative(truck.oldestLoadedAt)}
                  </div>
                </div>
                <div className="text-2xs text-ink-muted mb-1 ml-4">
                  {t("trucks.driver_label")} <strong className="text-ink">{truck.driverName || t("trucks.no_driver")}</strong>
                  {truck.driverPhone && <> · {truck.driverPhone}</>}
                </div>
                <div className="text-2xs text-ink-muted ml-4">
                  <span className="tabular"><strong className="text-ink">{truck.orderCount}</strong> {orderWord}</span>
                  <span className="text-ink-subtle"> · </span>
                  <span className="tabular"><strong className="text-ink">{truck.totalQty.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</strong> {unitsLabel}</span>
                  <span className="text-ink-subtle"> · </span>
                  <span className="tabular">{formatINR(truck.totalAmount)}</span>
                </div>
              </button>

              {/* Expanded order list */}
              {isExpanded && truck.orders.length > 0 && (
                <div className="border-t border-warn/30 bg-paper-card/60 divide-y divide-paper-line">
                  {truck.orders.map(o => (
                    <div key={o.orderId} className="px-3 py-2 text-xs">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium truncate">{o.customerName}</span>
                        <span className="text-2xs text-ink-muted tabular shrink-0">
                          {o.qty.toLocaleString("en-IN", { maximumFractionDigits: 1 })} {unitsLabel} · {formatINR(o.amount)}
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

              {/* Action footer (always visible) */}
              <div className="border-t border-warn/30 bg-paper-card/40 p-2.5">
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => handleShip(truck)}
                  disabled={isPending || !!pendingKey}
                >
                  <Send size={12}/> {isPending ? t("trucks.marking") : t("trucks.mark_dispatched")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
