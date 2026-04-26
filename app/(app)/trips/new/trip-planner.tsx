"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { AppUser, Beat, Product, Order } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";
import { createTrip, type CreateTripInput } from "../actions";

type ProductLite = Pick<Product, "id" | "name" | "unit" | "base_price" | "mrp" | "gst_percent">;

export function TripPlanner({
  me, beats, products, vanLeads,
}: {
  me: AppUser;
  beats: Pick<Beat, "id" | "name" | "is_van_beat">[];
  products: ProductLite[];
  vanLeads: Pick<AppUser, "id" | "full_name">[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // Form state
  const today = new Date().toISOString().slice(0, 10);
  const [tripDate, setTripDate] = useState(today);
  const [beatId, setBeatId] = useState<string>("");
  const [vehicleType, setVehicleType] = useState<"company" | "own">("own");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [vehicleProvidedBy, setVehicleProvidedBy] = useState("");
  const [leadId, setLeadId] = useState<string>(me.id);
  const [helpersText, setHelpersText] = useState("");
  const [notes, setNotes] = useState("");

  // Pre-orders for selected beat (approved + within window)
  const [preOrders, setPreOrders] = useState<Order[]>([]);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Buffer lines
  const [buffer, setBuffer] = useState<{ tempId: string; productId: string; qty: number }[]>([]);

  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!beatId) { setPreOrders([]); return; }
    let cancelled = false;
    setLoadingOrders(true);
    (async () => {
      // Find approved/partially_dispatched orders for this beat from last 7 days
      // (not yet on a trip — i.e. no trip_bills row)
      const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
      const { data: customers } = await supabase
        .from("customers").select("id").eq("beat_id", beatId).eq("active", true);
      const customerIds = (customers ?? []).map((c: { id: string }) => c.id);
      if (customerIds.length === 0) { setPreOrders([]); setLoadingOrders(false); return; }

      const { data, error } = await supabase
        .from("orders")
        .select("*, customer:customers(id,name,customer_type,city,mobile)")
        .in("app_status", ["approved", "partially_dispatched"])
        .in("customer_id", customerIds)
        .gte("rupyz_created_at", since)
        .order("rupyz_created_at", { ascending: false });

      if (cancelled) return;
      if (error) { toast.error(error.message); setPreOrders([]); }
      else {
        // Filter out any already linked to a non-cancelled trip bill
        const ids = (data ?? []).map((o: { id: string }) => o.id);
        let alreadyOnTripIds = new Set<string>();
        if (ids.length) {
          const { data: existing } = await supabase
            .from("trip_bills")
            .select("source_order_id")
            .in("source_order_id", ids)
            .eq("is_cancelled", false);
          alreadyOnTripIds = new Set(((existing ?? []) as { source_order_id: string }[]).map(x => x.source_order_id));
        }
        const filtered = (data ?? []).filter((o: { id: string }) => !alreadyOnTripIds.has(o.id));
        setPreOrders(filtered as unknown as Order[]);
        // Auto-select all by default
        setSelectedOrderIds(new Set(filtered.map((o: { id: string }) => o.id)));
      }
      setLoadingOrders(false);
    })();
    return () => { cancelled = true; };
  }, [beatId, supabase]);

  function toggleOrder(id: string) {
    const next = new Set(selectedOrderIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedOrderIds(next);
  }

  function addBufferLine() {
    setBuffer([...buffer, { tempId: crypto.randomUUID(), productId: "", qty: 0 }]);
  }
  function patchBuffer(tempId: string, patch: Partial<{ productId: string; qty: number }>) {
    setBuffer(buffer.map(b => b.tempId === tempId ? { ...b, ...patch } : b));
  }
  function removeBuffer(tempId: string) {
    setBuffer(buffer.filter(b => b.tempId !== tempId));
  }

  const selectedTotalAmount = preOrders
    .filter(o => selectedOrderIds.has(o.id))
    .reduce((s, o) => s + Number(o.total_amount), 0);

  function handleCreate() {
    if (!beatId) { toast.error("Pick a beat"); return; }
    if (!leadId) { toast.error("Pick a lead"); return; }

    const helpersList = helpersText.split(",").map(s => s.trim()).filter(Boolean);
    const validBuffer = buffer.filter(b => b.productId && b.qty > 0);

    if (selectedOrderIds.size === 0 && validBuffer.length === 0) {
      toast.error("Add at least one pre-order or buffer line"); return;
    }

    const payload: CreateTripInput = {
      tripDate, beatId, vehicleType,
      vehicleNumber: vehicleNumber.trim() || undefined,
      vehicleProvidedBy: vehicleType === "company" ? (vehicleProvidedBy.trim() || "Vikram Tea") : undefined,
      leadId,
      helpers: helpersList,
      notes: notes.trim() || undefined,
      preOrderIds: Array.from(selectedOrderIds),
      bufferLines: validBuffer.map(b => ({ productId: b.productId, qty: b.qty })),
    };

    startTransition(async () => {
      const res = await createTrip(payload);
      if (res.error) toast.error(res.error);
      else { toast.success(`Trip ${res.tripNumber} created`); router.push(`/trips/${res.tripId}`); }
    });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/trips" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
        <ArrowLeft size={11}/> Back to trips
      </Link>

      {/* Trip header */}
      <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide text-ink-muted">Trip details</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <Label className="block mb-1">Trip date</Label>
            <Input type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} />
          </div>
          <div>
            <Label className="block mb-1">VAN beat</Label>
            <Select value={beatId} onValueChange={setBeatId}>
              <SelectTrigger><SelectValue placeholder="Pick beat…" /></SelectTrigger>
              <SelectContent>
                {beats.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="block mb-1">Lead person</Label>
            <Select value={leadId} onValueChange={setLeadId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {vanLeads.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="block mb-1">Vehicle type</Label>
            <Select value={vehicleType} onValueChange={(v) => setVehicleType(v as "company" | "own")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="own">Own vehicle</SelectItem>
                <SelectItem value="company">Company vehicle (e.g. Vikram Tea)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="block mb-1">Vehicle number</Label>
            <Input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="MH 21 AB 1234" />
          </div>
          {vehicleType === "company" && (
            <div>
              <Label className="block mb-1">Provided by</Label>
              <Input value={vehicleProvidedBy} onChange={(e) => setVehicleProvidedBy(e.target.value)} placeholder="Vikram Tea" />
            </div>
          )}
          <div className="lg:col-span-2">
            <Label className="block mb-1">Helpers (comma-separated names)</Label>
            <Input value={helpersText} onChange={(e) => setHelpersText(e.target.value)} placeholder="Ramesh, Suresh" />
          </div>
          <div className="col-span-full">
            <Label className="block mb-1">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
      </div>

      {/* Pre-orders */}
      {beatId && (
        <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
              Pre-orders for this beat (last 7 days)
            </h2>
            <span className="text-xs text-ink-muted">{selectedOrderIds.size} of {preOrders.length} selected</span>
          </div>
          {loadingOrders ? (
            <div className="text-sm text-ink-muted">Loading orders…</div>
          ) : preOrders.length === 0 ? (
            <div className="text-sm text-ink-muted italic">No approved orders for this beat in the last 7 days. You can still create a trip with buffer stock only.</div>
          ) : (
            <div className="border border-paper-line rounded">
              <table className="w-full text-sm">
                <thead className="bg-paper-subtle/40 border-b border-paper-line">
                  <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-1.5 w-8"></th>
                    <th className="px-3 py-1.5 font-medium">Order #</th>
                    <th className="px-3 py-1.5 font-medium">Customer</th>
                    <th className="px-3 py-1.5 font-medium">Date</th>
                    <th className="px-3 py-1.5 font-medium text-right">Total</th>
                    <th className="px-3 py-1.5 font-medium">Payment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-line">
                  {preOrders.map(o => (
                    <tr key={o.id} className="hover:bg-paper-subtle/30 cursor-pointer" onClick={() => toggleOrder(o.id)}>
                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={selectedOrderIds.has(o.id)}
                          onChange={() => toggleOrder(o.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{o.rupyz_order_id}</td>
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{o.customer?.name ?? "—"}</div>
                      </td>
                      <td className="px-3 py-1.5 text-2xs text-ink-muted tabular">
                        {new Date(o.rupyz_created_at).toLocaleDateString("en-IN")}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">{formatINR(o.total_amount)}</td>
                      <td className="px-3 py-1.5 text-2xs">
                        {o.payment_option_check === "PAY_ON_DELIVERY" ? <Badge variant="warn">COD</Badge>
                          : o.payment_option_check === "CREDIT_DAYS" ? <Badge variant="neutral">Credit</Badge>
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-paper-subtle/40 border-t border-paper-line">
                  <tr>
                    <td colSpan={4} className="px-3 py-1.5 text-right text-xs text-ink-muted">Selected total</td>
                    <td className="px-3 py-1.5 text-right tabular text-sm font-semibold">{formatINR(selectedTotalAmount)}</td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Buffer */}
      {beatId && (
        <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
              Buffer stock (gut-feel extras)
            </h2>
            <Button size="sm" variant="outline" onClick={addBufferLine}>
              <Plus size={11}/> Add line
            </Button>
          </div>
          {buffer.length === 0 ? (
            <div className="text-sm text-ink-muted italic">No buffer added. Click "Add line" if you want to load extras for cash customers.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-2xs uppercase tracking-wide text-ink-muted border-b border-paper-line">
                <tr><th className="px-2 py-1 text-left">Product</th><th className="px-2 py-1 text-right w-32">Qty</th><th/></tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {buffer.map(b => (
                  <tr key={b.tempId}>
                    <td className="px-2 py-1.5">
                      <Select value={b.productId} onValueChange={(v) => patchBuffer(b.tempId, { productId: v })}>
                        <SelectTrigger><SelectValue placeholder="Pick product…" /></SelectTrigger>
                        <SelectContent>
                          {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number" step="0.001" min="0"
                        value={b.qty}
                        onChange={(e) => patchBuffer(b.tempId, { qty: parseFloat(e.target.value) || 0 })}
                        className="text-right tabular"
                      />
                    </td>
                    <td className="px-2 py-1.5 w-10">
                      <button onClick={() => removeBuffer(b.tempId)} className="text-ink-muted hover:text-danger">
                        <Trash2 size={13}/>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <Link href="/trips"><Button variant="outline">Cancel</Button></Link>
        <Button onClick={handleCreate} disabled={pending || !beatId}>
          {pending ? "Creating…" : "Create Trip"}
        </Button>
      </div>
    </div>
  );
}
