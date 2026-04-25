"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { Order, Salesman, OrderAppStatus, AppUser } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";
import { OrderDrawer } from "./order-drawer";

const PAGE_SIZE = 50;

const statusFilter: { value: string; label: string }[] = [
  { value: "all",                  label: "All statuses" },
  { value: "received",             label: "Received (awaiting approval)" },
  { value: "approved",             label: "Approved" },
  { value: "partially_dispatched", label: "Partially dispatched" },
  { value: "dispatched",           label: "Dispatched" },
  { value: "delivered",            label: "Delivered" },
  { value: "rejected",             label: "Rejected" },
  { value: "closed",               label: "Closed" },
];

function statusBadgeVariant(s: OrderAppStatus): "neutral" | "ok" | "warn" | "danger" | "accent" {
  switch (s) {
    case "received": return "warn";
    case "approved":
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
  me,
}: {
  salesmen: Pick<Salesman, "id" | "name">[];
  me: AppUser;
}) {
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [statusF, setStatusF] = useState<string>("all");
  const [salesmanF, setSalesmanF] = useState<string>("all");
  const [dateF, setDateF] = useState<string>("today");

  const [open, setOpen] = useState<Order | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(0); }, [searchDebounced, statusF, salesmanF, dateF]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let q = supabase
        .from("orders")
        .select("*, customer:customers(id,name,customer_type,city), salesman:salesmen(id,name)", { count: "exact" });
      if (searchDebounced.trim()) q = q.ilike("rupyz_order_id", `%${searchDebounced.trim()}%`);
      if (statusF !== "all") q = q.eq("app_status", statusF);
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
  }, [supabase, searchDebounced, statusF, salesmanF, dateF, page]);

  return (
    <div className="p-6">
      {/* Quick filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <Chip active={statusF === "all"} onClick={() => setStatusF("all")}>All</Chip>
        <Chip active={statusF === "received"} onClick={() => setStatusF("received")}>Awaiting approval</Chip>
        <Chip active={statusF === "approved"} onClick={() => setStatusF("approved")}>Ready to dispatch</Chip>
        <Chip active={statusF === "partially_dispatched"} onClick={() => setStatusF("partially_dispatched")}>Partial</Chip>
        <Chip active={statusF === "dispatched"} onClick={() => setStatusF("dispatched")}>In transit</Chip>
        <Chip active={statusF === "delivered"} onClick={() => setStatusF("delivered")}>Delivered</Chip>
      </div>

      {/* Filter bar */}
      <div className="bg-paper-card border border-paper-line rounded-md p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by order number…" className="pl-8" />
        </div>

        <Select value={statusF} onValueChange={setStatusF}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>{statusFilter.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>

        <Select value={salesmanF} onValueChange={setSalesmanF}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Salesman" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All salesmen</SelectItem>
            {salesmen.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
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
                <tr><td colSpan={7} className="px-3 py-12 text-center text-ink-muted">No orders match your filters.</td></tr>
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

      <OrderDrawer order={open} onClose={() => setOpen(null)} me={me} />
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        active ? "bg-accent text-white border-accent" : "bg-paper-card text-ink-muted border-paper-line hover:border-accent hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
