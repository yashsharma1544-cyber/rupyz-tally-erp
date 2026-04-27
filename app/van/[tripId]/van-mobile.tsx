"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Search, ArrowLeft, Plus, Trash2, AlertCircle, CheckCircle2, IndianRupee, Receipt, Package, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type {
  AppUser, VanTrip, Customer, Product, TripBill, VanTripKpis, CustomerOutstanding, TripLoadItem,
} from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";
import {
  confirmPreOrderBill, createSpotBill, createQuickCustomer,
} from "@/app/(app)/trips/bill-actions";
import { attachOrderToTrip } from "@/app/(app)/trips/actions";

type ProductLite = Pick<Product, "id" | "name" | "unit" | "base_price" | "mrp" | "gst_percent">;
type CustomerLite = Pick<Customer, "id" | "name" | "mobile" | "city">;
type StockRow = { productId: string; productName: string; productUnit: string; loaded: number; sold: number; remaining: number };

export function VanMobileBilling({
  trip, me, customers: initialCustomers, products,
}: {
  trip: VanTrip;
  me: AppUser;
  customers: CustomerLite[];
  products: ProductLite[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [bills, setBills] = useState<TripBill[]>([]);
  const [loadItems, setLoadItems] = useState<TripLoadItem[]>([]);
  const [outstanding, setOutstanding] = useState<Map<string, CustomerOutstanding>>(new Map());
  const [kpis, setKpis] = useState<VanTripKpis | null>(null);
  const [customers, setCustomers] = useState<CustomerLite[]>(initialCustomers);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"preorder" | "walkin">("preorder");
  const [activeView, setActiveView] = useState<"list" | "preorder" | "spot" | "newcustomer" | "stock" | "attachorder">("list");
  const [activeBillId, setActiveBillId] = useState<string | null>(null);
  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(null);

  async function reload() {
    const [{ data: bl }, { data: li }, { data: kp }, { data: out }] = await Promise.all([
      supabase.from("trip_bills")
        .select("*, customer:customers(id,name,mobile,city), items:trip_bill_items(*, product:products(id,name,unit,mrp))")
        .eq("trip_id", trip.id)
        .order("created_at", { ascending: false }),
      supabase.from("trip_load_items")
        .select("*, product:products(id,name,unit)")
        .eq("trip_id", trip.id),
      supabase.rpc("van_trip_kpis", { p_trip_id: trip.id }),
      supabase.from("customer_outstanding").select("*").gt("amount", 0),
    ]);
    setBills((bl ?? []) as unknown as TripBill[]);
    setLoadItems((li ?? []) as unknown as TripLoadItem[]);
    if (Array.isArray(kp) && kp[0]) setKpis(kp[0] as VanTripKpis);
    const m = new Map<string, CustomerOutstanding>();
    for (const o of (out ?? []) as CustomerOutstanding[]) m.set(o.customer_id, o);
    setOutstanding(m);
  }

  useEffect(() => {
    reload();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  // Set of customer IDs that have any pre_order bill on this trip (cancelled or not)
  const preOrderCustomerIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of bills) {
      if (b.bill_type === "pre_order" && !b.is_cancelled) s.add(b.customer_id);
    }
    return s;
  }, [bills]);

  // Map: customerId → undelivered pre-order bill (one customer can have one open pre-order bill per trip in our model)
  const preOrderByCustomer = useMemo(() => {
    const m = new Map<string, TripBill>();
    for (const b of bills) {
      if (b.bill_type === "pre_order" && !b.is_cancelled && !b.confirmed_at) {
        m.set(b.customer_id, b);
      }
    }
    return m;
  }, [bills]);

  const billedCustomerIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of bills) if (!b.is_cancelled && b.confirmed_at) s.add(b.customer_id);
    return s;
  }, [bills]);

  // Per-tab customer pools
  const preOrderCustomers = useMemo(
    () => customers.filter(c => preOrderCustomerIds.has(c.id)),
    [customers, preOrderCustomerIds],
  );
  const walkInCustomers = useMemo(
    () => customers.filter(c => !preOrderCustomerIds.has(c.id)),
    [customers, preOrderCustomerIds],
  );

  // Search within active tab
  const filteredCustomers = useMemo(() => {
    const pool = tab === "preorder" ? preOrderCustomers : walkInCustomers;
    const q = search.trim().toLowerCase();
    if (!q) return pool.slice(0, 50);
    return pool.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      (c.mobile && c.mobile.includes(q))
    ).slice(0, 50);
  }, [preOrderCustomers, walkInCustomers, tab, search]);

  // Counts for tab badges
  const preOrderPendingCount = preOrderByCustomer.size;
  const preOrderTotalCount = preOrderCustomerIds.size;

  // Per-product stock state — single source of truth for client-side display + validation
  const stockMap = useMemo(() => {
    const m = new Map<string, StockRow>();
    for (const li of loadItems) {
      const loaded = Number(li.qty_loaded ?? li.qty_planned);
      m.set(li.product_id, {
        productId: li.product_id,
        productName: li.product?.name ?? "—",
        productUnit: li.product?.unit ?? "",
        loaded,
        sold: 0,
        remaining: loaded,
      });
    }
    for (const b of bills) {
      if (b.is_cancelled) continue;
      for (const it of b.items ?? []) {
        const cur = m.get(it.product_id);
        if (cur) {
          cur.sold += Number(it.qty);
          cur.remaining = cur.loaded - cur.sold;
        }
      }
    }
    return m;
  }, [loadItems, bills]);

  const totalRemainingQty = useMemo(() => {
    let total = 0;
    for (const v of stockMap.values()) total += v.remaining;
    return total;
  }, [stockMap]);

  if (trip.status !== "in_progress") {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-4">
        <div className="bg-paper-card border border-paper-line rounded-lg p-6 max-w-sm text-center">
          <AlertCircle size={36} className="text-warn mx-auto mb-3" />
          <h1 className="text-base font-semibold mb-1">Trip not active</h1>
          <p className="text-sm text-ink-muted mb-4">
            Trip status is "{trip.status}". Mobile billing is only available while the trip is on route.
          </p>
          <Link href="/van" className="text-sm text-accent hover:underline">All trips</Link>
        </div>
      </div>
    );
  }

  // ============== VIEW ROUTING ==============

  if (activeView === "preorder" && activeBillId) {
    const bill = bills.find(b => b.id === activeBillId);
    if (!bill) { setActiveView("list"); return null; }
    return <PreOrderBillView bill={bill} products={products} outstanding={outstanding.get(bill.customer_id)} onBack={() => { setActiveView("list"); reload(); }} />;
  }
  if (activeView === "spot" && activeCustomerId) {
    const customer = customers.find(c => c.id === activeCustomerId);
    if (!customer) { setActiveView("list"); return null; }
    return <SpotBillView trip={trip} customer={customer} products={products} stockMap={stockMap} outstanding={outstanding.get(customer.id)} onBack={() => { setActiveView("list"); reload(); }} />;
  }
  if (activeView === "newcustomer") {
    return <NewCustomerView trip={trip} onCreated={(id) => {
      setCustomers([{ id, name: "(new)", mobile: "", city: null } as unknown as CustomerLite, ...customers]);
      setActiveCustomerId(id);
      setActiveView("spot");
    }} onBack={() => setActiveView("list")} />;
  }
  if (activeView === "stock") {
    return <StockView trip={trip} stockMap={stockMap} onBack={() => setActiveView("list")} />;
  }
  if (activeView === "attachorder") {
    return <AttachOrderView trip={trip} bills={bills} onBack={() => { setActiveView("list"); reload(); }} />;
  }

  // ============== LIST VIEW ==============
  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <Link href="/van" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> All trips
        </Link>
        <h1 className="text-lg font-bold flex items-center gap-2">
          {trip.trip_number}
          <Badge variant="accent">On Route</Badge>
        </h1>
        <p className="text-xs text-ink-muted">{trip.beat?.name} · {new Date(trip.trip_date).toLocaleDateString("en-IN")}</p>

        {/* Trip-so-far stats */}
        {kpis && (
          <div className="grid grid-cols-3 gap-2 my-3">
            <MiniStat icon={Receipt} label="Bills" value={`${kpis.bills_count}`} />
            <MiniStat icon={IndianRupee} label="Cash" value={formatINR(kpis.cash_bills_total + kpis.outstanding_collected)} />
            <button onClick={() => setActiveView("stock")} className="text-left">
              <MiniStat icon={Layers} label="Stock left ›" value={`${totalRemainingQty.toFixed(0)}`} />
            </button>
          </div>
        )}

        {/* Tab toggle */}
        <div className="grid grid-cols-2 gap-1 mb-3 bg-paper-subtle border border-paper-line rounded p-0.5">
          <button
            onClick={() => setTab("preorder")}
            className={`text-sm font-medium py-2 rounded transition-colors ${
              tab === "preorder" ? "bg-paper-card shadow-sm text-ink" : "text-ink-muted"
            }`}
          >
            Pre-orders
            <span className={`ml-1.5 text-2xs tabular ${tab === "preorder" ? "text-warn" : "text-ink-subtle"}`}>
              {preOrderPendingCount > 0 ? `${preOrderPendingCount}/${preOrderTotalCount}` : `${preOrderTotalCount}`}
            </span>
          </button>
          <button
            onClick={() => setTab("walkin")}
            className={`text-sm font-medium py-2 rounded transition-colors ${
              tab === "walkin" ? "bg-paper-card shadow-sm text-ink" : "text-ink-muted"
            }`}
          >
            Walk-ins
            <span className={`ml-1.5 text-2xs tabular ${tab === "walkin" ? "text-ink-muted" : "text-ink-subtle"}`}>
              {walkInCustomers.length}
            </span>
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "preorder" ? "Search pre-order customer…" : "Search customer or mobile…"}
            className="pl-8"
          />
        </div>

        {/* Add walk-in button — only on walk-in tab */}
        {tab === "walkin" && (
          <Button variant="outline" size="sm" className="w-full mb-3" onClick={() => setActiveView("newcustomer")}>
            <Plus size={11}/> Add new walk-in customer
          </Button>
        )}

        {/* Pull new order button — only on pre-order tab */}
        {tab === "preorder" && (
          <Button variant="outline" size="sm" className="w-full mb-3" onClick={() => setActiveView("attachorder")}>
            <Plus size={11}/> Pull new order from office
          </Button>
        )}

        {/* Customer list */}
        <div className={tab === "walkin" ? "divide-y divide-paper-line border border-paper-line rounded bg-paper-card" : "space-y-1.5"}>
          {filteredCustomers.map(c => {
            const preOrder = preOrderByCustomer.get(c.id);
            const billed = billedCustomerIds.has(c.id);
            const out = outstanding.get(c.id);
            const initial = c.name?.charAt(0).toUpperCase() ?? "?";

            // Walk-in customers: tight list-row layout, no card chrome.
            if (tab === "walkin") {
              return (
                <button
                  key={c.id}
                  onClick={() => { setActiveCustomerId(c.id); setActiveView("spot"); }}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2.5 ${billed ? "bg-ok-soft/30" : ""}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${billed ? "bg-ok text-paper-card" : "bg-paper-subtle text-ink-muted"}`}>
                    {billed ? <CheckCircle2 size={14}/> : initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{c.name}</div>
                    <div className="text-2xs text-ink-muted truncate">
                      {c.mobile ?? "—"}{c.city ? ` · ${c.city}` : ""}
                      {out && !billed && <span className="text-warn ml-1.5">· o/s {formatINR(out.amount)}</span>}
                    </div>
                  </div>
                  <span className="text-ink-subtle text-xs">›</span>
                </button>
              );
            }

            // Pre-order customers: rich card with badge + amount.
            return (
              <button
                key={c.id}
                onClick={() => {
                  if (preOrder) { setActiveBillId(preOrder.id); setActiveView("preorder"); }
                  else { setActiveCustomerId(c.id); setActiveView("spot"); }
                }}
                className={`w-full text-left bg-paper-card border rounded p-3 flex items-center justify-between ${billed ? "border-ok bg-ok-soft/30" : "border-paper-line"}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm truncate">{c.name}</span>
                    {billed && <CheckCircle2 size={12} className="text-ok shrink-0"/>}
                    {preOrder && !billed && <Badge variant="warn">Pre-order</Badge>}
                  </div>
                  <div className="text-2xs text-ink-muted">{c.mobile} · {c.city}</div>
                  {out && !billed && (
                    <div className="text-2xs text-warn">Old o/s: {formatINR(out.amount)}</div>
                  )}
                </div>
                <div className="text-right">
                  {preOrder && !billed && (
                    <div className="text-xs tabular font-medium">{formatINR(preOrder.total_amount)}</div>
                  )}
                </div>
              </button>
            );
          })}
          {filteredCustomers.length === 0 && (
            <div className="text-center text-sm text-ink-muted py-8">
              {search ? `No customers match "${search}"` :
                tab === "preorder"
                  ? (preOrderTotalCount === 0 ? "No pre-orders for this trip." : "All pre-orders billed ✓")
                  : "No walk-in customers in this beat."
              }
            </div>
          )}
        </div>
      </div>

      <div className="text-2xs text-center text-ink-subtle py-3">
        {me.full_name} · {bills.length} bill{bills.length !== 1 ? "s" : ""} captured
      </div>
    </div>
  );
}

