"use client";

import Link from "next/link";
import { Inbox, CheckCircle2, Receipt, Loader2, PackageCheck, Bus, Truck, BadgeCheck } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";

interface OrderCard {
  id: string;
  rupyzOrderId: string;
  customerName: string;
  customerCity: string | null;
  beatName: string | null;
  totalAmount: number;
  kg: number;
  createdAt: string;
}

interface StageConfig {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: string | number; className?: string }>;
  accent: "warn" | "accent" | "ok" | "neutral";
  ordersTab: string;
}

const STAGES: StageConfig[] = [
  { key: "received",     label: "Received",   icon: Inbox,        accent: "warn",    ordersTab: "approval" },
  { key: "approved",     label: "Approved",   icon: CheckCircle2, accent: "accent",  ordersTab: "dispatch" },
  { key: "invoiced",     label: "Invoiced",   icon: Receipt,      accent: "accent",  ordersTab: "invoiced" },
  { key: "loading",      label: "Loading",    icon: Loader2,      accent: "warn",    ordersTab: "loading" },
  { key: "loaded",       label: "Loaded",     icon: PackageCheck, accent: "accent",  ordersTab: "loading" },
  { key: "dispatched",   label: "Dispatched", icon: Truck,        accent: "accent",  ordersTab: "transit" },
  { key: "delivered",    label: "Delivered",  icon: BadgeCheck,   accent: "ok",      ordersTab: "delivered" },
  { key: "on_van_trip",  label: "On VAN",     icon: Bus,          accent: "neutral", ordersTab: "van" },
];

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
}
function formatKgCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  if (n >= 1000) {
    // 12,345 kg → "12.3k kg" for header (saves horizontal space)
    return `${(n / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}k kg`;
  }
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg`;
}
function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30)  return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function accentColors(a: StageConfig["accent"]) {
  switch (a) {
    case "warn":    return { headerBg: "bg-warn-soft", headerBorder: "border-warn/40", iconColor: "text-warn",   numberColor: "text-warn"   };
    case "accent":  return { headerBg: "bg-accent-soft", headerBorder: "border-accent/40", iconColor: "text-accent", numberColor: "text-accent" };
    case "ok":      return { headerBg: "bg-ok-soft", headerBorder: "border-ok/40", iconColor: "text-ok", numberColor: "text-ok" };
    case "neutral": return { headerBg: "bg-paper-subtle", headerBorder: "border-paper-line", iconColor: "text-ink-muted", numberColor: "text-ink-muted" };
  }
}

export function PipelineClient({
  totals,
  totalsKg,
  cardsByStage,
  stageLimit,
}: {
  totals: Record<string, number>;
  totalsKg: Record<string, number>;
  cardsByStage: Record<string, OrderCard[]>;
  stageLimit: number;
}) {
  const grandTotal = STAGES.reduce((s, st) => s + (totals[st.key] ?? 0), 0);
  const grandKg = STAGES.reduce((s, st) => s + (totalsKg[st.key] ?? 0), 0);

  return (
    <div className="p-3 sm:p-6">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold">Order pipeline</h1>
          <p className="text-xs text-ink-muted mt-0.5">
            <strong className="tabular text-ink">{grandTotal.toLocaleString("en-IN")}</strong> live orders
            <span className="text-ink-subtle"> · </span>
            <strong className="tabular text-ink">{formatKg(grandKg)}</strong> total
            <span className="text-ink-subtle"> · </span>
            across {STAGES.length} stages
          </p>
        </div>
        <Link href="/orders" className="text-xs text-accent hover:underline">
          Open Orders →
        </Link>
      </div>

      <div className="overflow-x-auto -mx-3 sm:-mx-6 px-3 sm:px-6 pb-3">
        <div className="flex gap-3 min-w-max">
          {STAGES.map(stage => {
            const Icon = stage.icon;
            const cards = cardsByStage[stage.key] ?? [];
            const total = totals[stage.key] ?? 0;
            const totalKg = totalsKg[stage.key] ?? 0;
            const overflow = total > cards.length;
            const colors = accentColors(stage.accent);

            return (
              <section
                key={stage.key}
                className="w-72 shrink-0 flex flex-col bg-paper-card/40 border border-paper-line rounded-md overflow-hidden"
              >
                <div className={`px-3 py-2.5 border-b ${colors.headerBorder} ${colors.headerBg}`}>
                  <div className="flex items-center gap-2">
                    <Icon size={14} className={colors.iconColor}/>
                    <span className="font-semibold text-sm">{stage.label}</span>
                    <span className="ml-auto flex items-baseline gap-1.5">
                      <span className={`text-sm font-bold tabular ${colors.numberColor}`}>
                        {total.toLocaleString("en-IN")}
                      </span>
                      <span className="text-2xs text-ink-muted tabular">
                        · {formatKgCompact(totalKg)}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="flex-1 min-h-[120px] max-h-[calc(100vh-220px)] overflow-y-auto p-2 space-y-1.5">
                  {cards.length === 0 ? (
                    <div className="text-center py-8 text-2xs text-ink-subtle">
                      No orders
                    </div>
                  ) : (
                    cards.map(card => (
                      <Card key={card.id} card={card} />
                    ))
                  )}

                  {overflow && (
                    <Link
                      href={`/orders?tab=${stage.ordersTab}`}
                      className="block text-center text-2xs text-accent hover:underline py-2"
                    >
                      View all {total} orders →
                    </Link>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <p className="text-2xs text-ink-subtle text-center mt-3">
        Showing latest {stageLimit} per column. Counts and kg cover all orders in each stage.
      </p>

      <AutoRefresh />
    </div>
  );
}

function Card({ card }: { card: OrderCard }) {
  return (
    <Link
      href={`/orders?tab=all&q=${encodeURIComponent(card.rupyzOrderId)}`}
      className="block bg-paper-card border border-paper-line rounded-md p-2.5 hover:bg-paper-subtle/40 transition-colors group"
    >
      <div className="text-sm font-semibold leading-tight truncate group-hover:text-accent transition-colors">
        {card.customerName}
      </div>
      <div className="text-2xs text-ink-muted mt-0.5 flex items-baseline gap-1 flex-wrap">
        {card.beatName && <span className="truncate">{card.beatName}</span>}
        {card.customerCity && (
          <>
            {card.beatName && <span className="text-ink-subtle">·</span>}
            <span className="truncate">{card.customerCity}</span>
          </>
        )}
      </div>
      <div className="text-2xs text-ink-muted mt-1 flex items-baseline gap-1">
        <span className="tabular">{formatKg(card.kg)}</span>
        <span className="text-ink-subtle">·</span>
        <span className="tabular font-medium text-ink">{formatINR(card.totalAmount)}</span>
        <span className="ml-auto text-ink-subtle tabular">{formatRelative(card.createdAt)}</span>
      </div>
      <div className="text-2xs text-ink-subtle font-mono mt-1 truncate">
        {card.rupyzOrderId}
      </div>
    </Link>
  );
}
