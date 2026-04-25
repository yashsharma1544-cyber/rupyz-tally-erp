"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ExternalLink, FileEdit, Check, X, Truck, Trash2, Plus, History, FileText, MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody, SheetFooter,
} from "@/components/ui/sheet";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type {
  Order, OrderItem, OrderAuditEvent, OrderRevision, AppUser, Product,
  Dispatch, OrderAppStatus,
} from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";
import {
  approveOrder, rejectOrder, editOrder, type EditPayload,
} from "./actions";
import { createDispatch, shipDispatch, cancelDispatch } from "../dispatches/actions";

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

type Tab = "current" | "original" | "history";
type EditState = {
  // For each line: working copy of qty + price
  edits: Map<string, { qty: number; price: number; removed: boolean }>;
  additions: { tempId: string; productId: string; qty: number; price: number }[];
  comment: string;
};

export function OrderDrawer({
  order,
  onClose,
  me,
}: {
  order: Order | null;
  onClose: () => void;
  me: AppUser;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [audit, setAudit] = useState<OrderAuditEvent[]>([]);
  const [revisions, setRevisions] = useState<OrderRevision[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [products, setProducts] = useState<Pick<Product, "id" | "name" | "unit" | "base_price" | "gst_percent">[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("current");

  // Modes
  const [editMode, setEditMode] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [dispatchMode, setDispatchMode] = useState(false);

  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!order) return;
    setLoading(true); setEditMode(false); setRejectMode(false); setDispatchMode(false); setTab("current");
    (async () => {
      const [{ data: it }, { data: au }, { data: rv }, { data: ds }, { data: pr }] = await Promise.all([
        supabase.from("order_items").select("*").eq("order_id", order.id).order("created_at"),
        supabase.from("order_audit_events").select("*").eq("order_id", order.id).order("created_at", { ascending: false }),
        supabase.from("order_revisions").select("*").eq("order_id", order.id).order("revision_number", { ascending: false }),
        supabase.from("dispatches").select("*, items:dispatch_items(*, order_item:order_items(product_name,unit)), pod:pods(*)").eq("order_id", order.id).order("created_at", { ascending: false }),
        supabase.from("products").select("id, name, unit, base_price, gst_percent").eq("active", true).order("name"),
      ]);
      setItems(it ?? []);
      setAudit(au ?? []);
      setRevisions(rv ?? []);
      setDispatches(((ds ?? []) as unknown as (Dispatch & { pod: unknown })[])
        .map((d) => ({ ...d, pod: Array.isArray(d.pod) ? d.pod[0] ?? null : d.pod ?? null })) as unknown as Dispatch[]);
      setProducts(pr ?? []);
      setLoading(false);
    })();
  }, [order, supabase]);

  if (!order) return null;

  const canApprove   = ["admin", "approver"].includes(me.role) && order.app_status === "received";
  const canEdit      = ["admin", "approver"].includes(me.role) && ["received", "approved"].includes(order.app_status);
  const canDispatch  = ["admin", "dispatch", "approver"].includes(me.role) && ["approved", "partially_dispatched"].includes(order.app_status);

  // === HANDLERS ===

  function startEdit() {
    const m = new Map<string, { qty: number; price: number; removed: boolean }>();
    items.forEach(it => m.set(it.id, { qty: Number(it.qty), price: Number(it.price), removed: false }));
    setEditState({ edits: m, additions: [], comment: "" });
    setEditMode(true);
  }

  function handleSaveEdit() {
    if (!editState) return;
    if (editState.comment.trim().length < 3) { toast.error("Comment required (min 3 chars)"); return; }

    const lineUpdates: EditPayload["lineUpdates"] = [];
    const lineRemovals: string[] = [];
    for (const it of items) {
      const e = editState.edits.get(it.id);
      if (!e) continue;
      if (e.removed) lineRemovals.push(it.id);
      else if (e.qty !== Number(it.qty) || e.price !== Number(it.price)) {
        lineUpdates.push({ lineId: it.id, qty: e.qty, price: e.price });
      }
    }
    const lineAdditions = editState.additions
      .filter(a => a.productId && a.qty > 0)
      .map(a => ({ productId: a.productId, qty: a.qty, price: a.price }));

    if (!lineUpdates.length && !lineRemovals.length && !lineAdditions.length) {
      toast.error("No changes to save"); return;
    }

    startTransition(async () => {
      const res = await editOrder(order.id, {
        lineUpdates, lineRemovals, lineAdditions, comment: editState.comment,
      });
      if (res.error) toast.error(res.error);
      else { toast.success("Order updated"); setEditMode(false); router.refresh(); reload(); }
    });
  }

  function handleApprove() {
    startTransition(async () => {
      const res = await approveOrder(order.id);
      if (res.error) toast.error(res.error);
      else { toast.success("Order approved"); router.refresh(); reload(); }
    });
  }

  function handleReject() {
    if (rejectReason.trim().length < 3) { toast.error("Reason required (min 3 chars)"); return; }
    startTransition(async () => {
      const res = await rejectOrder(order.id, rejectReason);
      if (res.error) toast.error(res.error);
      else { toast.success("Order rejected"); setRejectMode(false); router.refresh(); reload(); }
    });
  }

  async function reload() {
    const [{ data: it }, { data: au }, { data: rv }, { data: ds }] = await Promise.all([
      supabase.from("order_items").select("*").eq("order_id", order.id).order("created_at"),
      supabase.from("order_audit_events").select("*").eq("order_id", order.id).order("created_at", { ascending: false }),
      supabase.from("order_revisions").select("*").eq("order_id", order.id).order("revision_number", { ascending: false }),
      supabase.from("dispatches").select("*, items:dispatch_items(*, order_item:order_items(product_name,unit)), pod:pods(*)").eq("order_id", order.id).order("created_at", { ascending: false }),
    ]);
    setItems(it ?? []);
    setAudit(au ?? []);
    setRevisions(rv ?? []);
    setDispatches(((ds ?? []) as unknown as (Dispatch & { pod: unknown })[])
      .map((d) => ({ ...d, pod: Array.isArray(d.pod) ? d.pod[0] ?? null : d.pod ?? null })) as unknown as Dispatch[]);
  }

  // Determine remaining qty per line (= qty - already in pending/shipped/delivered dispatches)
  function remainingQty(line: OrderItem): number {
    let inFlightOrDelivered = 0;
    for (const d of dispatches) {
      if (["pending", "shipped", "delivered"].includes(d.status)) {
        for (const di of d.items ?? []) {
          if (di.order_item_id === line.id) inFlightOrDelivered += Number(di.qty);
        }
      }
    }
    return Number(line.qty) - inFlightOrDelivered;
  }

  return (
    <Sheet open={!!order} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="max-w-4xl">
        <SheetHeader>
          <div>
            <div className="flex items-center gap-2">
              <SheetTitle className="font-mono">#{order.rupyz_order_id}</SheetTitle>
              {order.is_edited && <Badge variant="warn">edited</Badge>}
              <Badge variant={statusBadgeVariant(order.app_status)}>{order.app_status.replace(/_/g, " ")}</Badge>
            </div>
            <SheetDescription>
              Placed {new Date(order.rupyz_created_at).toLocaleString("en-IN")} · {order.source}
              {order.is_telephonic && " · telephonic"}
            </SheetDescription>
          </div>
        </SheetHeader>

        <SheetBody>
          {/* TABS */}
          <div className="flex items-center gap-1 mb-5 border-b border-paper-line -mx-1 px-1">
            <TabBtn active={tab === "current"} onClick={() => setTab("current")} icon={<FileText size={13} />}>Current</TabBtn>
            {order.is_edited && (
              <TabBtn active={tab === "original"} onClick={() => setTab("original")} icon={<FileText size={13} />}>Rupyz Original</TabBtn>
            )}
            <TabBtn active={tab === "history"} onClick={() => setTab("history")} icon={<History size={13} />}>History ({audit.length})</TabBtn>
          </div>

          {tab === "current" && (
            <CurrentTab
              order={order} items={items} dispatches={dispatches}
              loading={loading}
              editMode={editMode} editState={editState} setEditState={setEditState}
              dispatchMode={dispatchMode} setDispatchMode={setDispatchMode}
              products={products} remainingQty={remainingQty}
              me={me} reload={reload} pending={pending}
            />
          )}

          {tab === "original" && (
            <OriginalTab items={items} order={order} />
          )}

          {tab === "history" && (
            <HistoryTab audit={audit} revisions={revisions} />
          )}
        </SheetBody>

        <SheetFooter>
          <div className="text-xs text-ink-subtle mr-auto">
            Synced {new Date(order.last_synced_at).toLocaleString("en-IN")}
          </div>

          {editMode ? (
            <>
              <Button variant="outline" onClick={() => setEditMode(false)} disabled={pending}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </>
          ) : rejectMode ? (
            <>
              <Button variant="outline" onClick={() => setRejectMode(false)} disabled={pending}>Cancel</Button>
              <Button variant="danger" onClick={handleReject} disabled={pending || rejectReason.trim().length < 3}>
                {pending ? "Rejecting…" : "Confirm Reject"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Close</Button>
              {canEdit && !dispatchMode && (
                <Button variant="outline" onClick={startEdit} disabled={pending}><FileEdit size={13}/> Edit</Button>
              )}
              {canApprove && !dispatchMode && (
                <>
                  <Button variant="danger" onClick={() => setRejectMode(true)} disabled={pending}><X size={13}/> Reject</Button>
                  <Button onClick={handleApprove} disabled={pending}>
                    <Check size={13}/> {pending ? "Approving…" : "Approve"}
                  </Button>
                </>
              )}
              {canDispatch && !dispatchMode && (
                <Button onClick={() => setDispatchMode(true)} disabled={pending}>
                  <Truck size={13}/> Create Dispatch
                </Button>
              )}
            </>
          )}
        </SheetFooter>

        {rejectMode && (
          <div className="px-5 py-3 border-t border-paper-line bg-danger-soft">
            <Label className="block mb-1.5 text-danger">Reason for rejection</Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Why is this order being rejected?"
              className="bg-paper-card"
              rows={2}
              autoFocus
            />
          </div>
        )}

        {editMode && editState && (
          <div className="px-5 py-3 border-t border-paper-line bg-warn-soft">
            <Label className="block mb-1.5 text-warn">Reason for changes (required)</Label>
            <Textarea
              value={editState.comment}
              onChange={(e) => setEditState({ ...editState, comment: e.target.value })}
              placeholder="e.g. Out of stock, customer requested partial qty"
              className="bg-paper-card"
              rows={2}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 transition-colors ${active ? "border-accent text-accent" : "border-transparent text-ink-muted hover:text-ink"}`}
    >
      {icon}{children}
    </button>
  );
}

function CurrentTab({
  order, items, dispatches, loading,
  editMode, editState, setEditState,
  dispatchMode, setDispatchMode,
  products, remainingQty, me, reload, pending,
}: {
  order: Order;
  items: OrderItem[];
  dispatches: Dispatch[];
  loading: boolean;
  editMode: boolean;
  editState: EditState | null;
  setEditState: (e: EditState | null) => void;
  dispatchMode: boolean;
  setDispatchMode: (b: boolean) => void;
  products: Pick<Product, "id" | "name" | "unit" | "base_price" | "gst_percent">[];
  remainingQty: (line: OrderItem) => number;
  me: AppUser;
  reload: () => Promise<void>;
  pending: boolean;
}) {
  return (
    <>
      {/* Top summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <Card label="Customer">
          <div className="font-semibold">{order.customer?.name ?? <span className="italic text-ink-subtle">unknown</span>}</div>
          <div className="text-xs text-ink-muted mt-0.5">{order.customer?.customer_type ?? ""}</div>
          <div className="text-xs text-ink-muted">{order.delivery_mobile}</div>
        </Card>
        <Card label="Salesman">
          <div className="font-semibold">{order.salesman?.name ?? order.rupyz_created_by_name ?? "—"}</div>
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
        </Card>
      </div>

      {/* Status panel */}
      <div className="bg-paper-subtle/60 border border-paper-line rounded p-3 mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-2xs uppercase tracking-wide text-ink-subtle">App status</div>
            <div className="text-sm font-medium mt-0.5">{order.app_status.replace(/_/g, " ")}</div>
          </div>
          <div className="border-l border-paper-line pl-3">
            <div className="text-2xs uppercase tracking-wide text-ink-subtle">Rupyz status</div>
            <div className="text-sm font-medium mt-0.5">{order.rupyz_delivery_status}</div>
          </div>
        </div>
        {order.purchase_order_url && (
          <a
            href={order.purchase_order_url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-accent hover:underline inline-flex items-center gap-1"
          >
            Rupyz PO PDF <ExternalLink size={11} />
          </a>
        )}
      </div>

      {/* Items table */}
      <ItemsTable
        items={items}
        order={order}
        editMode={editMode} editState={editState} setEditState={setEditState}
        loading={loading}
        products={products}
      />

      {/* Dispatches list */}
      {(dispatches.length > 0 || dispatchMode) && (
        <div className="mt-6">
          <h3 className="text-2xs uppercase tracking-[0.2em] text-ink-subtle mb-2">Dispatches ({dispatches.length})</h3>
          {dispatches.map((d) => (
            <DispatchCard key={d.id} dispatch={d} reload={reload} me={me} pending={pending} />
          ))}
          {dispatchMode && (
            <DispatchBuilder
              order={order} items={items} remainingQty={remainingQty}
              onCancel={() => setDispatchMode(false)}
              onCreated={async () => { setDispatchMode(false); await reload(); }}
            />
          )}
        </div>
      )}
    </>
  );
}

function ItemsTable({
  items, order, editMode, editState, setEditState, loading, products,
}: {
  items: OrderItem[]; order: Order;
  editMode: boolean;
  editState: EditState | null;
  setEditState: (e: EditState | null) => void;
  loading: boolean;
  products: Pick<Product, "id" | "name" | "unit" | "base_price" | "gst_percent">[];
}) {
  function update(lineId: string, patch: Partial<{ qty: number; price: number; removed: boolean }>) {
    if (!editState) return;
    const m = new Map(editState.edits);
    const cur = m.get(lineId);
    if (!cur) return;
    m.set(lineId, { ...cur, ...patch });
    setEditState({ ...editState, edits: m });
  }
  function addEmptyAddition() {
    if (!editState) return;
    setEditState({
      ...editState,
      additions: [...editState.additions, { tempId: crypto.randomUUID(), productId: "", qty: 0, price: 0 }],
    });
  }
  function patchAddition(tempId: string, patch: Partial<{ productId: string; qty: number; price: number }>) {
    if (!editState) return;
    setEditState({
      ...editState,
      additions: editState.additions.map(a => a.tempId === tempId ? { ...a, ...patch } : a),
    });
  }
  function removeAddition(tempId: string) {
    if (!editState) return;
    setEditState({ ...editState, additions: editState.additions.filter(a => a.tempId !== tempId) });
  }

  return (
    <div className="border border-paper-line rounded overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-paper-subtle/60 border-b border-paper-line">
          <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
            <th className="px-3 py-1.5 font-medium">Product</th>
            <th className="px-3 py-1.5 font-medium text-right">Qty</th>
            <th className="px-3 py-1.5 font-medium text-right">Rate</th>
            <th className="px-3 py-1.5 font-medium text-right">GST</th>
            <th className="px-3 py-1.5 font-medium text-right">Total</th>
            {editMode && <th className="px-3 py-1.5 font-medium" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-paper-line">
          {loading ? (
            <tr><td colSpan={6} className="px-3 py-4 text-center text-ink-muted">Loading…</td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={6} className="px-3 py-4 text-center text-ink-muted">No line items.</td></tr>
          ) : (
            items.map((it) => {
              const e = editState?.edits.get(it.id);
              const removed = !!e?.removed;
              return (
                <tr key={it.id} className={removed ? "opacity-40 line-through" : ""}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{it.product_name}</div>
                    <div className="text-2xs text-ink-subtle font-mono">{it.product_code} · {it.brand}</div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editMode && !removed ? (
                      <Input
                        type="number" step="0.001" min="0"
                        value={e?.qty ?? Number(it.qty)}
                        onChange={(ev) => update(it.id, { qty: parseFloat(ev.target.value) || 0 })}
                        className="w-24 text-right tabular ml-auto"
                      />
                    ) : (
                      <span className="tabular">{it.qty} {it.unit}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {editMode && !removed ? (
                      <Input
                        type="number" step="0.01" min="0"
                        value={e?.price ?? Number(it.price)}
                        onChange={(ev) => update(it.id, { price: parseFloat(ev.target.value) || 0 })}
                        className="w-28 text-right tabular ml-auto"
                      />
                    ) : (
                      <span className="tabular">{formatINR(it.price)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-ink-muted">{it.gst_percent}%</td>
                  <td className="px-3 py-2 text-right tabular font-medium">{formatINR(it.total_price ?? 0)}</td>
                  {editMode && (
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => update(it.id, { removed: !removed })} className="text-ink-muted hover:text-danger">
                        <Trash2 size={14}/>
                      </button>
                    </td>
                  )}
                </tr>
              );
            })
          )}
          {/* Additions */}
          {editMode && editState?.additions.map((a) => (
            <tr key={a.tempId} className="bg-warn-soft/40">
              <td className="px-3 py-2">
                <Select value={a.productId} onValueChange={(v) => {
                  const p = products.find(p => p.id === v);
                  patchAddition(a.tempId, {
                    productId: v,
                    price: a.price || (p ? Number(p.base_price) : 0),
                  });
                }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Pick product…" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </td>
              <td className="px-3 py-2 text-right">
                <Input type="number" step="0.001" value={a.qty} onChange={(e) => patchAddition(a.tempId, { qty: parseFloat(e.target.value) || 0 })} className="w-24 text-right tabular ml-auto" />
              </td>
              <td className="px-3 py-2 text-right">
                <Input type="number" step="0.01" value={a.price} onChange={(e) => patchAddition(a.tempId, { price: parseFloat(e.target.value) || 0 })} className="w-28 text-right tabular ml-auto" />
              </td>
              <td className="px-3 py-2 text-right text-ink-subtle">—</td>
              <td className="px-3 py-2 text-right text-ink-subtle">—</td>
              <td className="px-3 py-2 text-right">
                <button onClick={() => removeAddition(a.tempId)} className="text-ink-muted hover:text-danger">
                  <Trash2 size={14}/>
                </button>
              </td>
            </tr>
          ))}
          {editMode && (
            <tr>
              <td colSpan={6} className="px-3 py-2">
                <Button variant="ghost" size="sm" onClick={addEmptyAddition} type="button">
                  <Plus size={12}/> Add product
                </Button>
              </td>
            </tr>
          )}
        </tbody>
        <tfoot className="bg-paper-subtle/40 border-t border-paper-line">
          <tr>
            <td colSpan={editMode ? 5 : 4} className="px-3 py-1.5 text-right text-xs text-ink-muted">Subtotal</td>
            <td className="px-3 py-1.5 text-right tabular text-sm" colSpan={editMode ? 1 : 1}>{formatINR(order.amount)}</td>
          </tr>
          <tr>
            <td colSpan={editMode ? 5 : 4} className="px-3 py-1.5 text-right text-xs text-ink-muted">
              GST ({formatINR(order.cgst_amount)} CGST + {formatINR(order.sgst_amount)} SGST)
            </td>
            <td className="px-3 py-1.5 text-right tabular text-sm">{formatINR(order.gst_amount)}</td>
          </tr>
          {Number(order.round_off_amount) !== 0 && (
            <tr>
              <td colSpan={editMode ? 5 : 4} className="px-3 py-1.5 text-right text-xs text-ink-muted">Round-off</td>
              <td className="px-3 py-1.5 text-right tabular text-sm">{formatINR(order.round_off_amount)}</td>
            </tr>
          )}
          <tr className="border-t border-paper-line">
            <td colSpan={editMode ? 5 : 4} className="px-3 py-2 text-right text-sm font-semibold">Grand total</td>
            <td className="px-3 py-2 text-right tabular text-base font-bold">{formatINR(order.total_amount)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DispatchCard({ dispatch, reload, me, pending: parentPending }: { dispatch: Dispatch; reload: () => Promise<void>; me: AppUser; pending: boolean }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<"ship" | "cancel" | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  function handleShip() {
    startTransition(async () => {
      const res = await shipDispatch(dispatch.id);
      if (res.error) toast.error(res.error);
      else { toast.success("Dispatch marked shipped"); setConfirming(null); await reload(); }
    });
  }
  function handleCancel() {
    if (cancelReason.trim().length < 3) { toast.error("Reason required"); return; }
    startTransition(async () => {
      const res = await cancelDispatch(dispatch.id, cancelReason);
      if (res.error) toast.error(res.error);
      else { toast.success("Dispatch cancelled"); setConfirming(null); setCancelReason(""); await reload(); }
    });
  }

  const canActOnDispatch = ["admin", "dispatch"].includes(me.role);
  const podPath = `/pod/${dispatch.id}`;

  const statusBadge = {
    pending:   { variant: "warn"   as const, label: "Pending" },
    shipped:   { variant: "accent" as const, label: "Shipped" },
    delivered: { variant: "ok"     as const, label: "Delivered" },
    cancelled: { variant: "danger" as const, label: "Cancelled" },
  }[dispatch.status];

  return (
    <div className="border border-paper-line rounded p-3 mb-2 bg-paper-card">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{dispatch.dispatch_number}</span>
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        </div>
        <div className="text-xs text-ink-muted">
          {dispatch.created_at && new Date(dispatch.created_at).toLocaleString("en-IN")}
        </div>
      </div>

      <div className="text-xs text-ink-muted space-y-0.5 mb-2">
        {dispatch.vehicle_number && <div>Vehicle: <span className="tabular">{dispatch.vehicle_number}</span></div>}
        {dispatch.driver_name && <div>Driver: {dispatch.driver_name} {dispatch.driver_phone && <span className="tabular">· {dispatch.driver_phone}</span>}</div>}
        <div>Total: <span className="tabular text-ink">{formatINR(dispatch.total_amount ?? 0)}</span></div>
      </div>

      <table className="w-full text-xs mb-2">
        <tbody className="divide-y divide-paper-line">
          {dispatch.items?.map((di) => (
            <tr key={di.id}>
              <td className="py-1">{di.order_item?.product_name ?? "—"}</td>
              <td className="py-1 text-right tabular">{di.qty} {di.order_item?.unit}</td>
              <td className="py-1 text-right tabular">{formatINR(di.total_amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {dispatch.pod && (
        <div className="bg-ok-soft/60 rounded p-2 mb-2 text-xs">
          <div className="flex items-center gap-2 text-ok font-medium mb-1"><MapPin size={12}/> Delivered with POD</div>
          {dispatch.pod.receiver_name && <div className="text-ink-muted">Received by: {dispatch.pod.receiver_name}</div>}
          {dispatch.pod.photo_url && <a href={dispatch.pod.photo_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">View receipt photo →</a>}
        </div>
      )}

      {confirming === "cancel" && (
        <div className="bg-danger-soft p-2 rounded mb-2">
          <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Cancel reason" className="bg-paper-card" />
          <div className="flex gap-1 mt-1.5">
            <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
            <Button size="sm" variant="danger" onClick={handleCancel} disabled={pending}>Confirm cancel</Button>
          </div>
        </div>
      )}

      {canActOnDispatch && !confirming && (
        <div className="flex gap-1 justify-end">
          {dispatch.status === "pending" && (
            <>
              <Button size="sm" variant="outline" onClick={() => setConfirming("cancel")}>Cancel</Button>
              <Button size="sm" onClick={handleShip} disabled={pending}>
                <Truck size={11}/> {pending ? "..." : "Mark shipped"}
              </Button>
            </>
          )}
          {dispatch.status === "shipped" && (
            <a href={podPath} target="_blank" rel="noopener noreferrer">
              <Button size="sm">
                <MapPin size={11}/> Capture POD
              </Button>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function DispatchBuilder({
  order, items, remainingQty, onCancel, onCreated,
}: {
  order: Order;
  items: OrderItem[];
  remainingQty: (line: OrderItem) => number;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [qtys, setQtys] = useState<Map<string, number>>(new Map());
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  const eligible = items.filter(it => remainingQty(it) > 0);

  function set(id: string, v: number) {
    const m = new Map(qtys);
    m.set(id, v);
    setQtys(m);
  }

  function handleCreate() {
    const lines = Array.from(qtys.entries())
      .filter(([, q]) => q > 0)
      .map(([orderItemId, qty]) => ({ orderItemId, qty }));
    if (!lines.length) { toast.error("Pick at least one line item"); return; }

    startTransition(async () => {
      const res = await createDispatch(order.id, lines, {
        vehicleNumber: vehicle.trim() || undefined,
        driverName: driver.trim() || undefined,
        driverPhone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (res.error) toast.error(res.error);
      else { toast.success(`Dispatch ${res.dispatchNumber} created`); onCreated(); }
    });
  }

  return (
    <div className="border border-accent rounded p-3 mb-2 bg-accent-soft/40 mt-3">
      <h4 className="font-semibold text-sm mb-3">Create new dispatch</h4>

      {eligible.length === 0 ? (
        <p className="text-sm text-ink-muted">All items already fully dispatched.</p>
      ) : (
        <table className="w-full text-xs mb-3">
          <thead>
            <tr className="text-left text-2xs uppercase text-ink-muted">
              <th className="py-1">Product</th>
              <th className="py-1 text-right">Available</th>
              <th className="py-1 text-right">Dispatch qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-line">
            {eligible.map(it => {
              const avail = remainingQty(it);
              return (
                <tr key={it.id}>
                  <td className="py-1.5">{it.product_name}</td>
                  <td className="py-1.5 text-right tabular">{avail} {it.unit}</td>
                  <td className="py-1.5 text-right">
                    <Input
                      type="number" step="0.001" min="0" max={avail}
                      value={qtys.get(it.id) ?? 0}
                      onChange={(e) => set(it.id, Math.min(avail, parseFloat(e.target.value) || 0))}
                      className="w-24 text-right tabular ml-auto bg-paper-card"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <Label className="block mb-1 text-2xs">Vehicle</Label>
          <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="MH 21 AB 1234" className="bg-paper-card" />
        </div>
        <div>
          <Label className="block mb-1 text-2xs">Driver</Label>
          <Input value={driver} onChange={(e) => setDriver(e.target.value)} className="bg-paper-card" />
        </div>
        <div>
          <Label className="block mb-1 text-2xs">Driver phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="bg-paper-card tabular" />
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button onClick={handleCreate} disabled={pending || eligible.length === 0}>
          {pending ? "Creating…" : "Create dispatch"}
        </Button>
      </div>
    </div>
  );
}

function OriginalTab({ items, order }: { items: OrderItem[]; order: Order }) {
  // The Rupyz original is captured in order_items.rupyz_raw + order's purchase_order_url
  // We'll show the rupyz_raw values — these are immutable from sync.
  return (
    <div>
      <p className="text-sm text-ink-muted mb-3">
        This is what the salesman placed via Rupyz, before any edits in our system.
      </p>
      <div className="border border-paper-line rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper-subtle/60 border-b border-paper-line">
            <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-1.5 font-medium">Product</th>
              <th className="px-3 py-1.5 font-medium text-right">Qty</th>
              <th className="px-3 py-1.5 font-medium text-right">Rate</th>
              <th className="px-3 py-1.5 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-line">
            {items.map((it) => {
              const raw = (it as unknown as { rupyz_raw: { qty?: number; price?: number; total_price?: number; name?: string; code?: string } | null }).rupyz_raw;
              if (!raw) {
                return (
                  <tr key={it.id} className="text-ink-subtle italic">
                    <td className="px-3 py-2">{it.product_name} (no Rupyz snapshot — added in our app)</td>
                    <td colSpan={3}/>
                  </tr>
                );
              }
              return (
                <tr key={it.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{raw.name ?? it.product_name}</div>
                    <div className="text-2xs text-ink-subtle font-mono">{raw.code ?? it.product_code}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular">{raw.qty ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular">{formatINR(raw.price ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular">{formatINR(raw.total_price ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {order.purchase_order_url && (
        <a
          href={order.purchase_order_url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-accent hover:underline mt-3"
        >
          Open Rupyz PO PDF <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

function HistoryTab({ audit, revisions }: { audit: OrderAuditEvent[]; revisions: OrderRevision[] }) {
  if (audit.length === 0 && revisions.length === 0) {
    return <p className="text-sm text-ink-muted">No history yet — order arrived from Rupyz, no actions taken.</p>;
  }
  // Merge audit + revisions chronologically
  const merged = [
    ...audit.map(a => ({ kind: "audit" as const, at: a.created_at, data: a })),
    ...revisions.map(r => ({ kind: "revision" as const, at: r.edited_at, data: r })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="space-y-2">
      {merged.map((m, i) => {
        if (m.kind === "audit") {
          const a = m.data;
          return (
            <div key={i} className="border-l-2 border-accent pl-3 py-1">
              <div className="text-sm font-medium">{labelFor(a.event_type)}</div>
              <div className="text-2xs text-ink-muted">{new Date(a.created_at).toLocaleString("en-IN")} · {a.actor_name ?? "system"}</div>
              {a.comment && <div className="text-xs text-ink mt-0.5">{a.comment}</div>}
              {a.details && <pre className="text-2xs text-ink-subtle bg-paper-subtle/60 rounded p-1.5 mt-1 overflow-auto">{JSON.stringify(a.details, null, 2)}</pre>}
            </div>
          );
        } else {
          const r = m.data;
          return (
            <div key={i} className="border-l-2 border-warn pl-3 py-1">
              <div className="text-sm font-medium">Revision #{r.revision_number}</div>
              <div className="text-2xs text-ink-muted">{new Date(r.edited_at).toLocaleString("en-IN")} · {r.edited_by_name ?? "—"}</div>
              {r.change_summary && <div className="text-xs text-ink mt-0.5">{r.change_summary}</div>}
            </div>
          );
        }
      })}
    </div>
  );
}

function labelFor(eventType: string): string {
  const map: Record<string, string> = {
    approved: "Approved",
    rejected: "Rejected",
    edited: "Edited",
    dispatch_created: "Dispatch created",
    dispatch_shipped: "Dispatch shipped",
    dispatch_delivered: "Dispatch delivered",
    dispatch_cancelled: "Dispatch cancelled",
    order_cancelled: "Order cancelled",
    order_closed: "Order closed",
  };
  return map[eventType] ?? eventType;
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-paper-line rounded p-3">
      <div className="text-2xs uppercase tracking-wide text-ink-subtle mb-1.5">{label}</div>
      {children}
    </div>
  );
}
