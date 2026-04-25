"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Eye, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody, SheetFooter,
} from "@/components/ui/sheet";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { Order, OrderItem, Salesman, OrderAppStatus } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";

const PAGE_SIZE = 50;

const statusFilter: { value: string; label: string }[] = [
  { value: "all",                  label: "All statuses" },
  { value: "received",             label: "Received" },
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
    case "approved": return "accent";
    case "partially_dispatched": return "accent";
    case "dispatched": return "accent";
    case "delivered": return "ok";
    case "rejected":
    case "cancelled": return "danger";
    case "closed": return "neutral";
  }
}

export function OrdersClient({ salesmen }: { salesmen: Pick<Salesman, "id" | "name">[] }) {
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

      if (searchDebounced.trim()) {
        q = q.ilike("rupyz_order_id", `%${searchDebounced.trim()}%`);
      }
      if (statusF !== "all")    q = q.eq("app_status", statusF);
      if (salesmanF !== "all")  q = q.eq("salesman_id", salesmanF);

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
      {/* Filter bar */}
      <div className="bg-paper-card border border-paper-line rounded-md p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by order number…"
            className="pl-8"
          />
        </div>

        <Select value={statusF} onValueChange={setStatusF}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {statusFilter.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
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
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={8} className="px-3 py-3"><div className="h-4 bg-paper-subtle rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-12 text-center text-ink-muted">
                    No orders match your filters. Sync hasn't run yet? See <a href="/settings" className="text-accent underline">Settings</a>.
                  </td>
                </tr>
              ) : (
          rows.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => setOpen(o)}
                    className="hover:bg-paper-subtle/40 transition-colors cursor-pointer"
                  >
                    <td className="px-3 py-2 font-mono text-xs">{o.rupyz_order_id}</td>
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
                      {o.payment_option_check === "CREDIT_DAYS" ? `${o.remaining_payment_days ?? "?"}d credit` : (o.payment_option_check ?? "—")}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={statusBadgeVariant(o.app_status)}>
                        {o.app_status.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setOpen(o)}>
                        <Eye size={12} /> View
                      </Button>
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
              <>
                Showing <span className="tabular text-ink">{rows.length === 0 ? 0 : page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length}</span>{" "}
                of <span className="tabular text-ink">{total.toLocaleString("en-IN")}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total || loading} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      </div>

      <OrderDrawer order={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function OrderDrawer({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!order) return;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", order.id)
        .order("created_at");
      if (error) toast.error(error.message);
      else setItems(data ?? []);
      setLoading(false);
    })();
  }, [order, supabase]);

  if (!order) return null;

  return (
    <Sheet open={!!order} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="max-w-3xl">
        <SheetHeader>
          <div>
            <SheetTitle className="font-mono">#{order.rupyz_order_id}</SheetTitle>
            <SheetDescription>
              Placed {new Date(order.rupyz_created_at).toLocaleString("en-IN")} · {order.source}
              {order.is_telephonic && " · telephonic"}
            </SheetDescription>
          </div>
        </SheetHeader>
        <SheetBody>
          {/* Top summary */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <Card label="Customer">
              <div className="font-semibold">{order.customer?.name ?? <span className="italic text-ink-subtle">unknown</span>}</div>
              <div className="text-xs text-ink-muted mt-0.5">{order.customer?.customer_type ?? ""}</div>
              <div className="text-xs text-ink-muted">{order.delivery_mobile}</div>
            </Card>
            <Card label="Salesman">
              <div className="font-semibold">{order.salesman?.name ?? order.rupyz_created_by_name ?? "—"}</div>
              {!order.salesman && <div className="text-2xs text-warn mt-1">Not linked to internal salesman</div>}
            </Card>
            <Card label="Delivery">
              <div className="text-sm">{order.delivery_address_line ?? "—"}</div>
              <div className="text-xs text-ink-muted">{order.delivery_city}, {order.delivery_state} {order.delivery_pincode}</div>
            </Card>
            <Card label="Payment">
              <div className="text-sm">
                {order.payment_option_check === "CREDIT_DAYS"
                  ? `Credit · ${order.remaining_payment_days ?? "?"} days`
                  : order.payment_option_check ?? "—"}
              </div>
              <div className="text-xs text-ink-muted">{order.payment_status}</div>
            </Card>
          </div>

          {/* Status panel */}
          <div className="bg-paper-subtle/60 border border-paper-line rounded p-3 mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <div className="text-2xs uppercase tracking-wide text-ink-subtle">App status</div>
                <Badge variant={statusBadgeVariant(order.app_status)} className="mt-1">{order.app_status.replace(/_/g, " ")}</Badge>
              </div>
              <div className="border-l border-paper-line pl-3">
                <div className="text-2xs uppercase tracking-wide text-ink-subtle">Rupyz status</div>
                <div className="text-sm font-medium mt-0.5">{order.rupyz_delivery_status}</div>
              </div>
              <div className="border-l border-paper-line pl-3">
                <div className="text-2xs uppercase tracking-wide text-ink-subtle">Tally</div>
                <div className="text-sm font-medium mt-0.5">{order.rupyz_tally_status}</div>
              </div>
            </div>
            {order.purchase_order_url && (
              <a
                href={order.purchase_order_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline inline-flex items-center gap-1"
              >
                Rupyz PO PDF <ExternalLink size={11} />
              </a>
            )}
          </div>

          {/* Line items */}
          <div className="border border-paper-line rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-paper-subtle/60 border-b border-paper-line">
                <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-1.5 font-medium">Product</th>
                  <th className="px-3 py-1.5 font-medium text-right">Qty</th>
                  <th className="px-3 py-1.5 font-medium text-right">Rate</th>
                  <th className="px-3 py-1.5 font-medium text-right">GST</th>
                  <th className="px-3 py-1.5 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {loading ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-ink-muted">Loading…</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-ink-muted">No line items.</td></tr>
                ) : (
                  items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{it.product_name}</div>
                        <div className="text-2xs text-ink-subtle font-mono">{it.product_code} · {it.brand}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular">{it.qty} {it.unit}</td>
                      <td className="px-3 py-2 text-right tabular">{formatINR(it.price)}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-muted">{it.gst_percent}%</td>
                      <td className="px-3 py-2 text-right tabular font-medium">{formatINR(it.total_price ?? 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="bg-paper-subtle/40 border-t border-paper-line">
                <tr>
                  <td colSpan={4} className="px-3 py-1.5 text-right text-xs text-ink-muted">Subtotal</td>
                  <td className="px-3 py-1.5 text-right tabular text-sm">{formatINR(order.amount)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-3 py-1.5 text-right text-xs text-ink-muted">
                    GST ({formatINR(order.cgst_amount)} CGST + {formatINR(order.sgst_amount)} SGST)
                  </td>
                  <td className="px-3 py-1.5 text-right tabular text-sm">{formatINR(order.gst_amount)}</td>
                </tr>
                {order.discount_amount > 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-1.5 text-right text-xs text-ink-muted">Discount</td>
                    <td className="px-3 py-1.5 text-right tabular text-sm">−{formatINR(order.discount_amount)}</td>
                  </tr>
                )}
                {order.round_off_amount !== 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-1.5 text-right text-xs text-ink-muted">Round-off</td>
                    <td className="px-3 py-1.5 text-right tabular text-sm">{formatINR(order.round_off_amount)}</td>
                  </tr>
                )}
                <tr className="border-t border-paper-line">
                  <td colSpan={4} className="px-3 py-2 text-right text-sm font-semibold">Grand total</td>
                  <td className="px-3 py-2 text-right tabular text-base font-bold">{formatINR(order.total_amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </SheetBody>
        <SheetFooter>
          <div className="text-xs text-ink-subtle mr-auto">
            Synced {new Date(order.last_synced_at).toLocaleString("en-IN")}
          </div>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button disabled title="Coming in Phase 3">Approve / Dispatch →</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-paper-line rounded p-3">
      <div className="text-2xs uppercase tracking-wide text-ink-subtle mb-1.5">{label}</div>
      {children}
    </div>
  );
}
