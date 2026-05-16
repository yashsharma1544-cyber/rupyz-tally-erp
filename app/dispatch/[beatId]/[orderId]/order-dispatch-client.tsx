"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Truck, Minus, Plus, Pencil, X, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/context";
import { createDispatch } from "@/app/(app)/dispatches/actions";

interface OrderLine {
  id: string;
  productName: string;
  orderedQty: number;
  alreadyDispatched: number;
  remaining: number;
  price: number;
  unit: string | null;
}

interface OrderForDispatch {
  id: string;
  rupyzOrderId: string;
  totalAmount: number;
  appStatus: string;
  customer: { id: string; name: string; city: string | null; mobile: string | null } | null;
  items: OrderLine[];
}

interface UserOption {
  id: string;
  name: string;
  phone: string | null;
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export function OrderDispatchClient({
  beatId, order, drivers, helpers,
}: {
  beatId: string;
  order: OrderForDispatch;
  drivers: UserOption[];
  helpers: UserOption[];
}) {
  const router = useRouter();
  const { t } = useTranslation();

  const [qtys, setQtys] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const it of order.items) m.set(it.id, it.remaining);
    return m;
  });
  const [editMode, setEditMode] = useState(false);

  const [vehicle, setVehicle] = useState("");

  const [driverMode, setDriverMode] = useState<"registered" | "adhoc">(
    drivers.length > 0 ? "registered" : "adhoc"
  );
  const [driverId, setDriverId] = useState<string>("");
  const [driver, setDriver] = useState("");
  const [driverPhone, setDriverPhone] = useState("");

  const [helperId, setHelperId] = useState<string>("");

  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  function pickRegisteredDriver(id: string) {
    setDriverId(id);
    const d = drivers.find(x => x.id === id);
    if (d) {
      setDriver(d.name);
      setDriverPhone(d.phone ?? "");
    }
  }

  function setQty(itemId: string, qty: number) {
    setQtys(prev => {
      const m = new Map(prev);
      m.set(itemId, Math.max(0, qty));
      return m;
    });
  }
  function bumpQty(itemId: string, delta: number, max: number) {
    setQtys(prev => {
      const m = new Map(prev);
      const cur = m.get(itemId) ?? 0;
      m.set(itemId, Math.min(max, Math.max(0, cur + delta)));
      return m;
    });
  }

  const dispatchableLines = useMemo(
    () => order.items
      .map(it => ({ orderItemId: it.id, qty: qtys.get(it.id) ?? 0, line: it }))
      .filter(l => l.qty > 0),
    [order.items, qtys],
  );

  const totalAmt = useMemo(
    () => dispatchableLines.reduce((s, l) => s + l.line.price * l.qty, 0),
    [dispatchableLines],
  );

  const isPartial = useMemo(() => {
    return order.items.some(it => {
      if (it.remaining <= 0) return false;
      return (qtys.get(it.id) ?? 0) < it.remaining;
    });
  }, [order.items, qtys]);

  const canDispatch =
    vehicle.trim().length > 0 &&
    driver.trim().length > 0 &&
    (driverMode === "adhoc" || !!driverId) &&
    dispatchableLines.length > 0;

  function handleConfirm() {
    if (!canDispatch) {
      toast.error(t("beat.toast_vehicle_driver_required"));
      return;
    }
    startTransition(async () => {
      const res = await createDispatch(
        order.id,
        dispatchableLines.map(l => ({ orderItemId: l.orderItemId, qty: l.qty })),
        {
          vehicleNumber: vehicle.trim(),
          driverName: driver.trim(),
          driverPhone: driverPhone.trim() || undefined,
          driverUserId: driverMode === "registered" ? driverId : undefined,
          helperUserId: helperId || undefined,
          notes: notes.trim() || undefined,
        },
      );
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(t("order_dispatch.toast_dispatched", { dispatchNumber: res.dispatchNumber }));
      router.push(`/dispatch/${beatId}`);
    });
  }

  const itemCount = order.items.filter(it => it.remaining > 0).length;
  const selectedHelper = helpers.find(h => h.id === helperId);
  const itemsLabel = itemCount === 1 ? t("common.item") : t("common.items");

  return (
    <div className="min-h-screen bg-paper pb-24">
      <div className="max-w-md mx-auto px-3 py-4">
        <Link href={`/dispatch/${beatId}`} className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> {t("common.back")}
        </Link>

        <h1 className="text-lg font-semibold leading-tight">{order.customer?.name ?? "—"}</h1>
        <div className="text-xs text-ink-muted mt-0.5">
          {[order.customer?.city, order.customer?.mobile].filter(Boolean).join(" · ")}
        </div>
        <div className="text-2xs font-mono text-ink-subtle mt-0.5">{order.rupyzOrderId}</div>

        <div className="mt-3 pb-3 border-b border-paper-line text-sm">
          <span className="font-semibold tabular">{itemCount}</span>
          <span className="text-ink-muted"> {itemsLabel} · </span>
          <span className="font-semibold tabular">{formatINR(totalAmt)}</span>
          {order.appStatus === "partially_dispatched" && (
            <span className="ml-2 text-2xs text-warn">· {t("order_dispatch.partly_sent_already")}</span>
          )}
          {order.appStatus === "loaded" && (
            <span className="ml-2 text-2xs text-accent">· {t("order_dispatch.loaded_by_warehouse")}</span>
          )}
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold">
              {t("order_dispatch.items_in_order")}
            </h2>
            {!editMode ? (
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className="text-xs text-accent inline-flex items-center gap-1 hover:underline"
              >
                <Pencil size={10}/> {t("order_dispatch.edit_quantities")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const m = new Map<string, number>();
                  for (const it of order.items) m.set(it.id, it.remaining);
                  setQtys(m);
                  setEditMode(false);
                }}
                className="text-xs text-ink-muted inline-flex items-center gap-1 hover:underline"
              >
                <X size={10}/> {t("order_dispatch.reset_all")}
              </button>
            )}
          </div>

          <div className="bg-paper-card border border-paper-line rounded divide-y divide-paper-line">
            {order.items.map(it => {
              const dispatching = qtys.get(it.id) ?? 0;
              const max = it.remaining;
              const noRemaining = max <= 0;

              return (
                <div key={it.id} className={`px-3 py-2.5 ${noRemaining ? "opacity-50" : ""}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-medium text-sm flex-1 min-w-0">{it.productName}</div>
                    {!editMode && (
                      <div className="text-sm font-semibold tabular shrink-0">
                        {dispatching}
                        {it.unit && <span className="text-2xs text-ink-muted ml-0.5">{it.unit}</span>}
                      </div>
                    )}
                  </div>

                  {!editMode && noRemaining && (
                    <div className="text-2xs text-ok mt-0.5">{t("order_dispatch.fully_sent_earlier")}</div>
                  )}

                  {editMode && !noRemaining && (
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => bumpQty(it.id, -1, max)}
                        disabled={dispatching <= 0}
                        className="w-9 h-9 rounded border border-paper-line flex items-center justify-center disabled:opacity-30 active:bg-paper-subtle"
                        aria-label={t("order_dispatch.decrease_aria")}
                      >
                        <Minus size={14}/>
                      </button>
                      <Input
                        inputMode="decimal"
                        className="text-center font-mono tabular flex-1 max-w-[100px]"
                        value={dispatching}
                        onChange={(e) => {
                          const n = parseFloat(e.target.value);
                          if (Number.isFinite(n)) setQty(it.id, Math.min(max, n));
                          else if (e.target.value === "") setQty(it.id, 0);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => bumpQty(it.id, 1, max)}
                        disabled={dispatching >= max}
                        className="w-9 h-9 rounded border border-paper-line flex items-center justify-center disabled:opacity-30 active:bg-paper-subtle"
                        aria-label={t("order_dispatch.increase_aria")}
                      >
                        <Plus size={14}/>
                      </button>
                      <span className="text-2xs text-ink-muted whitespace-nowrap">
                        {t("order_dispatch.n_max", { max })}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {order.items.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-ink-muted">
                {t("order_dispatch.no_line_items")}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-paper-line space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold">
            {t("truck_wizard.truck_details")}
          </h2>
          <div>
            <Label className="text-xs">{t("truck_wizard.vehicle_label")} <span className="text-danger">*</span></Label>
            <Input
              className="mt-1"
              placeholder="MH-20 AB 1234"
              value={vehicle}
              onChange={e => setVehicle(e.target.value)}
            />
          </div>

          {/* DRIVER */}
          <div>
            <Label className="text-xs">{t("truck_wizard.driver_label")} <span className="text-danger">*</span></Label>
            {drivers.length > 0 && (
              <div className="flex items-center gap-2 mt-1 mb-1.5 text-2xs">
                <button
                  type="button"
                  onClick={() => setDriverMode("registered")}
                  className={`px-2 py-1 rounded border transition-colors ${
                    driverMode === "registered"
                      ? "border-accent bg-accent text-paper-card"
                      : "border-paper-line bg-paper-card hover:bg-paper-subtle"
                  }`}
                >
                  {t("truck_wizard.pick_driver")}
                </button>
                <button
                  type="button"
                  onClick={() => { setDriverMode("adhoc"); setDriverId(""); setDriver(""); setDriverPhone(""); }}
                  className={`px-2 py-1 rounded border transition-colors ${
                    driverMode === "adhoc"
                      ? "border-accent bg-accent text-paper-card"
                      : "border-paper-line bg-paper-card hover:bg-paper-subtle"
                  }`}
                >
                  {t("truck_wizard.other_driver")}
                </button>
              </div>
            )}

            {driverMode === "registered" && drivers.length > 0 ? (
              <select
                className="w-full mt-1 px-3 py-2 text-sm bg-paper-card border border-paper-line rounded focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={driverId}
                onChange={(e) => pickRegisteredDriver(e.target.value)}
              >
                <option value="">{t("truck_wizard.select_driver_placeholder")}</option>
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}{d.phone ? ` · ${d.phone}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                className="mt-1"
                placeholder={t("truck_wizard.driver_eg")}
                value={driver}
                onChange={e => setDriver(e.target.value)}
              />
            )}
          </div>

          <div>
            <Label className="text-xs text-ink-muted">{t("truck_wizard.driver_phone_label")}</Label>
            <Input
              className="mt-1"
              placeholder={driverMode === "registered" && driverId ? "" : t("truck_wizard.driver_phone_placeholder")}
              inputMode="tel"
              value={driverPhone}
              onChange={e => setDriverPhone(e.target.value)}
              disabled={driverMode === "registered" && !!driverId}
            />
          </div>

          {/* HELPER (optional) */}
          {helpers.length > 0 ? (
            <div>
              <Label className="text-xs inline-flex items-center gap-1">
                <UserPlus size={11}/> {t("truck_wizard.helper_label")}
                <span className="text-2xs text-ink-subtle font-normal">{t("common.optional_paren")}</span>
              </Label>
              <select
                className="w-full mt-1 px-3 py-2 text-sm bg-paper-card border border-paper-line rounded focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={helperId}
                onChange={(e) => setHelperId(e.target.value)}
              >
                <option value="">{t("truck_wizard.no_helper_placeholder")}</option>
                {helpers.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.name}{h.phone ? ` · ${h.phone}` : ""}
                  </option>
                ))}
              </select>
              {selectedHelper && (
                <p className="text-2xs text-ink-muted mt-1">
                  {t("order_dispatch.helper_will_see_delivery", { name: selectedHelper.name })}
                </p>
              )}
            </div>
          ) : (
            <div className="text-2xs text-ink-subtle">
              <em>{t("order_dispatch.no_helpers_users_invite")}</em>
            </div>
          )}

          <div>
            <Label className="text-xs text-ink-muted">{t("truck_wizard.notes_label")}</Label>
            <Textarea
              className="mt-1"
              rows={2}
              placeholder={t("truck_wizard.notes_placeholder")}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-paper-card/95 backdrop-blur border-t border-paper-line p-3">
        <div className="max-w-md mx-auto">
          {isPartial && dispatchableLines.length > 0 && (
            <p className="text-2xs text-warn text-center mb-2">
              {t("order_dispatch.some_reduced_warn")}
            </p>
          )}
          <Button
            className="w-full"
            size="lg"
            onClick={handleConfirm}
            disabled={!canDispatch || pending}
          >
            <Truck size={14}/>
            {pending
              ? t("truck_wizard.dispatching")
              : isPartial
                ? t("order_dispatch.confirm_partial_amt", { amount: formatINR(totalAmt) })
                : t("order_dispatch.dispatch_full_amt", { amount: formatINR(totalAmt) })}
          </Button>
        </div>
      </div>
    </div>
  );
}
