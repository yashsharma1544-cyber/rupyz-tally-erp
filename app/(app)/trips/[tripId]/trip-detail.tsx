"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Truck, MapPin, Printer, FileCheck2, AlertCircle, CheckCircle2,
  Smartphone, Ban, ArrowLeft, IndianRupee, Package, Receipt, Plus, Trash2, Save,
  Pencil, X, Eye, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody,
} from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import type {
  AppUser, VanTrip, VanTripStatus, TripLoadItem, TripBill, VanTripKpis, Product,
} from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";
import {
  markTripLoaded, markTripReturned, reconcileTrip, cancelTrip, saveTripPlan, updateTripMetadata,
  type ReconcileInput,
} from "../actions";

type ProductLite = Pick<Product, "id" | "name" | "unit" | "base_price" | "mrp" | "gst_percent">;

function statusBadge(s: VanTripStatus): { variant: "neutral" | "ok" | "warn" | "danger" | "accent"; label: string } {
  return {
    planning:    { variant: "warn"   as const, label: "Planning" },
    loading:     { variant: "warn"   as const, label: "Loading" },
    in_progress: { variant: "accent" as const, label: "On Route" },
    returned:    { variant: "warn"   as const, label: "Awaiting Reconcile" },
    reconciled:  { variant: "ok"     as const, label: "Reconciled" },
    cancelled:   { variant: "danger" as const, label: "Cancelled" },
  }[s];
}

