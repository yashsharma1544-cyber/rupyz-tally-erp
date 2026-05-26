"use client";

import Link from "next/link";
import { ArrowLeft, ChevronRight, Truck, Package, AlertTriangle } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { AutoRefresh } from "@/components/auto-refresh";

interface OrderItem {
  id: string;
  rupyzOrderId: string;
  totalAmount: number;
  appStatus: string;
  customerName: string;
  customerCity: string | null;
  kg: number;
  itemCount: number;
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
}

export function BeatDispatchClient({
  beat, orders, isNoBeatTile,
}: {
  beat: { id: string; name: string };
  orders: OrderItem[];
  isNoBeatTile?: boolean;
}) {
  const { t } = useTranslation();

  const totalOrders = orders.length;
  const totalKg     = orders.reduce((s, o) => s + o.kg, 0);
  const totalAmount = orders.reduce((s, o) => s + o.totalAmount, 0);

  const orderWordSingle = t("common.order");
  const orderWordPlural = t("common.orders");

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <Link href="/dispatch" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> {t("beat.all_beats")}
        </Link>
        <h1 className="text-base font-bold leading-tight inline-flex items-center gap-1.5">
          {isNoBeatTile && <AlertTriangle size={14} className="text-warn"/>}
          {beat.name}
        </h1>
        <p className="text-2xs text-ink-muted mb-3">
          {totalOrders} {totalOrders === 1 ? orderWordSingle : orderWordPlural} · {formatKg(totalKg)} · {formatINR(totalAmount)}
        </p>

        {isNoBeatTile && (
          <div className="bg-warn-soft border border-warn/40 rounded-md p-2.5 mb-3 text-xs">
            <div className="font-semibold inline-flex items-center gap-1 mb-1">
              <AlertTriangle size={11} className="text-warn"/> {t("beat.no_beat_warn_title")}
            </div>
            <p className="text-ink-muted">
              {t("beat.no_beat_warn_body", { customersLink: "__CUSTOMERS_LINK__" }).split("__CUSTOMERS_LINK__").map((part, i, arr) => (
                <span key={i}>
                  {part}
                  {i < arr.length - 1 && (
                    <Link href="/customers" className="text-accent hover:underline">{t("beat.customers_link")}</Link>
                  )}
                </span>
              ))}
            </p>
          </div>
        )}

        {totalOrders > 0 && (
          <Link
            href="/load"
            className="w-full mb-3 inline-flex items-center justify-center gap-1.5 h-11 rounded-md bg-accent text-paper-card text-sm font-semibold hover:bg-accent/90 active:bg-accent/80 transition-colors"
          >
            <Truck size={14}/> {t("beat.load_truck_pick")}
          </Link>
        )}

        {orders.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
            <Package size={28} className="mx-auto text-ink-subtle mb-2"/>
            <p className="font-semibold text-sm mb-0.5">{t("beat.nothing_in_beat")}</p>
            <p className="text-xs text-ink-muted">{t("beat.empty_desc")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-2xs uppercase tracking-wide text-ink-muted">
              {t("beat.or_dispatch_one")}
            </p>
            {orders.map(o => (
              <Link
                key={o.id}
                href={`/dispatch/${beat.id}/${o.id}`}
                className="block bg-paper-card border border-paper-line rounded-md p-3 hover:bg-paper-subtle/40 active:bg-paper-subtle transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{o.customerName}</div>
                    <div className="text-2xs text-ink-muted mt-0.5">
                      <span className="font-mono">{o.rupyzOrderId}</span>
                      {o.customerCity && <> · {o.customerCity}</>}
                      {o.appStatus === "partially_dispatched" && <> · <span className="text-warn">{t("status.partly_sent_inline")}</span></>}
                      {o.appStatus === "loaded" && <> · <span className="text-accent">{t("status.loaded_inline")}</span></>}
                    </div>
                    <div className="text-2xs text-ink-muted mt-0.5">
                      <span className="tabular"><strong className="text-ink">{formatKg(o.kg)}</strong></span>
                      <span className="text-ink-subtle"> · </span>
                      <span className="tabular">{formatINR(o.totalAmount)}</span>
                      <span className="text-ink-subtle"> · </span>
                      <span>{o.itemCount} {o.itemCount === 1 ? t("common.item") : t("common.items")}</span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-ink-subtle shrink-0"/>
                </div>
              </Link>
            ))}
          </div>
        )}

        <AutoRefresh />
      </div>
    </div>
  );
}
