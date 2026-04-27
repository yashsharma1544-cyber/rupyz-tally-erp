"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, AlertCircle, PackageCheck, Truck, Route, CheckCircle2, XCircle, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { Order, Salesman, Beat, OrderAppStatus, AppUser } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";
import { OrderDrawer } from "./order-drawer";

const PAGE_SIZE = 50;

// KPI shape returned by orders_kpis_by_status RPC
interface KpiRow {
  app_status: OrderAppStatus;
  order_count: number;
  total_kg: number;
  total_amount: number;
}

// Status tabs — each maps a list of underlying app_status values
type TabKey = "approval" | "dispatch" | "van" | "transit" | "delivered" | "rejected" | "all";

interface TabDef {
  key: TabKey;
  label: string;
  statuses: OrderAppStatus[] | "all";
  emptyHint: string;
  icon: LucideIcon;
  accent: "warn" | "accent" | "ok" | "danger" | "neutral";
}

const TABS: TabDef[] = [
  { key: "approval",  label: "Pending Approval",   statuses: ["received"],
    emptyHint: "No orders waiting for approval. Nice work.",
    icon: AlertCircle,   accent: "warn" },
  { key: "dispatch",  label: "Ready to Dispatch",  statuses: ["approved", "partially_dispatched"],
    emptyHint: "Nothing to dispatch right now.",
    icon: PackageCheck,  accent: "accent" },
  { key: "van",       label: "On VAN Trip",        statuses: ["on_van_trip"],
    emptyHint: "No orders on a VAN trip right now.",
    icon: Route,         accent: "accent" },
  { key: "transit",   label: "In Transit",         statuses: ["dispatched"],
    emptyHint: "No deliveries on the road right now.",
    icon: Truck,         accent: "accent" },
  { key: "delivered", label: "Delivered",          statuses: ["delivered"],
    emptyHint: "No completed orders match your filters.",
    icon: CheckCircle2,  accent: "ok" },
  { key: "rejected",  label: "Rejected",           statuses: ["rejected", "cancelled"],
    emptyHint: "No rejected or cancelled orders.",
    icon: XCircle,       accent: "danger" },
  { key: "all",       label: "All",                statuses: "all",
    emptyHint: "No orders match your filters.",
    icon: AlertCircle,   accent: "neutral" },
];

// Lookup table: which underlying statuses belong to each tab key.
// Used for aggregating KPI rows.
function tabForStatus(s: OrderAppStatus): TabKey | null {
  if (s === "received") return "approval";
  if (s === "approved" || s === "partially_dispatched") return "dispatch";
  if (s === "on_van_trip") return "van";
  if (s === "dispatched") return "transit";
  if (s === "delivered") return "delivered";
  if (s === "rejected" || s === "cancelled") return "rejected";
  return null; // 'closed' doesn't fit any KPI card
}

function defaultTabForRole(role: string): TabKey {
  switch (role) {
    case "approver": return "approval";
    case "dispatch": return "dispatch";
    case "van_lead": return "van";
    case "van_helper": return "van";
    case "delivery": return "transit";
    case "accounts": return "delivered";
    default:         return "all"; // admin, salesman, others
  }
}

// All statuses, in workflow order — used when tab='all'
const ALL_STATUSES: OrderAppStatus[] = [
  "received", "approved", "on_van_trip",
  "partially_dispatched", "dispatched", "delivered",
  "rejected", "cancelled", "closed",
];

// What status options does the dropdown show for a given tab?
// For specific tabs: only the statuses that belong to that tab (if >1).
// For 'all' tab: every status.
function statusOptionsForTab(tab: TabKey): OrderAppStatus[] {
  const def = TABS.find(t => t.key === tab);
  if (!def) return [];
  if (def.statuses === "all") return ALL_STATUSES;
  return def.statuses.length > 1 ? def.statuses : [];
}

function statusLabel(s: OrderAppStatus): string {
  return s.replace(/_/g, " ");
}

function statusBadgeVariant(s: OrderAppStatus): "neutral" | "ok" | "warn" | "danger" | "accent" {
  switch (s) {
    case "received": return "warn";
    case "approved":
    case "on_van_trip":
    case "partially_dispatched":
    case "dispatched": return "accent";
    case "delivered": return "ok";
    case "rejected":
    case "cancelled": return "danger";
    case "closed": return "neutral";
  }
}