export function TripDetail({
  tripId, initialTrip, me, products, vanLeads,
}: {
  tripId: string;
  initialTrip: VanTrip;
  me: AppUser;
  products: ProductLite[];
  vanLeads: Pick<AppUser, "id" | "full_name">[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [trip, setTrip] = useState<VanTrip>(initialTrip);
  const [loadItems, setLoadItems] = useState<TripLoadItem[]>([]);
  const [bills, setBills] = useState<TripBill[]>([]);
  const [kpis, setKpis] = useState<VanTripKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  // Trip metadata edit state
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaForm, setMetaForm] = useState({
    tripDate: trip.trip_date,
    vehicleType: trip.vehicle_type,
    vehicleNumber: trip.vehicle_number ?? "",
    vehicleProvidedBy: trip.vehicle_provided_by ?? "",
    leadId: trip.lead_id,
    helpersText: trip.helpers.join(", "),
    notes: trip.notes ?? "",
  });

  // Editable forms (loading + reconcile)
  // bufferQtys: productId → buffer qty (the user's working copy during planning/loading)
  const [bufferQtys, setBufferQtys] = useState<Map<string, number>>(new Map());
  // Extra rows added by user during the session (buffer-only, not yet saved)
  const [extraBufferProducts, setExtraBufferProducts] = useState<string[]>([]);
  const [pickProductOpen, setPickProductOpen] = useState(false);
  const [pickProductId, setPickProductId] = useState<string>("");

  const [loadedQtys, setLoadedQtys] = useState<Map<string, number>>(new Map());
  const [returnedQtys, setReturnedQtys] = useState<Map<string, number>>(new Map());
  const [actualCash, setActualCash] = useState<string>("");
  const [reconcileNotes, setReconcileNotes] = useState("");

  const canManage = ["admin", "van_lead"].includes(me.role);
  const canCancel = me.role === "admin";
  const canEditMeta = me.role === "admin" && trip.status !== "cancelled";

  // Plan-edit mode (admin only): unlocks the loading sheet during in_progress
  const [editPlanMode, setEditPlanMode] = useState(false);
  const canEditPlanInProgress = me.role === "admin" && trip.status === "in_progress";
  const showLoadingSheet =
    trip.status === "planning" || trip.status === "loading" ||
    (canEditPlanInProgress && editPlanMode);
  const isInProgressEdit = trip.status === "in_progress" && editPlanMode;

  // View-bill drawer state (read-only)
  const [viewingBillId, setViewingBillId] = useState<string | null>(null);
  const viewingBill = useMemo(
    () => bills.find(b => b.id === viewingBillId) ?? null,
    [bills, viewingBillId],
  );

  async function reload() {
    const [{ data: t }, { data: li }, { data: bl }, { data: kp }] = await Promise.all([
      supabase.from("van_trips").select("*, beat:beats(id,name), lead:app_users!van_trips_lead_id_fkey(id,full_name)").eq("id", tripId).single(),
      supabase.from("trip_load_items").select("*, product:products(id,name,unit)").eq("trip_id", tripId).order("created_at"),
      supabase.from("trip_bills").select("*, customer:customers(id,name,mobile,city), source_order:orders!trip_bills_source_order_id_fkey(id,rupyz_order_id,app_status), items:trip_bill_items(*, product:products(id,name,unit,mrp))").eq("trip_id", tripId).order("created_at"),
      supabase.rpc("van_trip_kpis", { p_trip_id: tripId }),
    ]);
    if (t) setTrip(t as unknown as VanTrip);
    setLoadItems((li ?? []) as unknown as TripLoadItem[]);
    setBills((bl ?? []) as unknown as TripBill[]);
    if (Array.isArray(kp) && kp[0]) setKpis(kp[0] as VanTripKpis);
  }

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  // Keep a stable ref to reload() so polling effects don't re-create on every render
  const reloadRef = useRef<() => Promise<void>>();
  useEffect(() => { reloadRef.current = reload; });

  // Live updates: while the trip is on route, poll every 15s + refresh on tab focus
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (trip.status !== "in_progress") return;

    const POLL_MS = 15_000;

    function maybeReload() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      reloadRef.current?.().then(() => setLastSyncedAt(new Date())).catch(() => {});
    }

    const interval = setInterval(maybeReload, POLL_MS);
    window.addEventListener("focus", maybeReload);
    document.addEventListener("visibilitychange", maybeReload);
    // Initial sync timestamp
    setLastSyncedAt(new Date());

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", maybeReload);
      document.removeEventListener("visibilitychange", maybeReload);
    };
  }, [trip.status]);

  useEffect(() => {
    // Pre-fill buffer + loaded qty form from saved values (works for planning/loading
    // and for admin in_progress edits)
    if (showLoadingSheet) {
      const bm = new Map<string, number>();
      const lm = new Map<string, number>();
      for (const li of loadItems) {
        bm.set(li.product_id, Number(li.source_buffer_qty ?? 0));
        lm.set(li.product_id, Number(li.qty_loaded ?? li.qty_planned));
      }
      setBufferQtys(bm);
      setLoadedQtys(lm);
      // Clear any unsaved extra rows that are now actually in loadItems
      setExtraBufferProducts((prev) => prev.filter(pid => !loadItems.some(li => li.product_id === pid)));
    }
    // Pre-fill returned qty form (= loaded - sold)
    if (trip.status === "returned" || trip.status === "in_progress") {
      const billed = new Map<string, number>();
      for (const b of bills) {
        if (b.is_cancelled) continue;
        for (const it of b.items ?? []) {
          billed.set(it.product_id, (billed.get(it.product_id) ?? 0) + Number(it.qty));
        }
      }
      const m = new Map<string, number>();
      for (const li of loadItems) {
        const sold = billed.get(li.product_id) ?? 0;
        m.set(li.product_id, Math.max(0, Number(li.qty_loaded ?? li.qty_planned) - sold));
      }
      setReturnedQtys(m);
      if (kpis) setActualCash(String(kpis.expected_cash));
    }
  }, [trip.status, loadItems, bills, kpis]);

  const sb = statusBadge(trip.status);
  const billedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bills) {
      if (b.is_cancelled) continue;
      for (const it of b.items ?? []) {
        m.set(it.product_id, (m.get(it.product_id) ?? 0) + Number(it.qty));
      }
    }
    return m;
  }, [bills]);

  // ========== HANDLERS ==========

  // Build the complete buffer state to send to server
  // Includes existing items (with current bufferQtys value) + new buffer-only items added by user
  function collectBufferRows(): { productId: string; bufferQty: number }[] {
    const rows: { productId: string; bufferQty: number }[] = [];
    const seen = new Set<string>();
    for (const li of loadItems) {
      rows.push({ productId: li.product_id, bufferQty: bufferQtys.get(li.product_id) ?? 0 });
      seen.add(li.product_id);
    }
    for (const pid of extraBufferProducts) {
      if (seen.has(pid)) continue;
      rows.push({ productId: pid, bufferQty: bufferQtys.get(pid) ?? 0 });
    }
    return rows;
  }

  function handleSavePlan() {
    const bufferRows = collectBufferRows();
    startTransition(async () => {
      const res = await saveTripPlan(tripId, { bufferRows });
      if (res.error) toast.error(res.error);
      else { toast.success("Plan saved"); await reload(); }
    });
  }

  function handleMarkLoaded() {
    const bufferRows = collectBufferRows();
    // Loaded qtys must be sent for everything in the planned set (existing + new buffer)
    const allProductIds = new Set<string>([
      ...loadItems.map(li => li.product_id),
      ...extraBufferProducts,
    ]);
    const loadedPayload: { productId: string; qtyLoaded: number }[] = [];
    for (const pid of allProductIds) {
      const q = loadedQtys.get(pid);
      if (q === undefined) continue;
      if (q < 0) { toast.error("Loaded qty cannot be negative"); return; }
      loadedPayload.push({ productId: pid, qtyLoaded: q });
    }
    const wasInProgressEdit = isInProgressEdit;
    startTransition(async () => {
      const res = await markTripLoaded(tripId, loadedPayload, bufferRows);
      if (res.error) toast.error(res.error);
      else {
        toast.success(wasInProgressEdit ? "Loaded qty updated" : "Trip marked loaded — van is on route");
        if (wasInProgressEdit) setEditPlanMode(false);
        await reload();
      }
    });
  }

  function addExtraBufferProduct() {
    if (!pickProductId) return;
    if (loadItems.some(li => li.product_id === pickProductId)) {
      toast.error("Already in the trip — edit its buffer qty in the table");
      setPickProductId(""); setPickProductOpen(false);
      return;
    }
    if (extraBufferProducts.includes(pickProductId)) {
      toast.error("Already added");
      return;
    }
    setExtraBufferProducts([...extraBufferProducts, pickProductId]);
    // Default buffer to 1, loaded to 1
    const nb = new Map(bufferQtys); nb.set(pickProductId, 1); setBufferQtys(nb);
    const nl = new Map(loadedQtys); nl.set(pickProductId, 1); setLoadedQtys(nl);
    setPickProductId("");
    setPickProductOpen(false);
  }

  function removeExtraBufferProduct(productId: string) {
    setExtraBufferProducts(extraBufferProducts.filter(p => p !== productId));
    const nb = new Map(bufferQtys); nb.delete(productId); setBufferQtys(nb);
    const nl = new Map(loadedQtys); nl.delete(productId); setLoadedQtys(nl);
  }

  // Print a clean A4 loading sheet — opens in a new window so the sidebar/header
  // aren't included. Uses current state including any unsaved buffer edits.
  function printLoadingSheet() {
    type PrintRow = {
      productName: string;
      productUnit: string;
      preOrderQty: number;
      bufferQty: number;
      actuallyLoadedQty: number | null;
    };
    const rows: PrintRow[] = [];

    for (const li of loadItems) {
      const buffer = bufferQtys.get(li.product_id) ?? Number(li.source_buffer_qty);
      const preOrder = Number(li.source_pre_order_qty);
      if (buffer === 0 && preOrder === 0) continue;
      rows.push({
        productName: li.product?.name ?? "—",
        productUnit: li.product?.unit ?? "",
        preOrderQty: preOrder,
        bufferQty: buffer,
        actuallyLoadedQty: li.qty_loaded !== null && li.qty_loaded !== undefined ? Number(li.qty_loaded) : null,
      });
    }
    for (const pid of extraBufferProducts) {
      const prod = products.find(p => p.id === pid);
      const buffer = bufferQtys.get(pid) ?? 0;
      if (buffer === 0) continue;
      rows.push({
        productName: prod?.name ?? "—",
        productUnit: prod?.unit ?? "",
        preOrderQty: 0,
        bufferQty: buffer,
        actuallyLoadedQty: null,
      });
    }
    rows.sort((a, b) => a.productName.localeCompare(b.productName));

    const totalPre   = rows.reduce((s, r) => s + r.preOrderQty, 0);
    const totalBuf   = rows.reduce((s, r) => s + r.bufferQty, 0);
    const totalQty   = totalPre + totalBuf;
    const hasLoaded  = rows.some(r => r.actuallyLoadedQty !== null);
    const totalLoaded = rows.reduce((s, r) => s + (r.actuallyLoadedQty ?? 0), 0);

    const tripDateStr = new Date(trip.trip_date).toLocaleDateString("en-IN", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    });
    const generatedStr = new Date().toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    const loadedAtStr = trip.loaded_at
      ? new Date(trip.loaded_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : null;
    const vehicleStr = [
      trip.vehicle_type === "company" ? "Company" : "Own",
      trip.vehicle_number,
      trip.vehicle_provided_by,
    ].filter(Boolean).join(" · ");
    const statusLabelMap: Record<string, string> = {
      planning: "Planning", loading: "Loading", in_progress: "On Route",
      returned: "Returned · Awaiting Reconcile", reconciled: "Reconciled", cancelled: "Cancelled",
    };
    const statusStr = statusLabelMap[trip.status] ?? trip.status;

    const esc = (s: string) => s.replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    } as Record<string, string>)[c] ?? c);

    const lastColHeader = hasLoaded ? "Actually loaded" : "Loaded";
    const lastColCell = (r: PrintRow) =>
      r.actuallyLoadedQty !== null
        ? `<strong>${r.actuallyLoadedQty.toFixed(0)}</strong>`
        : `<span style="font-size:14pt;color:#aaa;">☐</span>`;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Loading Sheet — ${esc(trip.trip_number)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "IBM Plex Sans", -apple-system, "Segoe UI", sans-serif; color: #0a0a0a; margin: 0; font-size: 11pt; line-height: 1.4; }
  .header { border-bottom: 2px solid #0a0a0a; padding-bottom: 8px; margin-bottom: 16px; }
  .header .row { display: flex; justify-content: space-between; align-items: baseline; }
  .header .company { font-size: 16pt; font-weight: 700; letter-spacing: 0.02em; }
  .header .doctype { font-size: 14pt; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.05em; }
  .header .sub { display: flex; justify-content: space-between; align-items: baseline; color: #888; font-size: 9pt; margin-top: 4px; }
  .status-pill { display: inline-block; border: 1px solid #888; border-radius: 3px; padding: 1px 8px; font-size: 9pt; color: #555; text-transform: uppercase; letter-spacing: 0.04em; }
  .meta { display: grid; grid-template-columns: max-content 1fr max-content 1fr; gap: 6px 16px; margin-bottom: 20px; font-size: 10pt; }
  .meta dt { color: #777; }
  .meta dd { margin: 0; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 10pt; }
  th, td { border: 1px solid #bbb; padding: 7px 8px; text-align: left; vertical-align: top; }
  th { background: #efeae0; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .check { text-align: center; width: 80px; }
  tfoot td { background: #efeae0; font-weight: 700; }
  .footer { margin-top: 28px; page-break-inside: avoid; }
  .signature { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 18px; font-size: 10pt; }
  .signature .block .label { color: #777; font-size: 9pt; margin-bottom: 24px; text-transform: uppercase; letter-spacing: 0.04em; }
  .signature .block .line { border-top: 1px solid #555; padding-top: 4px; min-height: 14px; font-size: 9pt; color: #888; }
  .notes { border: 1px solid #bbb; padding: 8px 10px; min-height: 60px; font-size: 10pt; }
  .notes .label { font-size: 9pt; color: #777; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
  .empty { text-align: center; color: #999; font-style: italic; padding: 28px; border: 1px dashed #ccc; }
  .product-unit { font-size: 9pt; color: #999; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="header">
    <div class="row">
      <div class="company">SUSHIL AGENCIES</div>
      <div class="doctype">Loading Sheet</div>
    </div>
    <div class="sub">
      <span>Generated ${esc(generatedStr)}${loadedAtStr ? ` · Loaded ${esc(loadedAtStr)}` : ""}</span>
      <span class="status-pill">${esc(statusStr)}</span>
    </div>
  </div>

  <dl class="meta">
    <dt>Trip #</dt>   <dd><strong>${esc(trip.trip_number)}</strong></dd>
    <dt>Date</dt>     <dd>${esc(tripDateStr)}</dd>
    <dt>Beat</dt>     <dd>${esc(trip.beat?.name ?? "—")}</dd>
    <dt>Vehicle</dt>  <dd>${esc(vehicleStr || "—")}</dd>
    <dt>Lead</dt>     <dd>${esc(trip.lead?.full_name ?? "—")}</dd>
    <dt>Helpers</dt>  <dd>${esc(trip.helpers.length ? trip.helpers.join(", ") : "—")}</dd>
  </dl>

  ${rows.length === 0 ? `
    <div class="empty">No items planned for this trip.</div>
  ` : `
    <table>
      <thead>
        <tr>
          <th style="width: 50%;">Product</th>
          <th class="num">Pre-order</th>
          <th class="num">Buffer</th>
          <th class="num">Total qty</th>
          <th class="check num">${esc(lastColHeader)}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>
              <div>${esc(r.productName)}</div>
              ${r.productUnit ? `<div class="product-unit">${esc(r.productUnit)}</div>` : ""}
            </td>
            <td class="num">${r.preOrderQty.toFixed(0)}</td>
            <td class="num">${r.bufferQty.toFixed(0)}</td>
            <td class="num"><strong>${(r.preOrderQty + r.bufferQty).toFixed(0)}</strong></td>
            <td class="check">${lastColCell(r)}</td>
          </tr>
        `).join("")}
      </tbody>
      <tfoot>
        <tr>
          <td>TOTAL</td>
          <td class="num">${totalPre.toFixed(0)}</td>
          <td class="num">${totalBuf.toFixed(0)}</td>
          <td class="num">${totalQty.toFixed(0)}</td>
          <td class="num">${hasLoaded ? totalLoaded.toFixed(0) : ""}</td>
        </tr>
      </tfoot>
    </table>
  `}

  <div class="footer">
    <div class="signature">
      <div class="block">
        <div class="label">Loaded by (warehouse)</div>
        <div class="line">Name &amp; Signature</div>
      </div>
      <div class="block">
        <div class="label">Received by (lead / driver)</div>
        <div class="line">Name &amp; Signature</div>
      </div>
    </div>
    <div class="notes">
      <div class="label">Notes</div>
      &nbsp;
    </div>
  </div>

  <script>
    window.addEventListener("load", function() {
      setTimeout(function() {
        window.focus();
        window.print();
      }, 150);
      window.addEventListener("afterprint", function() { window.close(); });
    });
  </script>
</body>
</html>`;

    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) {
      toast.error("Popup blocked — please allow popups for this site to print");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function handleMarkReturned() {
    startTransition(async () => {
      const res = await markTripReturned(tripId);
      if (res.error) toast.error(res.error);
      else { toast.success("Trip marked returned"); await reload(); }
    });
  }

  function handleReconcile() {
    const cash = parseFloat(actualCash || "0");
    if (isNaN(cash) || cash < 0) { toast.error("Enter actual cash collected"); return; }
    const payload: ReconcileInput = {
      returnedQty: Array.from(returnedQtys.entries()).map(([productId, qtyReturned]) => ({ productId, qtyReturned })),
      cashCollectedActual: cash,
      notes: reconcileNotes.trim() || undefined,
    };
    startTransition(async () => {
      const res = await reconcileTrip(tripId, payload);
      if (res.error) toast.error(res.error);
      else { toast.success("Trip reconciled — locked"); await reload(); }
    });
  }

  function handleCancel() {
    const reason = prompt("Cancel reason (min 3 chars):");
    if (!reason || reason.trim().length < 3) return;
    startTransition(async () => {
      const res = await cancelTrip(tripId, reason);
      if (res.error) toast.error(res.error);
      else { toast.success("Trip cancelled"); router.push("/trips"); }
    });
  }

  function startEditingMeta() {
    setMetaForm({
      tripDate: trip.trip_date,
      vehicleType: trip.vehicle_type,
      vehicleNumber: trip.vehicle_number ?? "",
      vehicleProvidedBy: trip.vehicle_provided_by ?? "",
      leadId: trip.lead_id,
      helpersText: trip.helpers.join(", "),
      notes: trip.notes ?? "",
    });
    setEditingMeta(true);
  }

  function handleSaveMeta() {
    const helpersList = metaForm.helpersText.split(",").map(s => s.trim()).filter(Boolean);
    startTransition(async () => {
      const res = await updateTripMetadata(tripId, {
        tripDate: metaForm.tripDate,
        vehicleType: metaForm.vehicleType,
        vehicleNumber: metaForm.vehicleNumber.trim() || null,
        vehicleProvidedBy: metaForm.vehicleType === "company" ? (metaForm.vehicleProvidedBy.trim() || null) : null,
        leadId: metaForm.leadId,
        helpers: helpersList,
        notes: metaForm.notes.trim() || null,
      });
      if (res.error) toast.error(res.error);
      else { toast.success("Trip updated"); setEditingMeta(false); await reload(); }
    });
  }

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto">
      <Link href="/trips" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
        <ArrowLeft size={11}/> Back to trips
      </Link>

      {/* Header card */}
      <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
        {editingMeta ? (
          /* ============== EDIT MODE ============== */
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="font-mono text-base">{trip.trip_number}</span>
              <Badge variant={sb.variant}>{sb.label}</Badge>
              <span className="text-2xs uppercase tracking-wide text-warn ml-auto font-medium">Editing</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
              <div>
                <Label className="block mb-1">Trip date</Label>
                <Input type="date" value={metaForm.tripDate} onChange={(e) => setMetaForm({ ...metaForm, tripDate: e.target.value })} />
              </div>
              <div>
                <Label className="block mb-1">Beat</Label>
                <Input value={trip.beat?.name ?? ""} disabled className="opacity-60" />
                <div className="text-2xs text-ink-subtle mt-0.5">Cannot change — would orphan pre-orders</div>
              </div>
              <div>
                <Label className="block mb-1">Lead person</Label>
                <Select value={metaForm.leadId} onValueChange={(v) => setMetaForm({ ...metaForm, leadId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {vanLeads.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="block mb-1">Vehicle type</Label>
                <Select value={metaForm.vehicleType} onValueChange={(v) => setMetaForm({ ...metaForm, vehicleType: v as "company" | "own" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">Own vehicle</SelectItem>
                    <SelectItem value="company">Company vehicle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="block mb-1">Vehicle number</Label>
                <Input value={metaForm.vehicleNumber} onChange={(e) => setMetaForm({ ...metaForm, vehicleNumber: e.target.value })} placeholder="MH 21 AB 1234" />
              </div>
              {metaForm.vehicleType === "company" && (
                <div>
                  <Label className="block mb-1">Provided by</Label>
                  <Input value={metaForm.vehicleProvidedBy} onChange={(e) => setMetaForm({ ...metaForm, vehicleProvidedBy: e.target.value })} placeholder="Vikram Tea" />
                </div>
              )}
              <div className="col-span-full">
                <Label className="block mb-1">Helpers (comma-separated names)</Label>
                <Input value={metaForm.helpersText} onChange={(e) => setMetaForm({ ...metaForm, helpersText: e.target.value })} placeholder="Ramesh, Suresh" />
              </div>
              <div className="col-span-full">
                <Label className="block mb-1">Notes</Label>
                <Textarea value={metaForm.notes} onChange={(e) => setMetaForm({ ...metaForm, notes: e.target.value })} rows={2} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setEditingMeta(false)} disabled={pending}>
                <X size={11}/> Cancel
              </Button>
              <Button size="sm" onClick={handleSaveMeta} disabled={pending}>
                <Save size={11}/> {pending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        ) : (
          /* ============== DISPLAY MODE ============== */
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-base">{trip.trip_number}</span>
                <Badge variant={sb.variant}>{sb.label}</Badge>
                {trip.status === "in_progress" && (
                  <span
                    className="inline-flex items-center gap-1 text-2xs text-ok"
                    title={lastSyncedAt ? `Last synced ${lastSyncedAt.toLocaleTimeString("en-IN")}` : "Live updates enabled"}
                  >
                    <span className="relative inline-flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-75 animate-ping"></span>
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ok"></span>
                    </span>
                    Live
                  </span>
                )}
              </div>
              <div className="text-sm text-ink-muted">
                {trip.beat?.name} · {new Date(trip.trip_date).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
              </div>
              <div className="text-xs text-ink-muted mt-1">
                <span className="capitalize">{trip.vehicle_type}</span>
                {trip.vehicle_number && <> · <span className="tabular">{trip.vehicle_number}</span></>}
                {trip.vehicle_provided_by && <> · {trip.vehicle_provided_by}</>}
              </div>
              <div className="text-xs text-ink-muted">
                Lead: {trip.lead?.full_name ?? "—"}
                {trip.helpers.length > 0 && <> · Helpers: {trip.helpers.join(", ")}</>}
              </div>
              {trip.notes && (
                <div className="text-xs text-ink-muted mt-1 italic">Note: {trip.notes}</div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {trip.status === "in_progress" && (
                <a href={`/van/${trip.id}`} target="_blank" rel="noopener noreferrer">
                  <Button size="sm"><Smartphone size={11}/> Open mobile billing</Button>
                </a>
              )}
              {trip.status !== "cancelled" && (
                <Button size="sm" variant="outline" onClick={printLoadingSheet}>
                  <Printer size={11}/> Print loading sheet
                </Button>
              )}
              {canEditMeta && (
                <Button size="sm" variant="outline" onClick={startEditingMeta}>
                  <Pencil size={11}/> Edit trip
                </Button>
              )}
              {canEditPlanInProgress && !editPlanMode && (
                <Button size="sm" variant="outline" onClick={() => setEditPlanMode(true)}>
                  <Pencil size={11}/> Edit plan & loaded qty
                </Button>
              )}
              {canCancel && !["reconciled", "cancelled"].includes(trip.status) && (
                <Button size="sm" variant="outline" onClick={handleCancel} disabled={pending}>
                  <Ban size={11}/> Cancel trip
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* KPIs (visible from in_progress onwards) */}
      {kpis && ["in_progress", "returned", "reconciled"].includes(trip.status) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          <Kpi icon={Receipt}      label="Bills"     value={`${kpis.bills_count}`}       sub={`${kpis.pre_order_count} pre · ${kpis.spot_count} spot`} accent="accent" />
          <Kpi icon={IndianRupee}  label="Cash bills" value={formatINR(kpis.cash_bills_total)} sub={`+ outstanding ${formatINR(kpis.outstanding_collected)}`} accent="ok" />
          <Kpi icon={IndianRupee}  label="Expected cash" value={formatINR(kpis.expected_cash)} sub="cash + outstanding" accent="warn" />
          <Kpi icon={Package}      label="Stock remaining" value={`${kpis.total_kg_remaining.toFixed(0)} units`} sub={`${kpis.total_kg_billed.toFixed(0)} sold of ${kpis.total_kg_loaded.toFixed(0)}`} accent="accent" />
        </div>
      )}

      {/* Loading sheet (planning/loading status, or admin during in_progress) */}
      {showLoadingSheet && (
        <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
              Loading sheet
              {isInProgressEdit && <span className="ml-2 text-2xs text-warn font-normal normal-case">(admin edit — trip is on route)</span>}
            </h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={printLoadingSheet}><Printer size={11}/> Print</Button>
              {isInProgressEdit && (
                <Button size="sm" variant="ghost" onClick={() => setEditPlanMode(false)}>
                  <X size={11}/> Close
                </Button>
              )}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="text-2xs uppercase tracking-wide text-ink-muted border-b border-paper-line">
              <tr>
                <th className="px-2 py-1.5 text-left">Product</th>
                <th className="px-2 py-1.5 text-right">Pre-order qty</th>
                <th className="px-2 py-1.5 text-right w-28">Buffer qty</th>
                <th className="px-2 py-1.5 text-right">Planned</th>
                <th className="px-2 py-1.5 text-right w-28">Actually loaded</th>
                <th className="px-2 py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {/* Existing rows from trip_load_items (pre-orders + saved buffer) */}
              {loadItems.map(li => {
                const bufferQty = bufferQtys.get(li.product_id) ?? Number(li.source_buffer_qty);
                const preOrderQty = Number(li.source_pre_order_qty);
                const planned = preOrderQty + bufferQty;
                const isBufferOnly = preOrderQty === 0;
                return (
                  <tr key={li.id}>
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{li.product?.name ?? "—"}</div>
                      <div className="text-2xs text-ink-subtle">{li.product?.unit}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular text-ink-muted">{preOrderQty.toFixed(0)}</td>
                    <td className="px-2 py-1.5 text-right">
                      {canManage ? (
                        <Input
                          type="number" step="0.001" min="0"
                          value={bufferQty}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value) || 0;
                            const n = new Map(bufferQtys); n.set(li.product_id, v); setBufferQtys(n);
                            // If loaded qty is at default (=planned), bump it to follow buffer changes
                            const oldBuffer = bufferQtys.get(li.product_id) ?? Number(li.source_buffer_qty);
                            const oldPlanned = preOrderQty + oldBuffer;
                            const currentLoaded = loadedQtys.get(li.product_id) ?? Number(li.qty_loaded ?? oldPlanned);
                            if (currentLoaded === oldPlanned) {
                              const nl = new Map(loadedQtys); nl.set(li.product_id, preOrderQty + v); setLoadedQtys(nl);
                            }
                          }}
                          className="text-right tabular w-24 ml-auto"
                        />
                      ) : <span className="tabular">{bufferQty.toFixed(0)}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular font-medium">{planned.toFixed(0)}</td>
                    <td className="px-2 py-1.5 text-right">
                      {canManage ? (
                        <Input
                          type="number" step="0.001" min="0"
                          value={loadedQtys.get(li.product_id) ?? planned}
                          onChange={(e) => {
                            const n = new Map(loadedQtys);
                            n.set(li.product_id, parseFloat(e.target.value) || 0);
                            setLoadedQtys(n);
                          }}
                          className="text-right tabular w-24 ml-auto"
                        />
                      ) : <span className="text-ink-muted tabular">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {isBufferOnly && canManage && (
                        <button
                          onClick={() => {
                            const n = new Map(bufferQtys); n.set(li.product_id, 0); setBufferQtys(n);
                            // Server will delete the row on next save (buffer=0 + pre-order=0)
                          }}
                          title="Remove buffer (will delete on save)"
                          className="text-ink-muted hover:text-danger"
                        >
                          <Trash2 size={13}/>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {/* Extra buffer rows added by user this session (not yet saved) */}
              {extraBufferProducts.map(pid => {
                const prod = products.find(p => p.id === pid);
                const bufferQty = bufferQtys.get(pid) ?? 0;
                return (
                  <tr key={`extra-${pid}`} className="bg-warn-soft/20">
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{prod?.name ?? "—"}</div>
                      <div className="text-2xs text-warn">unsaved · buffer-only</div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular text-ink-muted">0</td>
                    <td className="px-2 py-1.5 text-right">
                      <Input
                        type="number" step="0.001" min="0"
                        value={bufferQty}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          const n = new Map(bufferQtys); n.set(pid, v); setBufferQtys(n);
                          const nl = new Map(loadedQtys); nl.set(pid, v); setLoadedQtys(nl);
                        }}
                        className="text-right tabular w-24 ml-auto"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular font-medium">{bufferQty.toFixed(0)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <Input
                        type="number" step="0.001" min="0"
                        value={loadedQtys.get(pid) ?? bufferQty}
                        onChange={(e) => {
                          const n = new Map(loadedQtys); n.set(pid, parseFloat(e.target.value) || 0); setLoadedQtys(n);
                        }}
                        className="text-right tabular w-24 ml-auto"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button onClick={() => removeExtraBufferProduct(pid)} className="text-ink-muted hover:text-danger">
                        <Trash2 size={13}/>
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* Add buffer product row */}
              {canManage && (
                pickProductOpen ? (
                  <tr className="bg-paper-subtle/30">
                    <td className="px-2 py-1.5" colSpan={5}>
                      <div className="flex items-center gap-2">
                        <Select value={pickProductId} onValueChange={setPickProductId}>
                          <SelectTrigger className="flex-1"><SelectValue placeholder="Pick a product to add as buffer…" /></SelectTrigger>
                          <SelectContent>
                            {products
                              .filter(p =>
                                !loadItems.some(li => li.product_id === p.id) &&
                                !extraBufferProducts.includes(p.id)
                              )
                              .map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)
                            }
                          </SelectContent>
                        </Select>
                        <Button size="sm" onClick={addExtraBufferProduct} disabled={!pickProductId}>Add</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setPickProductOpen(false); setPickProductId(""); }}>Cancel</Button>
                      </div>
                    </td>
                    <td/>
                  </tr>
                ) : (
                  <tr>
                    <td className="px-2 py-2" colSpan={6}>
                      <Button size="sm" variant="outline" onClick={() => setPickProductOpen(true)}>
                        <Plus size={11}/> Add buffer product
                      </Button>
                    </td>
                  </tr>
                )
              )}

              {loadItems.length === 0 && extraBufferProducts.length === 0 && !pickProductOpen && (
                <tr><td colSpan={6} className="px-2 py-6 text-center text-ink-muted italic">
                  No items planned yet. Add buffer stock to load.
                </td></tr>
              )}
            </tbody>
          </table>

          {canManage && (
            <div className="mt-3 flex gap-2 justify-end">
              <Button variant="outline" onClick={handleSavePlan} disabled={pending}>
                <Save size={11}/> {pending ? "Saving…" : "Save Plan"}
              </Button>
              {isInProgressEdit ? (
                <Button onClick={handleMarkLoaded} disabled={pending || (loadItems.length === 0 && extraBufferProducts.length === 0)}>
                  <Save size={11}/> {pending ? "Saving…" : "Save loaded qty"}
                </Button>
              ) : (
                <Button onClick={handleMarkLoaded} disabled={pending || (loadItems.length === 0 && extraBufferProducts.length === 0)}>
                  <Truck size={11}/> {pending ? "Saving…" : "Mark loaded & start trip"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* In-progress: bills list (read-only) */}
      {(trip.status === "in_progress" || trip.status === "returned" || trip.status === "reconciled") && (
        <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Bills ({bills.length})</h2>
            {trip.status === "in_progress" && (
              <a href={`/van/${trip.id}`} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline"><Smartphone size={11}/> Add via mobile</Button>
              </a>
            )}
          </div>
          {loading ? (
            <div className="text-sm text-ink-muted">Loading…</div>
          ) : bills.length === 0 ? (
            <div className="text-sm text-ink-muted italic">No bills yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase tracking-wide text-ink-muted border-b border-paper-line">
                <tr>
                  <th className="px-2 py-1.5 text-left">Bill #</th>
                  <th className="px-2 py-1.5 text-left">Customer</th>
                  <th className="px-2 py-1.5 text-left">Type</th>
                  <th className="px-2 py-1.5 text-right">Total</th>
                  <th className="px-2 py-1.5 text-right">Old o/s collected</th>
                  <th className="px-2 py-1.5 text-left">Mode</th>
                  <th className="px-2 py-1.5 text-left">Status</th>
                  <th className="px-2 py-1.5 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {bills.map(b => {
                  // Status badge: prefer the linked order's app_status (most authoritative for pre-orders);
                  // fall back to bill confirmation state for spot bills or unlinked bills.
                  const orderStatus = b.source_order?.app_status ?? null;
                  let statusEl;
                  if (b.is_cancelled) {
                    statusEl = <Badge variant="danger">cancelled</Badge>;
                  } else if (orderStatus) {
                    const variant: "ok" | "warn" | "accent" | "neutral" =
                      orderStatus === "delivered" ? "ok"
                      : orderStatus === "approved" ? "warn"
                      : orderStatus === "partially_dispatched" || orderStatus === "dispatched" ? "accent"
                      : "neutral";
                    statusEl = <Badge variant={variant}>{orderStatus.replace(/_/g, " ")}</Badge>;
                  } else if (b.confirmed_at) {
                    statusEl = <Badge variant="ok">billed</Badge>;
                  } else {
                    statusEl = <Badge variant="warn">pending</Badge>;
                  }

                  return (
                    <tr
                      key={b.id}
                      onClick={() => setViewingBillId(b.id)}
                      className={`cursor-pointer hover:bg-paper-subtle/40 transition-colors ${b.is_cancelled ? "opacity-40 line-through" : ""}`}
                    >
                      <td className="px-2 py-1.5 font-mono text-2xs">{b.bill_number}{b.paper_bill_no && <span className="text-ink-subtle"> · {b.paper_bill_no}</span>}</td>
                      <td className="px-2 py-1.5">{b.customer?.name ?? "—"}</td>
                      <td className="px-2 py-1.5"><Badge variant={b.bill_type === "pre_order" ? "neutral" : "accent"}>{b.bill_type === "pre_order" ? "Pre-order" : "Spot"}</Badge></td>
                      <td className="px-2 py-1.5 text-right tabular">{formatINR(b.total_amount)}</td>
                      <td className="px-2 py-1.5 text-right tabular text-ink-muted">{formatINR(b.outstanding_collected)}</td>
                      <td className="px-2 py-1.5"><Badge variant={b.payment_mode === "cash" ? "ok" : "warn"}>{b.payment_mode}</Badge></td>
                      <td className="px-2 py-1.5">{statusEl}</td>
                      <td className="px-2 py-1.5 text-ink-subtle"><Eye size={13}/></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {trip.status === "in_progress" && canManage && (
            <div className="mt-3 flex gap-2 justify-end">
              <Button onClick={handleMarkReturned} disabled={pending}>
                <FileCheck2 size={11}/> Mark returned (back at office)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Reconciliation panel */}
      {(trip.status === "returned" || trip.status === "reconciled") && (
        <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted mb-3">Reconciliation</h2>

          <h3 className="text-xs font-medium mb-2">Stock</h3>
          <table className="w-full text-sm mb-4">
            <thead className="text-2xs uppercase tracking-wide text-ink-muted border-b border-paper-line">
              <tr>
                <th className="px-2 py-1 text-left">Product</th>
                <th className="px-2 py-1 text-right">Loaded</th>
                <th className="px-2 py-1 text-right">Sold (per bills)</th>
                <th className="px-2 py-1 text-right">Expected return</th>
                <th className="px-2 py-1 text-right">Actually returned</th>
                <th className="px-2 py-1 text-center">Match?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {loadItems.map(li => {
                const loaded = Number(li.qty_loaded ?? 0);
                const sold = billedMap.get(li.product_id) ?? 0;
                const expected = Math.max(0, loaded - sold);
                const returned = trip.status === "reconciled"
                  ? Number(li.qty_returned ?? 0)
                  : (returnedQtys.get(li.product_id) ?? expected);
                const diff = returned - expected;
                return (
                  <tr key={li.id}>
                    <td className="px-2 py-1.5">{li.product?.name ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular">{loaded.toFixed(0)}</td>
                    <td className="px-2 py-1.5 text-right tabular">{sold.toFixed(0)}</td>
                    <td className="px-2 py-1.5 text-right tabular">{expected.toFixed(0)}</td>
                    <td className="px-2 py-1.5 text-right">
                      {trip.status === "returned" ? (
                        <Input type="number" step="0.001" min="0" value={returned}
                          onChange={(e) => {
                            const n = new Map(returnedQtys);
                            n.set(li.product_id, parseFloat(e.target.value) || 0);
                            setReturnedQtys(n);
                          }}
                          className="w-24 text-right tabular ml-auto"
                        />
                      ) : <span className="tabular">{returned.toFixed(0)}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-center text-xs">
                      {Math.abs(diff) < 0.01 ? <CheckCircle2 size={14} className="text-ok inline"/> : (
                        <span className="text-danger inline-flex items-center gap-0.5">
                          <AlertCircle size={12}/> {diff > 0 ? "+" : ""}{diff.toFixed(1)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="text-xs font-medium mb-2">Cash</h3>
          {kpis && (
            <div className="bg-paper-subtle/40 border border-paper-line rounded p-3 text-sm space-y-1 mb-3">
              <div className="flex justify-between"><span>Cash bills total</span><span className="tabular">{formatINR(kpis.cash_bills_total)}</span></div>
              <div className="flex justify-between"><span>+ Old outstanding collected</span><span className="tabular">{formatINR(kpis.outstanding_collected)}</span></div>
              <div className="flex justify-between font-semibold border-t border-paper-line pt-1 mt-1"><span>Expected cash</span><span className="tabular">{formatINR(kpis.expected_cash)}</span></div>
            </div>
          )}
          {trip.status === "returned" ? (
            <>
              <Label className="block mb-1">Actual cash handed over</Label>
              <Input type="number" step="0.01" value={actualCash} onChange={(e) => setActualCash(e.target.value)} className="tabular w-48 mb-3" />
              <Label className="block mb-1">Reconcile notes (optional)</Label>
              <Textarea value={reconcileNotes} onChange={(e) => setReconcileNotes(e.target.value)} rows={2} className="mb-3" />
            </>
          ) : (
            <div className="text-sm space-y-1 mb-3">
              <div className="flex justify-between"><span>Actual cash handed over</span><span className="tabular">{formatINR(trip.cash_collected_actual ?? 0)}</span></div>
              {trip.reconcile_notes && <div className="text-xs text-ink-muted mt-1">Notes: {trip.reconcile_notes}</div>}
            </div>
          )}

          {trip.status === "returned" && canManage && (
            <div className="flex gap-2 justify-end">
              <Button onClick={handleReconcile} disabled={pending}>
                {pending ? "Saving…" : "Confirm Reconciliation & Lock Trip"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Bill detail drawer (read-only) */}
      <Sheet open={viewingBillId !== null} onOpenChange={(open) => !open && setViewingBillId(null)}>
        <SheetContent className="w-full max-w-md sm:max-w-md">
          {viewingBill && (
            <>
              <SheetHeader>
                <div>
                  <SheetTitle>{viewingBill.customer?.name ?? "—"}</SheetTitle>
                  <SheetDescription>
                    <span className="font-mono">{viewingBill.bill_number}</span>
                    {viewingBill.paper_bill_no && <span className="text-ink-subtle"> · paper {viewingBill.paper_bill_no}</span>}
                  </SheetDescription>
                </div>
              </SheetHeader>
              <SheetBody>
                {/* Status badges */}
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <Badge variant={viewingBill.bill_type === "pre_order" ? "neutral" : "accent"}>
                    {viewingBill.bill_type === "pre_order" ? "Pre-order delivery" : "Spot bill"}
                  </Badge>
                  <Badge variant={viewingBill.payment_mode === "cash" ? "ok" : "warn"}>
                    {viewingBill.payment_mode}
                  </Badge>
                  {viewingBill.is_cancelled && <Badge variant="danger">Cancelled</Badge>}
                  {!viewingBill.confirmed_at && !viewingBill.is_cancelled && viewingBill.bill_type === "pre_order" && (
                    <Badge variant="warn">Pending delivery</Badge>
                  )}
                </div>

                {/* Customer info */}
                <div className="text-xs text-ink-muted mb-4 space-y-0.5">
                  {viewingBill.customer?.mobile && <div>Mobile: <span className="tabular text-ink">{viewingBill.customer.mobile}</span></div>}
                  {viewingBill.customer?.city && <div>City: <span className="text-ink">{viewingBill.customer.city}</span></div>}
                  {viewingBill.confirmed_at && (
                    <div>Confirmed: <span className="text-ink">{new Date(viewingBill.confirmed_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
                  )}
                </div>

                {/* Items — name + qty in bold */}
                <div className="border border-paper-line rounded mb-4">
                  <div className="bg-paper-subtle/60 px-3 py-1.5 text-2xs uppercase tracking-wide text-ink-muted border-b border-paper-line">
                    Items ({viewingBill.items?.length ?? 0})
                  </div>
                  {(viewingBill.items?.length ?? 0) === 0 ? (
                    <div className="text-sm text-ink-muted italic px-3 py-3">No items.</div>
                  ) : (
                    <div className="divide-y divide-paper-line">
                      {viewingBill.items?.map(it => (
                        <div key={it.id} className="px-3 py-2.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-semibold text-base flex-1 min-w-0">{it.product?.name ?? "—"}</span>
                            <span className="font-bold text-base tabular whitespace-nowrap">
                              {Number(it.qty).toFixed(0)}
                              {it.product?.unit && <span className="text-sm font-normal text-ink-muted ml-1">{it.product.unit}</span>}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between text-2xs text-ink-muted mt-0.5">
                            <span>@ {formatINR(it.rate)}</span>
                            <span className="tabular">{formatINR(it.amount)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Totals */}
                <div className="bg-paper-subtle/40 border border-paper-line rounded p-3 text-sm space-y-1 mb-4">
                  <div className="flex justify-between text-ink-muted">
                    <span>Subtotal</span><span className="tabular">{formatINR(viewingBill.subtotal)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-paper-line pt-1 mt-1">
                    <span>Total</span><span className="tabular">{formatINR(viewingBill.total_amount)}</span>
                  </div>
                  {Number(viewingBill.cash_received) > 0 && (
                    <div className="flex justify-between text-ok text-2xs pt-1">
                      <span>Cash received now</span><span className="tabular">{formatINR(viewingBill.cash_received)}</span>
                    </div>
                  )}
                  {Number(viewingBill.outstanding_collected) > 0 && (
                    <div className="flex justify-between text-ok text-2xs">
                      <span>Old outstanding collected</span><span className="tabular">{formatINR(viewingBill.outstanding_collected)}</span>
                    </div>
                  )}
                </div>

                {/* Linked source order */}
                {viewingBill.source_order_id && (
                  <div className="text-xs text-ink-muted mb-4 flex items-center gap-1.5 flex-wrap">
                    <FileText size={12}/>
                    <span>Linked to order</span>
                    <Link href={`/orders?focus=${viewingBill.source_order_id}`} className="text-accent hover:underline font-mono">
                      {viewingBill.source_order?.rupyz_order_id ?? "open"}
                    </Link>
                    {viewingBill.source_order?.app_status && (
                      <Badge variant={
                        viewingBill.source_order.app_status === "delivered" ? "ok"
                        : viewingBill.source_order.app_status === "approved" ? "warn"
                        : "neutral"
                      }>
                        {viewingBill.source_order.app_status.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                )}

                {/* Notes */}
                {viewingBill.notes && (
                  <div className="border border-paper-line rounded p-3 mb-4">
                    <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">Notes</div>
                    <div className="text-sm text-ink whitespace-pre-wrap">{viewingBill.notes}</div>
                  </div>
                )}

                <p className="text-2xs text-ink-subtle text-center pt-2">
                  Read-only view. To edit or cancel, use the mobile billing app.
                </p>
              </SheetBody>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, accent }: { icon: typeof MapPin; label: string; value: string; sub: string; accent: "warn" | "accent" | "ok" | "danger" | "neutral" }) {
  const accentText = { warn: "text-warn", accent: "text-accent", ok: "text-ok", danger: "text-danger", neutral: "text-ink" }[accent];
  const accentBg = { warn: "bg-warn-soft", accent: "bg-accent-soft", ok: "bg-ok-soft", danger: "bg-danger-soft", neutral: "bg-paper-subtle" }[accent];
  return (
    <div className="border border-paper-line rounded-md p-3 bg-paper-card">
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`p-1 rounded ${accentBg}`}><Icon size={12} className={accentText} /></span>
        <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">{label}</span>
      </div>
      <div className={`text-lg font-bold tabular ${accentText}`}>{value}</div>
      <div className="text-2xs text-ink-muted">{sub}</div>
    </div>
  );
}
