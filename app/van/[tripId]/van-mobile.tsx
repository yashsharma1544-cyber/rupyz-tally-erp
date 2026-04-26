"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Search, ArrowLeft, Plus, Trash2, AlertCircle, CheckCircle2, IndianRupee, Receipt, Package,
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
  AppUser, VanTrip, Customer, Product, TripBill, VanTripKpis, CustomerOutstanding,
} from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";
import {
  confirmPreOrderBill, createSpotBill, createQuickCustomer,
} from "@/app/(app)/trips/bill-actions";

type ProductLite = Pick<Product, "id" | "name" | "unit" | "base_price" | "mrp" | "gst_percent">;
type CustomerLite = Pick<Customer, "id" | "name" | "mobile" | "city">;

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
  const [outstanding, setOutstanding] = useState<Map<string, CustomerOutstanding>>(new Map());
  const [kpis, setKpis] = useState<VanTripKpis | null>(null);
  const [customers, setCustomers] = useState<CustomerLite[]>(initialCustomers);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"preorder" | "walkin">("preorder");
  const [activeView, setActiveView] = useState<"list" | "preorder" | "spot" | "newcustomer">("list");
  const [activeBillId, setActiveBillId] = useState<string | null>(null);
  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(null);

  async function reload() {
    const [{ data: bl }, { data: kp }, { data: out }] = await Promise.all([
      supabase.from("trip_bills")
        .select("*, customer:customers(id,name,mobile,city), items:trip_bill_items(*, product:products(id,name,unit,mrp))")
        .eq("trip_id", trip.id)
        .order("created_at", { ascending: false }),
      supabase.rpc("van_trip_kpis", { p_trip_id: trip.id }),
      supabase.from("customer_outstanding").select("*").gt("amount", 0),
    ]);
    setBills((bl ?? []) as unknown as TripBill[]);
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

  if (trip.status !== "in_progress") {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-4">
        <div className="bg-paper-card border border-paper-line rounded-lg p-6 max-w-sm text-center">
          <AlertCircle size={36} className="text-warn mx-auto mb-3" />
          <h1 className="text-base font-semibold mb-1">Trip not active</h1>
          <p className="text-sm text-ink-muted mb-4">
            Trip status is "{trip.status}". Mobile billing is only available while the trip is on route.
          </p>
          <Link href={`/trips/${trip.id}`} className="text-sm text-accent hover:underline">View trip</Link>
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
    return <SpotBillView trip={trip} customer={customer} products={products} outstanding={outstanding.get(customer.id)} onBack={() => { setActiveView("list"); reload(); }} />;
  }
  if (activeView === "newcustomer") {
    return <NewCustomerView trip={trip} onCreated={(id) => {
      setCustomers([{ id, name: "(new)", mobile: "", city: null } as unknown as CustomerLite, ...customers]);
      setActiveCustomerId(id);
      setActiveView("spot");
    }} onBack={() => setActiveView("list")} />;
  }

  // ============== LIST VIEW ==============
  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <Link href={`/trips/${trip.id}`} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> Trip detail
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
            <MiniStat icon={Package} label="Stock left" value={`${kpis.total_kg_remaining.toFixed(0)}`} />
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

        {/* Customer list */}
        <div className="space-y-1.5">
          {filteredCustomers.map(c => {
            const preOrder = preOrderByCustomer.get(c.id);
            const billed = billedCustomerIds.has(c.id);
            const out = outstanding.get(c.id);
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
            <div key={it.id} className="flex items-start gap-2 text-sm py-1 border-b border-paper-line last:border-b-0">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{it.product?.name ?? "—"}</div>
                <div className="text-2xs text-ink-muted tabular">
                  {it.qty} {it.product?.unit ? `× ${it.product.unit}` : ""} @ {formatINR(it.rate)}
                </div>
              </div>
              <div className="tabular text-right whitespace-nowrap font-medium">{formatINR(it.amount)}</div>
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
function SpotBillView({ trip, customer, products, outstanding, onBack }: { trip: VanTrip; customer: CustomerLite; products: ProductLite[]; outstanding?: CustomerOutstanding; onBack: () => void }) {
  const [items, setItems] = useState<{ tempId: string; productId: string; qty: number; rate: number }[]>([
    { tempId: crypto.randomUUID(), productId: "", qty: 0, rate: 0 },
  ]);
  const [paymentMode, setPaymentMode] = useState<"cash" | "credit">("cash");
  const [outCollected, setOutCollected] = useState<string>("");
  const [paperBillNo, setPaperBillNo] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [pending, startTransition] = useTransition();

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
            return (
              <div key={it.tempId} className="border-b border-paper-line last:border-b-0 py-2 space-y-1.5">
                <Select value={it.productId} onValueChange={(v) => {
                  const p = products.find(pr => pr.id === v);
                  patch(it.tempId, { productId: v, rate: it.rate || (p ? Number(p.base_price) : 0) });
                }}>
                  <SelectTrigger><SelectValue placeholder="Pick product…" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-3 gap-1.5 items-center">
                  <Input type="number" step="0.001" inputMode="decimal" placeholder="Qty" value={it.qty || ""} onChange={(e) => patch(it.tempId, { qty: parseFloat(e.target.value) || 0 })} className="text-right tabular" />
                  <Input type="number" step="0.01" inputMode="decimal" placeholder="Rate" value={it.rate || ""} onChange={(e) => patch(it.tempId, { rate: parseFloat(e.target.value) || 0 })} className="text-right tabular" />
                  <div className="flex items-center justify-between">
                    <span className="text-xs tabular text-ink-muted">{formatINR(it.qty * it.rate)}</span>
                    <button onClick={() => remove(it.tempId)} className="text-ink-muted hover:text-danger"><Trash2 size={13}/></button>
                  </div>
                </div>
                {prod && <div className="text-2xs text-ink-subtle">{prod.unit} · MRP {formatINR(prod.mrp ?? 0)}</div>}
              </div>
            );
          })}
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

function MiniStat({ icon: Icon, label, value }: { icon: typeof Search; label: string; value: string }) {
  return (
    <div className="bg-paper-card border border-paper-line rounded p-2 text-center">
      <Icon size={11} className="text-ink-muted mx-auto mb-0.5" />
      <div className="text-sm font-bold tabular">{value}</div>
      <div className="text-2xs text-ink-muted">{label}</div>
    </div>
  );
}