export function OrdersClient({
  salesmen,
  beats,
  me,
}: {
  salesmen: Pick<Salesman, "id" | "name">[];
  beats: Pick<Beat, "id" | "name">[];
  me: AppUser;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [tab, setTab] = useState<TabKey>(defaultTabForRole(me.role));
  const [salesmanF, setSalesmanF] = useState<string>("all");
  const [beatF, setBeatF] = useState<string>("all");
  const [statusF, setStatusF] = useState<string>("all");
  const [dateF, setDateF] = useState<string>("today");

  // KPIs per status group (count + kg + amount)
  type KpiAgg = { count: number; kg: number; amount: number };
  const emptyKpi: Record<TabKey, KpiAgg> = {
    approval:  { count: 0, kg: 0, amount: 0 },
    dispatch:  { count: 0, kg: 0, amount: 0 },
    van:       { count: 0, kg: 0, amount: 0 },
    transit:   { count: 0, kg: 0, amount: 0 },
    delivered: { count: 0, kg: 0, amount: 0 },
    rejected:  { count: 0, kg: 0, amount: 0 },
    all:       { count: 0, kg: 0, amount: 0 },
  };
  const [kpis, setKpis] = useState<Record<TabKey, KpiAgg>>(emptyKpi);

  // Bumped when an action happens in the drawer; triggers list + counts refresh
  const [reloadKey, setReloadKey] = useState(0);

  // Live polling — refresh every 30s when tab is visible. Catches status changes
  // pushed from the mobile billing app (pre-order delivered, bill cancelled, etc.).
  useEffect(() => {
    function tick() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      setReloadKey(k => k + 1);
    }
    const id = setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const [open, setOpen] = useState<Order | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(0); }, [searchDebounced, tab, salesmanF, beatF, statusF, dateF]);

  // Reset statusF when tab changes if the current value isn't valid for the new tab
  useEffect(() => {
    if (statusF === "all") return;
    const valid = statusOptionsForTab(tab);
    if (!valid.includes(statusF as OrderAppStatus)) setStatusF("all");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Fetch KPIs (count, kg, amount) per status group via RPC
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let sinceTs: string | null = null;
      if (dateF !== "all") {
        const days = dateF === "today" ? 1 : dateF === "7d" ? 7 : 30;
        sinceTs = new Date(Date.now() - days * 86400 * 1000).toISOString();
      }
      const { data, error } = await supabase.rpc("orders_kpis_by_status", {
        since_ts: sinceTs,
        beat_id_filter: beatF !== "all" ? beatF : null,
      });
      if (cancelled || error) {
        if (error) toast.error(`KPI load failed: ${error.message}`);
        return;
      }

      const next: Record<TabKey, KpiAgg> = {
        approval:  { count: 0, kg: 0, amount: 0 },
        dispatch:  { count: 0, kg: 0, amount: 0 },
        van:       { count: 0, kg: 0, amount: 0 },
        transit:   { count: 0, kg: 0, amount: 0 },
        delivered: { count: 0, kg: 0, amount: 0 },
        rejected:  { count: 0, kg: 0, amount: 0 },
        all:       { count: 0, kg: 0, amount: 0 },
      };
      for (const row of (data ?? []) as KpiRow[]) {
        const tk = tabForStatus(row.app_status);
        const c = Number(row.order_count);
        const k = Number(row.total_kg);
        const a = Number(row.total_amount);
        if (tk) {
          next[tk].count  += c;
          next[tk].kg     += k;
          next[tk].amount += a;
        }
        next.all.count  += c;
        next.all.kg     += k;
        next.all.amount += a;
      }
      setKpis(next);
    })();
    return () => { cancelled = true; };
  }, [supabase, dateF, beatF, reloadKey]);

  // Fetch rows for the active tab
  const prevReloadKeyRef = useRef(reloadKey);
  useEffect(() => {
    let cancelled = false;
    // Only show the loading skeleton for user-initiated changes (filters, tab,
    // search, paging). Background polling silently swaps data when ready —
    // otherwise the whole list flickers every 30 seconds.
    const isPollingRefresh = prevReloadKeyRef.current !== reloadKey;
    prevReloadKeyRef.current = reloadKey;
    if (!isPollingRefresh) setLoading(true);
    (async () => {
      const tabDef = TABS.find(t => t.key === tab)!;
      const term = searchDebounced.trim();
      // Strip chars that would break Supabase's .or() filter syntax
      const safeTerm = term.replace(/[,()]/g, "");

      // Step 1: if beat filter active, get the customer IDs in that beat (the base set)
      let beatCustomerIds: string[] | null = null; // null = no beat filter
      if (beatF !== "all") {
        const { data: cs } = await supabase
          .from("customers")
          .select("id")
          .eq("beat_id", beatF);
        beatCustomerIds = (cs ?? []).map((c: { id: string }) => c.id);
        // No customers in this beat → bail out early with empty list
        if (beatCustomerIds.length === 0) {
          if (!cancelled) { setRows([]); setTotal(0); setLoading(false); }
          return;
        }
      }

      // Step 2: if searching, find matching customer IDs (constrained to beat if active)
      let customerIds: string[] = [];
      if (safeTerm) {
        let cq = supabase
          .from("customers")
          .select("id")
          .ilike("name", `%${safeTerm}%`)
          .limit(300);
        if (beatCustomerIds !== null) cq = cq.in("id", beatCustomerIds);
        const { data: cs } = await cq;
        customerIds = (cs ?? []).map((c: { id: string }) => c.id);
      }

      let q = supabase
        .from("orders")
        .select("*, customer:customers(id,name,customer_type,city), salesman:salesmen(id,name)", { count: "exact" });

      if (tabDef.statuses !== "all") {
        q = q.in("app_status", tabDef.statuses);
      }
      // Status filter narrows further within the tab. The dropdown only shows
      // statuses that are part of the current tab, so we just intersect.
      if (statusF !== "all") {
        q = q.eq("app_status", statusF);
      }
      // Apply beat narrowing to the orders query (always, when active)
      if (beatCustomerIds !== null) {
        q = q.in("customer_id", beatCustomerIds);
      }
      if (safeTerm) {
        if (customerIds.length > 0) {
          q = q.or(`rupyz_order_id.ilike.%${safeTerm}%,customer_id.in.(${customerIds.join(",")})`);
        } else {
          q = q.ilike("rupyz_order_id", `%${safeTerm}%`);
        }
      }
      if (salesmanF !== "all") q = q.eq("salesman_id", salesmanF);
      if (dateF !== "all") {
        const days = dateF === "today" ? 1 : dateF === "7d" ? 7 : 30;
        const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
        q = q.gte("rupyz_created_at", since);
      }
      q = q.order("rupyz_created_at", { ascending: false })
           .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, error, count } = await q;
      if (cancelled) return;
      if (error) toast.error(error.message);
      else {
        setRows((data ?? []) as unknown as Order[]);
        setTotal(count ?? 0);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, tab, searchDebounced, salesmanF, beatF, statusF, dateF, page, reloadKey]);

  const activeTabDef = TABS.find(t => t.key === tab)!;

  return (
    <div className="p-6">
      {/* KPI cards — also serve as tab switchers */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
        {TABS.filter(t => t.key !== "all").map((t) => (
          <KpiCard
            key={t.key}
            tab={t}
            kpi={kpis[t.key]}
            active={tab === t.key}
            onClick={() => setTab(t.key)}
          />
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-paper-card border border-paper-line rounded-md p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by order # or customer name…" className="pl-8" />
        </div>

        <Select value={salesmanF} onValueChange={setSalesmanF}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Salesman" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All salesmen</SelectItem>
            {salesmen.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={beatF} onValueChange={setBeatF}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Beat" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All beats</SelectItem>
            {beats.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={statusF} onValueChange={setStatusF}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {statusOptionsForTab(tab).map(s => (
              <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={dateF} onValueChange={setDateF}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant={tab === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab(tab === "all" ? defaultTabForRole(me.role) : "all")}
        >
          {tab === "all" ? "Showing all" : `View all (${kpis.all.count})`}
        </Button>
      </div>

      {/* Table */}
      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-subtle/60 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-medium">Order #</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Salesman</th>
                <th className="px-3 py-2 font-medium text-right">Total</th>
                <th className="px-3 py-2 font-medium">Payment</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-3 py-3"><div className="h-4 bg-paper-subtle rounded animate-pulse" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-12 text-center text-ink-muted">{activeTabDef.emptyHint}</td></tr>
              ) : (
                rows.map((o) => (
                  <tr key={o.id} onClick={() => setOpen(o)} className="hover:bg-paper-subtle/40 transition-colors cursor-pointer">
                    <td className="px-3 py-2 font-mono text-xs">{o.rupyz_order_id}{o.is_edited && <Badge variant="warn" className="ml-1.5">edited</Badge>}</td>
                    <td className="px-3 py-2 tabular text-ink-muted">
                      {new Date(o.rupyz_created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{o.customer?.name ?? <span className="italic text-ink-subtle">unknown</span>}</div>
                      <div className="text-2xs text-ink-subtle">{o.customer?.city ?? ""}</div>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {o.salesman?.name ?? <span className="italic text-ink-subtle">{o.rupyz_created_by_name ?? "—"}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular font-medium">{formatINR(o.total_amount)}</td>
                    <td className="px-3 py-2 text-2xs text-ink-muted">
                      {o.payment_option_check === "CREDIT_DAYS" ? `${o.remaining_payment_days ?? "?"}d credit`
                        : o.payment_option_check === "PAY_ON_DELIVERY" ? "COD"
                        : (o.payment_option_check ?? "—")}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={statusBadgeVariant(o.app_status)}>{o.app_status.replace(/_/g, " ")}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-3 py-2 border-t border-paper-line bg-paper-subtle/40 text-xs">
          <div className="text-ink-muted">
            {loading ? "Loading…" : (
              <>Showing <span className="tabular text-ink">{rows.length === 0 ? 0 : page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length}</span> of <span className="tabular text-ink">{total.toLocaleString("en-IN")}</span></>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      </div>

      <OrderDrawer
        order={open}
        onClose={() => setOpen(null)}
        onChanged={() => setReloadKey(k => k + 1)}
        me={me}
      />
    </div>
  );
}

function KpiCard({
  tab, kpi, active, onClick,
}: {
  tab: TabDef;
  kpi: { count: number; kg: number; amount: number };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  const accentBorder = {
    warn:    active ? "border-warn"    : "border-paper-line hover:border-warn/60",
    accent:  active ? "border-accent"  : "border-paper-line hover:border-accent/60",
    ok:      active ? "border-ok"      : "border-paper-line hover:border-ok/60",
    danger:  active ? "border-danger"  : "border-paper-line hover:border-danger/60",
    neutral: active ? "border-ink"     : "border-paper-line hover:border-ink/40",
  }[tab.accent];

  const accentText = {
    warn: "text-warn", accent: "text-accent", ok: "text-ok", danger: "text-danger", neutral: "text-ink",
  }[tab.accent];

  const accentBg = {
    warn: "bg-warn-soft", accent: "bg-accent-soft", ok: "bg-ok-soft", danger: "bg-danger-soft", neutral: "bg-paper-subtle",
  }[tab.accent];

  return (
    <button
      onClick={onClick}
      className={`text-left p-3 rounded-md border-2 bg-paper-card transition-all ${accentBorder} ${active ? "shadow-card" : ""}`}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`p-1 rounded ${accentBg}`}>
          <Icon size={12} className={accentText} />
        </span>
        <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium leading-tight">{tab.label}</span>
      </div>
      <div className="space-y-0.5">
        <div className="flex items-baseline gap-1">
          <span className={`text-xl font-bold tabular ${accentText}`}>{kpi.count}</span>
          <span className="text-2xs text-ink-muted">orders</span>
        </div>
        <div className="text-xs text-ink-muted tabular">
          {formatKg(kpi.kg)} · <span className="text-ink">{formatINRcompact(kpi.amount)}</span>
        </div>
      </div>
    </button>
  );
}

function formatKg(kg: number): string {
  if (kg === 0) return "0 kg";
  if (kg < 1)   return `${(kg * 1000).toFixed(0)} g`;
  if (kg < 100) return `${kg.toFixed(1)} kg`;
  return `${Math.round(kg).toLocaleString("en-IN")} kg`;
}

function formatINRcompact(amt: number): string {
  if (amt >= 10000000) return `₹${(amt / 10000000).toFixed(1)}cr`;
  if (amt >= 100000)   return `₹${(amt / 100000).toFixed(1)}L`;
  if (amt >= 1000)     return `₹${(amt / 1000).toFixed(1)}k`;
  return `₹${Math.round(amt)}`;
}
