"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Search, AlertCircle, PackageCheck, Truck, Route, CheckCircle2, XCircle, CheckSquare, X, ChevronDown, SlidersHorizontal, Receipt, type LucideIcon } from "lucide-react";
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
import {
  bulkApproveOrders,
  approveOrder,
  rejectOrder,
  cancelOrder,
  setInvoiceNumber,
  clearInvoiceNumber,
} from "./actions";
import { bulkAttachOrdersToTrip, listAllActiveTrips } from "../trips/actions";

const PAGE_SIZE = 50;

// KPI shape returned by orders_kpis_by_status RPC
interface KpiRow {
  app_status: OrderAppStatus;
  order_count: number;
  total_kg: number;
  total_amount: number;
}

// Status tabs — each maps a list of underlying app_status values
type TabKey = "approval" | "dispatch" | "invoiced" | "loading" | "van" | "transit" | "delivered" | "rejected" | "all";

interface TabDef {
  key: TabKey;
  label: string;
  statuses: OrderAppStatus[] | "all";
  emptyHint: string;
  icon: LucideIcon;
  accent: "warn" | "accent" | "ok" | "danger" | "neutral";
}

const TABS: TabDef[] = [
  { key: "approval",  label: "Waiting for approval",   statuses: ["received"],
    emptyHint: "Nothing waiting for your approval. Nice work.",
    icon: AlertCircle,   accent: "warn" },
  { key: "dispatch",  label: "Approved",  statuses: ["approved", "partially_dispatched"],
    emptyHint: "Nothing waiting for an invoice.",
    icon: PackageCheck,  accent: "accent" },
  { key: "invoiced",  label: "Invoiced",  statuses: ["invoiced"],
    emptyHint: "No invoiced orders waiting to load.",
    icon: Receipt,       accent: "accent" },
  { key: "loading",   label: "Loading",  statuses: ["loading", "loaded"],
    emptyHint: "No trucks currently loading.",
    icon: Truck,         accent: "warn" },
  { key: "van",       label: "On VAN",        statuses: ["on_van_trip"],
    emptyHint: "No orders on a VAN trip right now.",
    icon: Route,         accent: "accent" },
  { key: "transit",   label: "Dispatched",         statuses: ["dispatched"],
    emptyHint: "No deliveries on the road right now.",
    icon: Truck,         accent: "accent" },
  { key: "delivered", label: "Done",          statuses: ["delivered"],
    emptyHint: "No completed orders match your filters.",
    icon: CheckCircle2,  accent: "ok" },
  { key: "rejected",  label: "Rejected",           statuses: ["rejected", "cancelled"],
    emptyHint: "No rejected or cancelled orders.",
    icon: XCircle,       accent: "danger" },
  { key: "all",       label: "All",                statuses: "all",
    emptyHint: "No orders match your filters.",
    icon: AlertCircle,   accent: "neutral" },
];

function tabForStatus(s: OrderAppStatus): TabKey | null {
  if (s === "received") return "approval";
  if (s === "approved" || s === "partially_dispatched") return "dispatch";
  if (s === "invoiced") return "invoiced";
  if (s === "loading" || s === "loaded") return "loading";
  if (s === "on_van_trip") return "van";
  if (s === "dispatched") return "transit";
  if (s === "delivered") return "delivered";
  if (s === "rejected" || s === "cancelled") return "rejected";
  return null;
}

function defaultTabForRole(role: string): TabKey {
  switch (role) {
    case "approver": return "approval";
    case "billing":  return "dispatch";  // billing lands on the approved-waiting-for-invoice tab
    case "dispatch": return "invoiced";  // dispatch lands on invoiced-waiting-to-load
    case "van_lead": return "van";
    case "van_helper": return "van";
    case "delivery": return "transit";
    case "accounts": return "delivered";
    default:         return "all";
  }
}

const ALL_STATUSES: OrderAppStatus[] = [
    "received", "approved", "invoiced", "loading", "loaded", "on_van_trip",
    "partially_dispatched", "dispatched", "delivered",
    "rejected", "cancelled", "closed",
  ];

function statusOptionsForTab(tab: TabKey): OrderAppStatus[] {
  const def = TABS.find(t => t.key === tab);
  if (!def) return [];
  if (def.statuses === "all") return ALL_STATUSES;
  return def.statuses.length > 1 ? def.statuses : [];
}

function statusLabel(s: OrderAppStatus): string {
  switch (s) {
    case "received":              return "Waiting";
    case "approved":              return "Approved";
    case "invoiced":              return "Invoiced";
    case "loading":               return "Loading";
    case "loaded":                return "Loaded";
    case "on_van_trip":           return "On VAN";
    case "partially_dispatched":  return "Partly sent";
    case "dispatched":            return "Sent";
    case "delivered":             return "Done";
    case "rejected":              return "Rejected";
    case "cancelled":             return "Cancelled";
    case "closed":                return "Closed";
  }
}