// ===========================================================================
// PRE-ORDER BILL VIEW (deliver an existing pre-order)
// ===========================================================================
function PreOrderBillView({ bill, products, outstanding, onBack }: { bill: TripBill; products: ProductLite[]; outstanding?: CustomerOutstanding; onBack: () => void }) {
  const [paymentMode, setPaymentMode] = useState<"cash" | "credit">(bill.payment_mode);
  const [outCollected, setOutCollected] = useState<string>("");
  const [paperBillNo, setPaperBillNo] = useState<string>(bill.paper_bill_no ?? "");
  const [notes, setNotes] = useState<string>(bill.notes ?? "");
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    if (!paperBillNo.trim()) {
      if (!confirm("No paper bill number entered. Continue anyway?")) return;
    }
    const out = parseFloat(outCollected || "0");
    if (out < 0) { toast.error("Outstanding can't be negative"); return; }
    startTransition(async () => {
      const res = await confirmPreOrderBill({
        billId: bill.id,
        paymentMode,
        outstandingCollected: out,
        paperBillNo: paperBillNo.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (res.error) toast.error(res.error);
      else { toast.success(`Bill ${bill.bill_number} confirmed`); onBack(); }
    });
  }

  void products;

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <button onClick={onBack} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> Back
        </button>
        <h1 className="text-base font-semibold">{bill.customer?.name}</h1>
        <p className="text-xs text-ink-muted mb-3">{bill.customer?.mobile} · {bill.customer?.city}</p>

        <div className="bg-paper-card border border-paper-line rounded p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xs uppercase text-ink-muted">Pre-order bill</span>
            <span className="font-mono text-2xs">{bill.bill_number}</span>
          </div>
          {bill.items?.map(it => (
            <div key={it.id} className="py-2 border-b border-paper-line last:border-b-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-base flex-1 min-w-0">{it.product?.name ?? "—"}</span>
                <span className="font-bold text-base tabular whitespace-nowrap">
                  {Number(it.qty).toFixed(0)}
                  {it.product?.unit ? <span className="text-sm font-normal text-ink-muted ml-1">{it.product.unit}</span> : null}
                </span>
              </div>
              <div className="flex items-baseline justify-between text-2xs text-ink-muted mt-0.5">
                <span>@ {formatINR(it.rate)}</span>
                <span className="tabular">{formatINR(it.amount)}</span>
              </div>
            </div>
          ))}
          <div className="border-t border-paper-line mt-2 pt-2 flex justify-between font-semibold">
            <span>Total</span>
            <span className="tabular">{formatINR(bill.total_amount)}</span>
          </div>
        </div>

        {outstanding && (
          <div className="bg-warn-soft border border-warn/30 rounded p-2.5 mb-3 text-xs">
            <div className="font-medium text-warn">Old outstanding: {formatINR(outstanding.amount)}</div>
            <div className="text-2xs text-ink-muted mt-0.5">Last updated: {new Date(outstanding.imported_at).toLocaleDateString("en-IN")}</div>
          </div>
        )}

        <Label className="block mb-1.5">How did they pay?</Label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={() => setPaymentMode("cash")} className={`p-3 rounded border-2 ${paymentMode === "cash" ? "border-ok bg-ok-soft" : "border-paper-line bg-paper-card"}`}>
            <div className="font-semibold">Cash</div>
            <div className="text-2xs text-ink-muted">Paid in full now</div>
          </button>
          <button onClick={() => setPaymentMode("credit")} className={`p-3 rounded border-2 ${paymentMode === "credit" ? "border-warn bg-warn-soft" : "border-paper-line bg-paper-card"}`}>
            <div className="font-semibold">Credit</div>
            <div className="text-2xs text-ink-muted">Pay later</div>
          </button>
        </div>

        <Label className="block mb-1">Old outstanding collected (optional)</Label>
        <Input
          type="number" step="0.01" inputMode="decimal"
          value={outCollected}
          onChange={(e) => setOutCollected(e.target.value)}
          placeholder="₹"
          className="tabular mb-3"
        />

        <Label className="block mb-1">Paper bill # (kachi parchi)</Label>
        <Input value={paperBillNo} onChange={(e) => setPaperBillNo(e.target.value)} placeholder="VR/241" className="mb-3" />

        <Label className="block mb-1">Notes (optional)</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mb-3" />

        <Button className="w-full" size="lg" onClick={handleConfirm} disabled={pending}>
          {pending ? "Saving…" : "Confirm Bill & Delivery"}
        </Button>
      </div>
    </div>
  );
}

// ===========================================================================
// SPOT BILL VIEW (no pre-order — fresh bill)
// ===========================================================================
function SpotBillView({ trip, customer, products, stockMap, outstanding, onBack }: {
  trip: VanTrip; customer: CustomerLite; products: ProductLite[];
  stockMap: Map<string, StockRow>; outstanding?: CustomerOutstanding; onBack: () => void;
}) {
  const [items, setItems] = useState<{ tempId: string; productId: string; qty: number; rate: number }[]>([
    { tempId: crypto.randomUUID(), productId: "", qty: 0, rate: 0 },
  ]);
  const [paymentMode, setPaymentMode] = useState<"cash" | "credit">("cash");
  const [outCollected, setOutCollected] = useState<string>("");
  const [paperBillNo, setPaperBillNo] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [pending, startTransition] = useTransition();

  // Only show products that are actually on the truck and have remaining stock
  const loadedProducts = products.filter(p => {
    const s = stockMap.get(p.id);
    return s && s.remaining > 0;
  });

  // For each line, compute how much is still available (subtracting what THIS bill draft uses)
  function remainingForLine(currentTempId: string, productId: string): number {
    const stock = stockMap.get(productId);
    if (!stock) return 0;
    const usedByOtherLines = items
      .filter(it => it.tempId !== currentTempId && it.productId === productId)
      .reduce((s, it) => s + (it.qty || 0), 0);
    return Math.max(0, stock.remaining - usedByOtherLines);
  }

  function addLine() {
    setItems([...items, { tempId: crypto.randomUUID(), productId: "", qty: 0, rate: 0 }]);
  }
  function patch(tempId: string, p: Partial<{ productId: string; qty: number; rate: number }>) {
    setItems(items.map(it => it.tempId === tempId ? { ...it, ...p } : it));
  }
  function remove(tempId: string) {
    setItems(items.filter(it => it.tempId !== tempId));
  }

  const subtotal = items.reduce((s, it) => s + it.qty * it.rate, 0);

  function handleSave() {
    const valid = items.filter(it => it.productId && it.qty > 0);
    if (!valid.length) { toast.error("Add at least one item"); return; }

    // Client-side stock guard (server enforces too)
    const totals = new Map<string, number>();
    for (const it of valid) totals.set(it.productId, (totals.get(it.productId) ?? 0) + it.qty);
    for (const [pid, qty] of totals.entries()) {
      const stock = stockMap.get(pid);
      if (!stock) {
        toast.error(`Product not loaded on truck`); return;
      }
      if (qty > stock.remaining + 0.0001) {
        toast.error(`Not enough ${stock.productName} — only ${stock.remaining.toFixed(0)} left`); return;
      }
    }

    if (!paperBillNo.trim()) {
      if (!confirm("No paper bill number entered. Continue?")) return;
    }
    const out = parseFloat(outCollected || "0");
    startTransition(async () => {
      const res = await createSpotBill({
        tripId: trip.id,
        customerId: customer.id,
        paymentMode,
        outstandingCollected: out,
        paperBillNo: paperBillNo.trim() || undefined,
        notes: notes.trim() || undefined,
        items: valid.map(it => ({ productId: it.productId, qty: it.qty, rate: it.rate })),
      });
      if (res.error) toast.error(res.error);
      else { toast.success(`Bill ${res.billNumber} saved`); onBack(); }
    });
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <button onClick={onBack} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> Back
        </button>
        <h1 className="text-base font-semibold">{customer.name}</h1>
        <p className="text-xs text-ink-muted mb-3">{customer.mobile} · {customer.city} · <span className="text-accent">spot bill</span></p>

        {outstanding && (
          <div className="bg-warn-soft border border-warn/30 rounded p-2.5 mb-3 text-xs">
            <div className="font-medium text-warn">Old outstanding: {formatINR(outstanding.amount)}</div>
          </div>
        )}

        {/* Items */}
        <div className="bg-paper-card border border-paper-line rounded p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xs uppercase text-ink-muted">Items</span>
            <Button size="sm" variant="ghost" onClick={addLine}><Plus size={11}/> Add</Button>
          </div>
          {items.map((it) => {
            const prod = products.find(p => p.id === it.productId);
            const lineRemaining = it.productId ? remainingForLine(it.tempId, it.productId) : 0;
            const overStock = it.productId && it.qty > lineRemaining + 0.0001;
            return (
              <div key={it.tempId} className="border-b border-paper-line last:border-b-0 py-2 space-y-1.5">
                <Select value={it.productId} onValueChange={(v) => {
                  const p = products.find(pr => pr.id === v);
                  patch(it.tempId, { productId: v, rate: it.rate || (p ? Number(p.base_price) : 0) });
                }}>
                  <SelectTrigger><SelectValue placeholder="Pick product…" /></SelectTrigger>
                  <SelectContent>
                    {loadedProducts.map(p => {
                      const s = stockMap.get(p.id);
                      return (
                        <SelectItem key={p.id} value={p.id}>
                          <span>{p.name}</span>
                          {s && <span className="text-2xs text-ink-muted ml-2">· {s.remaining.toFixed(0)} left</span>}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-3 gap-1.5 items-center">
                  <Input
                    type="number" step="0.001" inputMode="decimal" placeholder="Qty"
                    value={it.qty || ""}
                    onChange={(e) => patch(it.tempId, { qty: parseFloat(e.target.value) || 0 })}
                    className={`text-right tabular ${overStock ? "border-danger text-danger" : ""}`}
                  />
                  <Input type="number" step="0.01" inputMode="decimal" placeholder="Rate" value={it.rate || ""} onChange={(e) => patch(it.tempId, { rate: parseFloat(e.target.value) || 0 })} className="text-right tabular" />
                  <div className="flex items-center justify-between">
                    <span className="text-xs tabular text-ink-muted">{formatINR(it.qty * it.rate)}</span>
                    <button onClick={() => remove(it.tempId)} className="text-ink-muted hover:text-danger"><Trash2 size={13}/></button>
                  </div>
                </div>
                {prod && (
                  <div className="text-2xs flex justify-between">
                    <span className="text-ink-subtle">{prod.unit} · MRP {formatINR(prod.mrp ?? 0)}</span>
                    <span className={overStock ? "text-danger font-medium" : "text-ink-muted"}>
                      {overStock ? `Only ${lineRemaining.toFixed(0)} on truck!` : `${lineRemaining.toFixed(0)} on truck`}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
          {loadedProducts.length === 0 && items.every(it => !it.productId) && (
            <div className="text-2xs text-warn italic py-2">No stock left on the truck — head back to office.</div>
          )}
          <div className="border-t border-paper-line mt-2 pt-2 flex justify-between font-semibold">
            <span>Total</span><span className="tabular">{formatINR(subtotal)}</span>
          </div>
        </div>

        <Label className="block mb-1.5">Payment</Label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={() => setPaymentMode("cash")} className={`p-3 rounded border-2 ${paymentMode === "cash" ? "border-ok bg-ok-soft" : "border-paper-line bg-paper-card"}`}>
            <div className="font-semibold">Cash</div>
          </button>
          <button onClick={() => setPaymentMode("credit")} className={`p-3 rounded border-2 ${paymentMode === "credit" ? "border-warn bg-warn-soft" : "border-paper-line bg-paper-card"}`}>
            <div className="font-semibold">Credit</div>
          </button>
        </div>

        <Label className="block mb-1">Old o/s collected</Label>
        <Input type="number" step="0.01" inputMode="decimal" value={outCollected} onChange={(e) => setOutCollected(e.target.value)} className="tabular mb-3" />

        <Label className="block mb-1">Paper bill #</Label>
        <Input value={paperBillNo} onChange={(e) => setPaperBillNo(e.target.value)} placeholder="VR/242" className="mb-3" />

        <Label className="block mb-1">Notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mb-3" />

        <Button className="w-full" size="lg" onClick={handleSave} disabled={pending}>
          {pending ? "Saving…" : "Save Bill"}
        </Button>
      </div>
    </div>
  );
}

// ===========================================================================
// NEW CUSTOMER VIEW (walk-in)
// ===========================================================================
function NewCustomerView({ trip, onCreated, onBack }: { trip: VanTrip; onCreated: (id: string) => void; onBack: () => void }) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    if (name.trim().length < 2) { toast.error("Name required"); return; }
    if (mobile.replace(/\D/g, "").length < 10) { toast.error("10-digit mobile required"); return; }
    startTransition(async () => {
      const res = await createQuickCustomer({ name: name.trim(), mobile: mobile.trim(), beatId: trip.beat_id });
      if (res.error) toast.error(res.error);
      else {
        if (res.existing) toast.success(`Existing customer found: ${res.name}`);
        else toast.success("Customer created");
        if (res.customerId) onCreated(res.customerId);
      }
    });
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <button onClick={onBack} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
          <ArrowLeft size={11}/> Back
        </button>
        <h1 className="text-base font-semibold mb-1">New walk-in customer</h1>
        <p className="text-xs text-ink-muted mb-4">Will be added to {trip.beat?.name} beat. You can edit later in Customers.</p>

        <Label className="block mb-1">Shop / Customer name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sharma Kirana" className="mb-3" />

        <Label className="block mb-1">Mobile (10 digits)</Label>
        <Input type="tel" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="98xxxxxxxx" className="tabular mb-4" />

        <Button className="w-full" size="lg" onClick={handleCreate} disabled={pending}>
          {pending ? "Saving…" : "Create & start bill"}
        </Button>
      </div>
    </div>
  );
}

// ===========================================================================
// STOCK VIEW (live inventory: loaded / sold / remaining per SKU)
// ===========================================================================
function StockView({ trip, stockMap, onBack }: {
  trip: VanTrip;
  stockMap: Map<string, StockRow>;
  onBack: () => void;
}) {
  const rows = Array.from(stockMap.values()).sort((a, b) => a.productName.localeCompare(b.productName));
  const totalLoaded = rows.reduce((s, r) => s + r.loaded, 0);
  const totalSold = rows.reduce((s, r) => s + r.sold, 0);
  const totalRemaining = rows.reduce((s, r) => s + r.remaining, 0);

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <button onClick={onBack} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> Back
        </button>
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Layers size={16}/> Stock on truck
        </h1>
        <p className="text-xs text-ink-muted mb-3">{trip.trip_number} · {trip.beat?.name}</p>

        {/* Roll-up */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <MiniStat icon={Package} label="Loaded" value={totalLoaded.toFixed(0)} />
          <MiniStat icon={Receipt} label="Sold" value={totalSold.toFixed(0)} />
          <MiniStat icon={Layers} label="Remaining" value={totalRemaining.toFixed(0)} />
        </div>

        {/* Per-SKU breakdown */}
        <div className="bg-paper-card border border-paper-line rounded divide-y divide-paper-line">
          {rows.length === 0 ? (
            <div className="text-center text-sm text-ink-muted py-8">No stock loaded.</div>
          ) : rows.map(r => {
            const pct = r.loaded > 0 ? (r.sold / r.loaded) * 100 : 0;
            const empty = r.remaining <= 0;
            const low = !empty && pct >= 80;
            return (
              <div key={r.productId} className="px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="font-semibold text-sm flex-1 min-w-0 truncate">{r.productName}</span>
                  <span className={`tabular text-base font-bold ${empty ? "text-danger" : low ? "text-warn" : "text-ink"}`}>
                    {r.remaining.toFixed(0)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-2xs text-ink-muted">
                  <span>{r.productUnit}</span>
                  <span>Loaded {r.loaded.toFixed(0)} · Sold {r.sold.toFixed(0)}</span>
                </div>
                {/* Progress bar */}
                <div className="h-1 bg-paper-subtle rounded-full mt-1.5 overflow-hidden">
                  <div
                    className={`h-full ${empty ? "bg-danger" : low ? "bg-warn" : "bg-accent"}`}
                    style={{ width: `${Math.min(100, pct).toFixed(0)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-2xs text-center text-ink-subtle pt-3">
          Updated live as bills are saved.
        </p>
      </div>
    </div>
  );
}

// ===========================================================================
// ATTACH ORDER VIEW (pull a new approved order onto the active trip)
// ===========================================================================
function AttachOrderView({
  trip, bills, onBack,
}: { trip: VanTrip; bills: TripBill[]; onBack: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [orders, setOrders] = useState<Array<{
    id: string;
    rupyz_order_id: string;
    total_amount: number;
    rupyz_created_at: string;
    customer: { id: string; name: string; mobile: string | null } | null;
    items_count: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Customers in this trip's beat
      const { data: cs } = await supabase.from("customers").select("id").eq("beat_id", trip.beat_id).eq("active", true);
      const customerIds = (cs ?? []).map((c: { id: string }) => c.id);
      if (!customerIds.length) { if (!cancelled) { setOrders([]); setLoading(false); } return; }

      // Approved/partially_dispatched orders (last 14 days to limit window)
      const since = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
      const { data: ords } = await supabase
        .from("orders")
        .select("id, rupyz_order_id, total_amount, rupyz_created_at, customer:customers(id,name,mobile), items:order_items(id)")
        .in("customer_id", customerIds)
        .in("app_status", ["approved", "partially_dispatched"])
        .gte("rupyz_created_at", since)
        .order("rupyz_created_at", { ascending: false });

      // Filter out orders already on a non-cancelled bill (this trip OR any other)
      const orderIds = ((ords ?? []) as { id: string }[]).map(o => o.id);
      let onTrip = new Set<string>();
      if (orderIds.length) {
        const { data: existing } = await supabase
          .from("trip_bills")
          .select("source_order_id")
          .in("source_order_id", orderIds)
          .eq("is_cancelled", false);
        onTrip = new Set(((existing ?? []) as { source_order_id: string }[]).map(x => x.source_order_id));
      }

      type RawOrder = {
        id: string; rupyz_order_id: string; total_amount: number; rupyz_created_at: string;
        customer: { id: string; name: string; mobile: string | null } | { id: string; name: string; mobile: string | null }[] | null;
        items: { id: string }[];
      };
      const filtered = ((ords ?? []) as RawOrder[])
        .filter(o => !onTrip.has(o.id))
        .map(o => ({
          id: o.id,
          rupyz_order_id: o.rupyz_order_id,
          total_amount: Number(o.total_amount),
          rupyz_created_at: o.rupyz_created_at,
          customer: Array.isArray(o.customer) ? (o.customer[0] ?? null) : o.customer,
          items_count: (o.items ?? []).length,
        }));

      if (!cancelled) { setOrders(filtered); setLoading(false); }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.beat_id, trip.id]);

  // Re-filter on every render in case bills updated mid-screen
  const visibleOrders = useMemo(() => {
    const onTrip = new Set(bills.filter(b => !b.is_cancelled && b.source_order_id).map(b => b.source_order_id as string));
    return orders.filter(o => !onTrip.has(o.id));
  }, [orders, bills]);

  function handleAttach(orderId: string) {
    startTransition(async () => {
      const res = await attachOrderToTrip({ orderId, tripId: trip.id });
      if (res.error) { toast.error(res.error); return; }
      const warns = res.stockWarnings ?? [];
      if (warns.length === 0) {
        toast.success(`Added as ${res.billNumber}`);
      } else {
        const sample = warns.slice(0, 2).map(w => `${w.productName} short by ${(w.qtyNeeded - w.qtyRemaining).toFixed(0)}`).join("; ");
        const more = warns.length > 2 ? ` (+${warns.length - 2} more)` : "";
        toast.warning(`Added, but stock low: ${sample}${more}`, { duration: 8000 });
      }
      setConfirmingOrderId(null);
      onBack();
    });
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <button onClick={onBack} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> Back
        </button>
        <h1 className="text-lg font-bold">Pull new order</h1>
        <p className="text-xs text-ink-muted mb-3">
          Approved orders for {trip.beat?.name} that aren&apos;t on a trip yet.
        </p>

        {loading ? (
          <div className="text-sm text-ink-muted py-8 text-center">Loading orders…</div>
        ) : visibleOrders.length === 0 ? (
          <div className="text-center text-sm text-ink-muted py-8">
            No new orders for this beat.
            <div className="text-2xs text-ink-subtle mt-2">
              Office will need to approve orders in Rupyz first, and they&apos;ll show up here.
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {visibleOrders.map(o => (
              <button
                key={o.id}
                onClick={() => setConfirmingOrderId(o.id)}
                className="w-full text-left bg-paper-card border border-paper-line rounded p-3"
              >
                <div className="flex items-baseline justify-between gap-2 mb-0.5">
                  <span className="font-semibold text-sm flex-1 min-w-0 truncate">{o.customer?.name ?? "—"}</span>
                  <span className="tabular text-sm font-bold whitespace-nowrap">{formatINR(o.total_amount)}</span>
                </div>
                <div className="flex items-baseline justify-between text-2xs text-ink-muted">
                  <span className="font-mono">{o.rupyz_order_id}</span>
                  <span>{o.items_count} item{o.items_count !== 1 ? "s" : ""} · {new Date(o.rupyz_created_at).toLocaleDateString("en-IN")}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Confirmation overlay */}
        {confirmingOrderId && (() => {
          const o = visibleOrders.find(x => x.id === confirmingOrderId);
          if (!o) return null;
          return (
            <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center z-50 p-3">
              <div className="bg-paper-card border border-paper-line rounded-lg p-4 max-w-sm w-full">
                <h2 className="font-semibold text-base mb-1">Add to this trip?</h2>
                <p className="text-xs text-ink-muted mb-3">
                  <span className="font-medium text-ink">{o.customer?.name}</span>
                  {" — "}
                  <span className="font-mono">{o.rupyz_order_id}</span>
                  {" · "}{formatINR(o.total_amount)}
                </p>
                <p className="text-2xs text-warn mb-4">
                  If stock on the truck is short for any item, you&apos;ll see a warning. The bill won&apos;t save until you have enough on the truck.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setConfirmingOrderId(null)} disabled={pending}>
                    Cancel
                  </Button>
                  <Button className="flex-1" onClick={() => handleAttach(o.id)} disabled={pending}>
                    {pending ? "Adding…" : "Add to trip"}
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: typeof Search; label: string; value: string }) {
  return (
    <div className="bg-paper-card border border-paper-line rounded p-2 text-center">
      <Icon size={11} className="text-ink-muted mx-auto mb-0.5" />
      <div className="text-sm font-bold tabular">{value}</div>
      <div className="text-2xs text-ink-muted">{label}</div>
    </div>
  );
}