function statusBadgeVariant(s: OrderAppStatus): "neutral" | "ok" | "warn" | "danger" | "accent" {
  switch (s) {
    case "received": return "warn";
    case "loading":  return "warn";
    case "loaded":   return "accent";
    case "invoiced": return "accent";
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

// =============================================================================
// DATE RANGE FILTER (unchanged)
// =============================================================================

type DatePresetKey =
  | "today" | "yesterday" | "7d" | "30d"
  | "this_month" | "last_month" | "custom" | "all";

function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function computeDateRange(
  preset: DatePresetKey,
  customFrom: string,
  customTo: string,
): { since: string | null; until: string | null } {
  if (preset === "all") return { since: null, until: null };

  const now = new Date();
  if (preset === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { since: start.toISOString(), until: null };
  }
  if (preset === "yesterday") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { since: start.toISOString(), until: end.toISOString() };
  }
  if (preset === "7d") {
    return { since: new Date(Date.now() - 7  * 86400 * 1000).toISOString(), until: null };
  }
  if (preset === "30d") {
    return { since: new Date(Date.now() - 30 * 86400 * 1000).toISOString(), until: null };
  }
  if (preset === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { since: start.toISOString(), until: null };
  }
  if (preset === "last_month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end   = new Date(now.getFullYear(), now.getMonth(), 1);
    return { since: start.toISOString(), until: end.toISOString() };
  }
  let since: string | null = null;
  let until: string | null = null;
  if (customFrom) since = new Date(`${customFrom}T00:00:00`).toISOString();
  if (customTo) {
    const d = new Date(`${customTo}T00:00:00`);
    d.setDate(d.getDate() + 1);
    until = d.toISOString();
  }
  return { since, until };
}

function defaultCustomRange(): { from: string; to: string } {
  const today = new Date();
  const thirtyAgo = new Date(today);
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  return { from: toLocalISODate(thirtyAgo), to: toLocalISODate(today) };
}

type KpiAgg = { count: number; kg: number; amount: number };

const EMPTY_KPI: Record<TabKey, KpiAgg> = {
  approval:  { count: 0, kg: 0, amount: 0 },
  dispatch:  { count: 0, kg: 0, amount: 0 },
  invoiced:  { count: 0, kg: 0, amount: 0 },
  loading:   { count: 0, kg: 0, amount: 0 },
  van:       { count: 0, kg: 0, amount: 0 },
  transit:   { count: 0, kg: 0, amount: 0 },
  delivered: { count: 0, kg: 0, amount: 0 },
  rejected:  { count: 0, kg: 0, amount: 0 },
  all:       { count: 0, kg: 0, amount: 0 },
};

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

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [tab, setTab] = useState<TabKey>(() => {
    const urlTab = searchParams?.get("tab");
    const validKeys: TabKey[] = ["approval", "dispatch", "invoiced", "loading", "van", "transit", "delivered", "rejected", "all"];
    if (urlTab && (validKeys as string[]).includes(urlTab)) return urlTab as TabKey;
    return defaultTabForRole(me.role);
  });
  const [salesmanF, setSalesmanF] = useState<string>("all");
  const [beatF, setBeatF] = useState<string>("all");
  const [statusF, setStatusF] = useState<string>("all");
  const [dateF, setDateF] = useState<DatePresetKey>("all");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  const dateRange = useMemo(
    () => computeDateRange(dateF, customFrom, customTo),
    [dateF, customFrom, customTo],
  );
  const customRangeInvalid =
    dateF === "custom" && !!customFrom && !!customTo && customFrom > customTo;

  function handleDateChange(v: string) {
    const next = v as DatePresetKey;
    setDateF(next);
    if (next === "custom" && !customFrom && !customTo) {
      const { from, to } = defaultCustomRange();
      setCustomFrom(from);
      setCustomTo(to);
    }
  }

  const advFilterActive = salesmanF !== "all" || beatF !== "all" || statusF !== "all" || dateF !== "all";
  const [showAdvanced, setShowAdvanced] = useState(false);
  useEffect(() => { if (advFilterActive) setShowAdvanced(true); }, [advFilterActive]);

  const [kpis, setKpis] = useState<Record<TabKey, KpiAgg>>(EMPTY_KPI);

  const [reloadKey, setReloadKey] = useState(0);

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

  // ============== BULK ACTIONS ==============
  const [bulkPending, startBulkTransition] = useTransition();
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  type ActiveTrip = { id: string; trip_number: string; trip_date: string; beat_id: string; status: string; beat: { id: string; name: string } | null; lead: { id: string; full_name: string } | null };
  const [activeTrips, setActiveTrips] = useState<ActiveTrip[]>([]);
  const [pickedTripId, setPickedTripId] = useState("");

  const allOnPageSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id));
  const someOnPageSelected = rows.some(r => selectedIds.has(r.id)) && !allOnPageSelected;

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function togglePage() {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) rows.forEach(r => next.delete(r.id));
      else rows.forEach(r => next.add(r.id));
      return next;
    });
  }
  async function selectAllMatchingFilter() {
    const tabDef = TABS.find(t => t.key === tab)!;
    const term = searchDebounced.trim();
    const safeTerm = term.replace(/[,()]/g, "");

    let q = supabase.from("orders").select("id");
    if (tabDef.statuses !== "all") q = q.in("app_status", tabDef.statuses);
    if (statusF !== "all") q = q.eq("app_status", statusF);
    if (salesmanF !== "all") q = q.eq("salesman_id", salesmanF);

    if (dateRange.since) q = q.gte("rupyz_created_at", dateRange.since);
    if (dateRange.until) q = q.lt ("rupyz_created_at", dateRange.until);

    if (beatF !== "all") {
      const { data: cs } = await supabase.from("customers").select("id").eq("beat_id", beatF);
      const ids = (cs ?? []).map((c: { id: string }) => c.id);
      if (ids.length === 0) { toast.error("No customers in that beat"); return; }
      q = q.in("customer_id", ids);
    }

    if (safeTerm) q = q.ilike("rupyz_order_id", `%${safeTerm}%`);

    q = q.limit(501);

    const { data, error } = await q;
    if (error) { toast.error(error.message); return; }
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) { toast.error("No orders match the current filter"); return; }
    if (ids.length > 500) {
      toast.error(`Too many matches (>${500}). Narrow your filter — try a shorter date range or a specific beat.`);
      return;
    }
    setSelectedIds(new Set(ids));
    toast.success(`Selected ${ids.length} order${ids.length === 1 ? "" : "s"}`);
  }

  function clearSelection() { setSelectedIds(new Set()); }
  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setShowAttachPicker(false);
  }

  function handleBulkApprove() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { toast.error("No orders selected"); return; }
    if (!confirm(`Approve ${ids.length} order${ids.length === 1 ? "" : "s"}? Orders not in 'received' status will be skipped.`)) return;
    startBulkTransition(async () => {
      const res = await bulkApproveOrders(ids);
      if (res.error) { toast.error(res.error); return; }
      const failed = (res.total ?? 0) - (res.succeeded ?? 0);
      if (failed === 0) {
        toast.success(`Approved all ${res.succeeded} orders`);
      } else {
        const sample = (res.results ?? []).filter(r => !r.ok).slice(0, 2).map(r => r.error).join("; ");
        toast.warning(`Approved ${res.succeeded} of ${res.total}. ${failed} skipped (${sample}${failed > 2 ? ", …" : ""})`, { duration: 8000 });
      }
      exitSelectionMode();
      setReloadKey(k => k + 1);
    });
  }

  async function startBulkAttach() {
    if (selectedIds.size === 0) { toast.error("No orders selected"); return; }
    setShowAttachPicker(true);
    setPickedTripId("");
    setActiveTrips([]);
    const res = await listAllActiveTrips();
    if ("error" in res && res.error) {
      toast.error(res.error);
      setShowAttachPicker(false);
      return;
    }
    const trips = (res.trips ?? []) as unknown as ActiveTrip[];
    setActiveTrips(trips);
    if (trips.length === 0) {
      toast.error("No active trips right now. Start a trip first.");
      setShowAttachPicker(false);
      return;
    }
    if (trips.length === 1) setPickedTripId(trips[0].id);
  }

  function handleBulkAttach() {
    const ids = Array.from(selectedIds);
    if (!pickedTripId) { toast.error("Pick a trip"); return; }
    const trip = activeTrips.find(t => t.id === pickedTripId);
    if (!trip) { toast.error("Trip not found"); return; }
    const statusLbl = trip.status === "in_progress" ? "on-route" : trip.status;
    if (!confirm(`Add ${ids.length} order${ids.length === 1 ? "" : "s"} to ${trip.trip_number} (${trip.beat?.name}, ${statusLbl})? Orders may be from any beat — admin override is enabled.`)) return;
    startBulkTransition(async () => {
      const res = await bulkAttachOrdersToTrip(ids, pickedTripId);
      if (res.error) { toast.error(res.error); return; }
      const failed = (res.total ?? 0) - (res.succeeded ?? 0);
      const sw = res.stockWarningCount ?? 0;
      if (failed === 0 && sw === 0) {
        toast.success(`Added ${res.succeeded} order${res.succeeded === 1 ? "" : "s"} to ${res.tripNumber}`);
      } else if (failed === 0 && sw > 0) {
        toast.warning(`Added ${res.succeeded}, but ${sw} stock warning${sw === 1 ? "" : "s"} — lead will see at billing time`, { duration: 8000 });
      } else {
        const sample = (res.results ?? []).filter(r => !r.ok).slice(0, 2).map(r => r.error).join("; ");
        toast.warning(`Added ${res.succeeded} of ${res.total}. ${failed} skipped (${sample}${failed > 2 ? ", …" : ""})`, { duration: 10000 });
      }
      exitSelectionMode();
      setReloadKey(k => k + 1);
    });
  }
  // ============== END BULK ACTIONS ==============

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(0); setSelectedIds(new Set()); },
    [searchDebounced, tab, salesmanF, beatF, statusF, dateF, customFrom, customTo]);

  useEffect(() => {
    if (statusF === "all") return;
    const valid = statusOptionsForTab(tab);
    if (!valid.includes(statusF as OrderAppStatus)) setStatusF("all");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (customRangeInvalid) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("orders_kpis_by_status", {
        since_ts: dateRange.since,
        until_ts: dateRange.until,
        beat_id_filter: beatF !== "all" ? beatF : null,
      });
      if (cancelled || error) {
        if (error) toast.error(`KPI load failed: ${error.message}`);
        return;
      }

      const next: Record<TabKey, KpiAgg> = {
        approval:  { count: 0, kg: 0, amount: 0 },
        dispatch:  { count: 0, kg: 0, amount: 0 },
        invoiced:  { count: 0, kg: 0, amount: 0 },
        loading:   { count: 0, kg: 0, amount: 0 },
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
  }, [supabase, dateRange.since, dateRange.until, beatF, reloadKey, customRangeInvalid]);

  const prevReloadKeyRef = useRef(reloadKey);
  useEffect(() => {
    if (customRangeInvalid) {
      setRows([]); setTotal(0); setLoading(false);
      return;
    }
    let cancelled = false;
    const isPollingRefresh = prevReloadKeyRef.current !== reloadKey;
    prevReloadKeyRef.current = reloadKey;
    if (!isPollingRefresh) setLoading(true);
    (async () => {
      const tabDef = TABS.find(t => t.key === tab)!;
      const term = searchDebounced.trim();
      const safeTerm = term.replace(/[,()]/g, "");

      let beatCustomerIds: string[] | null = null;
      if (beatF !== "all") {
        const { data: cs } = await supabase
          .from("customers")
          .select("id")
          .eq("beat_id", beatF);
        beatCustomerIds = (cs ?? []).map((c: { id: string }) => c.id);
        if (beatCustomerIds.length === 0) {
          if (!cancelled) { setRows([]); setTotal(0); setLoading(false); }
          return;
        }
      }

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
        .select("*, customer:customers(id,name,customer_type,city,beat_overridden_at,beat:beats(id,name)), salesman:salesmen(id,name)", { count: "exact" });

      if (tabDef.statuses !== "all") q = q.in("app_status", tabDef.statuses);
      if (statusF !== "all") q = q.eq("app_status", statusF);
      if (beatCustomerIds !== null) q = q.in("customer_id", beatCustomerIds);
      if (safeTerm) {
        if (customerIds.length > 0) {
          q = q.or(`rupyz_order_id.ilike.%${safeTerm}%,customer_id.in.(${customerIds.join(",")})`);
        } else {
          q = q.ilike("rupyz_order_id", `%${safeTerm}%`);
        }
      }
      if (salesmanF !== "all") q = q.eq("salesman_id", salesmanF);

      if (dateRange.since) q = q.gte("rupyz_created_at", dateRange.since);
      if (dateRange.until) q = q.lt ("rupyz_created_at", dateRange.until);

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
  }, [supabase, tab, searchDebounced, salesmanF, beatF, statusF,
      dateRange.since, dateRange.until, customRangeInvalid,
      page, reloadKey]);

  const activeTabDef = TABS.find(t => t.key === tab)!;

  return (
    <div className="p-3 sm:p-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-2.5 mb-3 sm:mb-4">
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

      <PrimaryActionCallout
        tab={tab}
        kpis={kpis}
        meRole={me.role}
        onApproveAll={async () => {
          setSelectionMode(true);
          await new Promise(r => setTimeout(r, 40));
          await selectAllMatchingFilter();
          await new Promise(r => setTimeout(r, 40));
          handleBulkApprove();
        }}
        onAttachAll={async () => {
          setSelectionMode(true);
          await new Promise(r => setTimeout(r, 40));
          await selectAllMatchingFilter();
          await new Promise(r => setTimeout(r, 40));
          startBulkAttach();
        }}
      />

      {/* Filter bar */}
      <div className="bg-paper-card border border-paper-line rounded-md p-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-full sm:min-w-[220px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by order # or customer name…" className="pl-8" />
          </div>

          <Button
            variant={showAdvanced || advFilterActive ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAdvanced(s => !s)}
          >
            <SlidersHorizontal size={11}/> Filters
            {advFilterActive && <span className="ml-1 bg-paper-card text-accent rounded-full text-2xs px-1.5">●</span>}
          </Button>

          <Button
            variant={tab === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab(tab === "all" ? defaultTabForRole(me.role) : "all")}
          >
            {tab === "all" ? "Showing all" : `All (${kpis.all.count})`}
          </Button>

          {(["admin", "approver", "van_lead", "dispatch"].includes(me.role)) && (
            <Button
              variant={selectionMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                if (selectionMode) exitSelectionMode();
                else setSelectionMode(true);
              }}
            >
              {selectionMode ? <><X size={11}/> Exit bulk mode</> : <><CheckSquare size={11}/> Bulk select</>}
            </Button>
          )}
        </div>

        {showAdvanced && (
          <>
            <div className="mt-3 pt-3 border-t border-paper-line flex flex-wrap items-center gap-2">
              <Select value={salesmanF} onValueChange={setSalesmanF}>
                <SelectTrigger className="flex-1 min-w-[120px] sm:w-[160px] sm:flex-none"><SelectValue placeholder="Salesman" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All salesmen</SelectItem>
                  {salesmen.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={beatF} onValueChange={setBeatF}>
                <SelectTrigger className="flex-1 min-w-[120px] sm:w-[160px] sm:flex-none"><SelectValue placeholder="Beat" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All beats</SelectItem>
                  {beats.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={statusF} onValueChange={setStatusF}>
                <SelectTrigger className="flex-1 min-w-[120px] sm:w-[160px] sm:flex-none"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {statusOptionsForTab(tab).map(s => (
                    <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={dateF} onValueChange={handleDateChange}>
                <SelectTrigger className="flex-1 min-w-[140px] sm:flex-none sm:w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="this_month">This month</SelectItem>
                  <SelectItem value="last_month">Last month</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>

              {advFilterActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSalesmanF("all"); setBeatF("all"); setStatusF("all");
                    setDateF("all"); setCustomFrom(""); setCustomTo("");
                  }}
                >
                  <X size={11}/> Clear filters
                </Button>
              )}
            </div>

            {dateF === "custom" && (
              <div className="mt-2 pt-2 border-t border-paper-line/60 flex flex-wrap items-center gap-2">
                <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Range:</span>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  max={customTo || undefined}
                  className="w-auto flex-1 min-w-[140px] sm:flex-none sm:w-[150px]"
                  aria-label="From date"
                />
                <span className="text-2xs text-ink-muted">to</span>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  min={customFrom || undefined}
                  className="w-auto flex-1 min-w-[140px] sm:flex-none sm:w-[150px]"
                  aria-label="To date"
                />
                {(customFrom || customTo) && (
                  <button
                    type="button"
                    onClick={() => { setCustomFrom(""); setCustomTo(""); }}
                    className="text-2xs text-ink-muted hover:text-ink"
                  >
                    Clear dates
                  </button>
                )}
                {customRangeInvalid && (
                  <span className="text-2xs text-danger w-full sm:w-auto">
                    "To" must be on or after "From".
                  </span>
                )}
                {!customFrom && !customTo && (
                  <span className="text-2xs text-ink-subtle italic w-full sm:w-auto">
                    Pick a range — leaving both blank shows everything.
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Table */}
      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-paper-subtle/60 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                {selectionMode && (
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      ref={el => { if (el) el.indeterminate = someOnPageSelected; }}
                      onChange={togglePage}
                      className="cursor-pointer"
                      aria-label="Select all on page"
                    />
                  </th>
                )}
                <th className="px-3 py-2.5 font-medium">Order #</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 font-medium">Salesman</th>
                <th className="px-3 py-2.5 font-medium text-right">Total</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={selectionMode ? 7 : 6} className="px-3 py-3"><div className="h-4 bg-paper-subtle rounded animate-pulse" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={selectionMode ? 7 : 6} className="px-3 py-12 text-center text-ink-muted">{activeTabDef.emptyHint}</td></tr>
              ) : (
                rows.map((o) => {
                  const isSelected = selectedIds.has(o.id);
                  return (
                    <tr
                      key={o.id}
                      onClick={(e) => {
                        if (selectionMode) {
                          if ((e.target as HTMLElement).tagName !== "INPUT") toggleOne(o.id);
                        } else {
                          setOpen(o);
                        }
                      }}
                      className={`hover:bg-paper-subtle/40 transition-colors cursor-pointer ${isSelected ? "bg-accent-soft/40" : ""}`}
                    >
                      {selectionMode && (
                        <td className="px-3 py-2 w-10" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(o.id)}
                            className="cursor-pointer"
                            aria-label="Select this order"
                          />
                        </td>
                      )}
                      <td className="px-3 py-3 font-mono text-xs">{o.rupyz_order_id}{o.is_edited && <Badge variant="warn" className="ml-1.5">edited</Badge>}</td>
                    <td className="px-3 py-3 tabular text-ink-muted">
                      {new Date(o.rupyz_created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium">{o.customer?.name ?? <span className="italic text-ink-subtle">unknown</span>}</div>
                      <div className="text-2xs text-ink-subtle">{o.customer?.city ?? ""}</div>
                    </td>
                    <td className="px-3 py-3 text-ink-muted">
                      {o.salesman?.name ?? <span className="italic text-ink-subtle">{o.rupyz_created_by_name ?? "—"}</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular font-medium">{formatINR(o.total_amount)}</td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <StatusBadgeAction
                        order={o}
                        meRole={me.role}
                        onChanged={() => setReloadKey(k => k + 1)}
                      />
                    </td>
                  </tr>
                  );
                })
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

      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 bg-paper-card border border-paper-line rounded-md shadow-lg px-4 py-2.5 flex items-center gap-3">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-base tabular">{selectedIds.size}</span>
            <span className="text-xs text-ink-muted">selected</span>
          </div>
          <button
            onClick={selectAllMatchingFilter}
            className="text-2xs text-accent hover:underline whitespace-nowrap"
            disabled={bulkPending}
          >
            Select all matching filter
          </button>
          <button
            onClick={clearSelection}
            className="text-2xs text-ink-muted hover:text-ink whitespace-nowrap"
            disabled={bulkPending}
          >
            Clear
          </button>
          <span className="border-l border-paper-line h-5"></span>
          {(["admin", "approver"].includes(me.role)) && (
            <Button size="sm" onClick={handleBulkApprove} disabled={bulkPending}>
              <CheckCircle2 size={11}/> {bulkPending ? "Approving…" : "Approve"}
            </Button>
          )}
          {(["admin", "van_lead"].includes(me.role)) && (
            <Button size="sm" variant="outline" onClick={startBulkAttach} disabled={bulkPending}>
              <Truck size={11}/> Add to active trip
            </Button>
          )}
        </div>
      )}

      {showAttachPicker && (
        <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-40 flex items-center justify-center px-4">
          <div className="bg-paper-card border border-paper-line rounded-md shadow-xl max-w-md w-full p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Add {selectedIds.size} order{selectedIds.size === 1 ? "" : "s"} to which trip?</h3>
              <button onClick={() => setShowAttachPicker(false)} className="text-ink-muted hover:text-ink" disabled={bulkPending}><X size={14}/></button>
            </div>

            {activeTrips.length === 0 ? (
              <p className="text-sm text-ink-muted py-4">Loading trips…</p>
            ) : (
              <>
                <div className="space-y-1.5 mb-4 max-h-72 overflow-y-auto">
                  {activeTrips.map(t => (
                    <label
                      key={t.id}
                      className={`flex items-center gap-2 p-2.5 border rounded cursor-pointer ${pickedTripId === t.id ? "border-accent bg-accent-soft/30" : "border-paper-line hover:border-paper-line"}`}
                    >
                      <input
                        type="radio"
                        name="bulk-trip-pick"
                        value={t.id}
                        checked={pickedTripId === t.id}
                        onChange={() => setPickedTripId(t.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-2xs text-ink-muted">{t.trip_number}</span>
                          <Badge variant={t.status === "in_progress" ? "accent" : "neutral"}>
                            {t.status === "in_progress" ? "on route" : t.status}
                          </Badge>
                        </div>
                        <div className="text-sm font-medium">{t.beat?.name ?? "—"}</div>
                        <div className="text-2xs text-ink-muted">
                          {new Date(t.trip_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          {t.lead && <> · {t.lead.full_name}</>}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="text-2xs text-ink-subtle mb-3">
                  Orders can be attached to planning, loading, or on-route trips. From any beat. Stock warnings only fire for on-route trips.
                </p>
              </>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAttachPicker(false)} disabled={bulkPending}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleBulkAttach} disabled={bulkPending || !pickedTripId}>
                <Truck size={11}/> {bulkPending ? "Adding…" : "Add to trip"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <OrderDrawer
        order={open}
        onClose={() => setOpen(null)}
        onChanged={() => setReloadKey(k => k + 1)}
        me={me}
        beats={beats}
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

// =============================================================================
// INLINE STATUS BADGE — with invoice support
// =============================================================================

interface StatusBadgeActionProps {
  order: Order;
  meRole: string;
  onChanged: () => void;
}

function StatusBadgeAction({ order, meRole, onChanged }: StatusBadgeActionProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<null | "approve" | "reject" | "cancel" | "invoice" | "clearInvoice">(null);
  const [reason, setReason] = useState("");
  const [invoiceInput, setInvoiceInput] = useState("");

  const isApprover = ["admin", "approver"].includes(meRole);
  const isBilling = ["admin", "billing"].includes(meRole);

  const canApprove = isApprover && order.app_status === "received";
  const canReject  = isApprover && order.app_status === "received";
  const canCancel  = isApprover && (order.app_status === "approved" || order.app_status === "invoiced");
  const canInvoice = isBilling && order.app_status === "approved";
  const canEditInvoice = isBilling && order.app_status === "invoiced";

  const hasActions = canApprove || canReject || canCancel || canInvoice || canEditInvoice;

  // Order may have invoice_number now (after migration); read defensively in case
  // the TS type hasn't been updated yet.
  const invoiceNumber = (order as Order & { invoice_number?: string | null }).invoice_number ?? null;

  function close() {
    setOpen(false);
    setConfirming(null);
    setReason("");
    setInvoiceInput("");
  }

  function openInvoiceMode() {
    setConfirming("invoice");
    setInvoiceInput(invoiceNumber ?? "");
  }

  function doApprove() {
    startTransition(async () => {
      const res = await approveOrder(order.id);
      if (res.error) toast.error(res.error);
      else { toast.success(`Order #${order.rupyz_order_id} approved`); close(); onChanged(); }
    });
  }
  function doReject() {
    if (!reason.trim()) { toast.error("A reason is required to reject."); return; }
    startTransition(async () => {
      const res = await rejectOrder(order.id, reason.trim());
      if (res.error) toast.error(res.error);
      else { toast.success(`Order #${order.rupyz_order_id} rejected`); close(); onChanged(); }
    });
  }
  function doCancel() {
    if (!reason.trim()) { toast.error("A reason is required to cancel."); return; }
    startTransition(async () => {
      const res = await cancelOrder(order.id, reason.trim());
      if (res.error) toast.error(res.error);
      else { toast.success(`Order #${order.rupyz_order_id} cancelled`); close(); onChanged(); }
    });
  }
  function doSaveInvoice() {
    const v = invoiceInput.trim();
    if (!v) { toast.error("Enter the Tally invoice number."); return; }
    startTransition(async () => {
      const res = await setInvoiceNumber(order.id, v);
      if (res.error) toast.error(res.error);
      else { toast.success(`Invoice saved for #${order.rupyz_order_id}`); close(); onChanged(); }
    });
  }
  function doClearInvoice() {
    startTransition(async () => {
      const res = await clearInvoiceNumber(order.id);
      if (res.error) toast.error(res.error);
      else { toast.success(`Invoice cleared for #${order.rupyz_order_id}`); close(); onChanged(); }
    });
  }

  // Plain badge for users without actions
  if (!hasActions) {
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant={statusBadgeVariant(order.app_status)}>{statusLabel(order.app_status)}</Badge>
        {invoiceNumber && (
          <span className="text-2xs font-mono text-ink-muted" title={`Invoice #${invoiceNumber}`}>
            inv {invoiceNumber}
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="inline-flex items-center gap-1 group"
        aria-label={`Change status of order ${order.rupyz_order_id}`}
      >
        <Badge variant={statusBadgeVariant(order.app_status)} className="cursor-pointer group-hover:opacity-80 transition-opacity">
          {statusLabel(order.app_status)}
        </Badge>
        {invoiceNumber && (
          <span className="text-2xs font-mono text-ink-muted">inv {invoiceNumber}</span>
        )}
        <ChevronDown size={11} className="text-ink-subtle group-hover:text-ink-muted transition-colors" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center px-4"
          onClick={(e) => { e.stopPropagation(); close(); }}
        >
          <div
            className="bg-paper-card border border-paper-line rounded-md shadow-xl max-w-sm w-full p-4"
            onClick={e => e.stopPropagation()}
          >
            {!confirming && (
              <>
                <div className="mb-1 text-2xs uppercase tracking-wide text-ink-muted">
                  Order #{order.rupyz_order_id}
                </div>
                <div className="font-semibold mb-3">{order.customer?.name ?? "—"}</div>

                {invoiceNumber && (
                  <div className="mb-3 text-xs px-2 py-1.5 bg-paper-subtle rounded">
                    <span className="text-ink-muted">Invoice #</span>
                    <span className="font-mono ml-1.5">{invoiceNumber}</span>
                  </div>
                )}

                <div className="text-xs text-ink-muted mb-2">
                  {canInvoice ? "Enter invoice or change status:" : "Change status to:"}
                </div>
                <div className="flex flex-col gap-2">
                  {canInvoice && (
                    <Button onClick={openInvoiceMode} disabled={pending} className="w-full justify-start">
                      <Receipt size={13}/> Mark as invoiced
                    </Button>
                  )}
                  {canEditInvoice && (
                    <Button variant="outline" onClick={openInvoiceMode} disabled={pending} className="w-full justify-start">
                      <Receipt size={13}/> Edit invoice number
                    </Button>
                  )}
                  {canEditInvoice && (
                    <Button variant="outline" onClick={() => setConfirming("clearInvoice")} disabled={pending} className="w-full justify-start">
                      <X size={13}/> Clear invoice (revert to approved)
                    </Button>
                  )}
                  {canApprove && (
                    <Button onClick={() => setConfirming("approve")} disabled={pending} className="w-full justify-start">
                      <CheckCircle2 size={13}/> Approve
                    </Button>
                  )}
                  {canReject && (
                    <Button variant="outline" onClick={() => setConfirming("reject")} disabled={pending} className="w-full justify-start">
                      <XCircle size={13}/> Reject
                    </Button>
                  )}
                  {canCancel && (
                    <Button variant="outline" onClick={() => setConfirming("cancel")} disabled={pending} className="w-full justify-start">
                      <XCircle size={13}/> Cancel order
                    </Button>
                  )}
                  <Button variant="ghost" onClick={close} disabled={pending} className="w-full">
                    Close
                  </Button>
                </div>
              </>
            )}

            {confirming === "invoice" && (
              <>
                <div className="font-semibold mb-2">
                  {canEditInvoice ? "Edit invoice number" : "Mark as invoiced"}
                </div>
                <p className="text-xs text-ink-muted mb-3">
                  Order #{order.rupyz_order_id} for <strong>{order.customer?.name ?? "—"}</strong>.
                  Enter the invoice number from Tally.
                </p>
                <Input
                  value={invoiceInput}
                  onChange={(e) => setInvoiceInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") doSaveInvoice(); }}
                  placeholder="e.g. SAJ-26-0142"
                  className="mb-3 font-mono"
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>Back</Button>
                  <Button onClick={doSaveInvoice} disabled={pending || !invoiceInput.trim()}>
                    <Receipt size={13}/> {pending ? "Saving…" : "Save invoice"}
                  </Button>
                </div>
              </>
            )}

            {confirming === "clearInvoice" && (
              <>
                <div className="font-semibold mb-2">Clear invoice?</div>
                <p className="text-xs text-ink-muted mb-3">
                  This will remove invoice <span className="font-mono">{invoiceNumber}</span> and revert
                  the order to <strong>approved</strong>. Loading will be blocked until a new invoice is entered.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>Back</Button>
                  <Button variant="outline" onClick={doClearInvoice} disabled={pending}>
                    <X size={13}/> {pending ? "Clearing…" : "Yes, clear invoice"}
                  </Button>
                </div>
              </>
            )}

            {confirming === "approve" && (
              <>
                <div className="font-semibold mb-2">Approve this order?</div>
                <p className="text-xs text-ink-muted mb-3">
                  Order #{order.rupyz_order_id} for <strong>{order.customer?.name ?? "—"}</strong> ({formatINR(order.total_amount)}) will be marked approved and ready for invoicing.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>Back</Button>
                  <Button onClick={doApprove} disabled={pending}>
                    <CheckCircle2 size={13}/> {pending ? "Approving…" : "Yes, approve"}
                  </Button>
                </div>
              </>
            )}

            {(confirming === "reject" || confirming === "cancel") && (
              <>
                <div className="font-semibold mb-2">
                  {confirming === "reject" ? "Reject this order?" : "Cancel this order?"}
                </div>
                <p className="text-xs text-ink-muted mb-3">
                  Order #{order.rupyz_order_id} for <strong>{order.customer?.name ?? "—"}</strong>.
                  {" "}
                  {confirming === "cancel" && "If this order is on a trip, that trip's bills will be cancelled too."}
                </p>
                <label className="text-2xs uppercase tracking-wide text-ink-muted">Reason</label>
                <textarea
                  className="w-full mt-1 mb-3 border border-paper-line rounded p-2 text-sm bg-paper resize-none"
                  rows={3}
                  placeholder={confirming === "reject" ? "e.g. Wrong rate, customer asked to amend" : "e.g. Customer cancelled by phone"}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setConfirming(null)} disabled={pending}>Back</Button>
                  <Button
                    variant="outline"
                    onClick={confirming === "reject" ? doReject : doCancel}
                    disabled={pending || !reason.trim()}
                  >
                    <XCircle size={13}/> {pending ? "Working…" : (confirming === "reject" ? "Yes, reject" : "Yes, cancel")}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// =============================================================================
// PRIMARY ACTION CALLOUT
// =============================================================================

function PrimaryActionCallout({
  tab, kpis, meRole, onApproveAll, onAttachAll,
}: {
  tab: TabKey;
  kpis: Record<TabKey, { count: number; kg: number; amount: number }>;
  meRole: string;
  onApproveAll: () => void;
  onAttachAll: () => void;
}) {
  const isApprover = ["admin", "approver"].includes(meRole);
  const isVanLead = ["admin", "van_lead"].includes(meRole);
  const isBilling = ["admin", "billing"].includes(meRole);

  if (tab === "approval" && isApprover && kpis.approval.count > 0) {
    return (
      <div className="bg-warn-soft border border-warn/40 rounded-md p-3 sm:p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <AlertCircle size={18} className="text-warn shrink-0"/>
          <div>
            <div className="font-semibold text-sm">
              {kpis.approval.count} order{kpis.approval.count === 1 ? "" : "s"} waiting for your approval
            </div>
            <div className="text-2xs text-ink-muted">
              Click below to approve them all in one go, or click any row to handle one at a time.
            </div>
          </div>
        </div>
        <Button onClick={onApproveAll} size="sm" className="shrink-0">
          <CheckCircle2 size={13}/> Approve all
        </Button>
      </div>
    );
  }

  if (tab === "dispatch" && isBilling && kpis.dispatch.count > 0) {
    return (
      <div className="bg-accent-soft border border-accent/30 rounded-md p-3 sm:p-4 mb-4 flex items-center gap-3">
        <Receipt size={18} className="text-accent shrink-0"/>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">
            {kpis.dispatch.count} approved order{kpis.dispatch.count === 1 ? "" : "s"} waiting for Tally invoice
          </div>
          <div className="text-2xs text-ink-muted">
            Click any row's status badge → "Mark as invoiced" to enter the invoice number from Tally.
          </div>
        </div>
      </div>
    );
  }

  if (tab === "invoiced" && isVanLead && kpis.invoiced.count > 0) {
    return (
      <div className="bg-accent-soft border border-accent/30 rounded-md p-3 sm:p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <PackageCheck size={18} className="text-accent shrink-0"/>
          <div>
            <div className="font-semibold text-sm">
              {kpis.invoiced.count} invoiced order{kpis.invoiced.count === 1 ? "" : "s"} ready to load
            </div>
            <div className="text-2xs text-ink-muted">
              Add to a VAN trip, or hand off to the loading workflow.
            </div>
          </div>
        </div>
        <Button onClick={onAttachAll} size="sm" variant="outline" className="shrink-0">
          <Truck size={13}/> Add all to VAN trip
        </Button>
      </div>
    );
  }

  return null;
}
