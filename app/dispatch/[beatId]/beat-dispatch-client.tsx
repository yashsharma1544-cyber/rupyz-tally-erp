"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Truck, Package, UserPlus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/context";
import { bulkDispatchByBeat, dispatchSelectedOrders } from "@/app/(app)/dispatches/actions";
import { AutoRefresh } from "@/components/auto-refresh";

interface OrderItem {
  id: string;
  rupyzOrderId: string;
  totalAmount: number;
  appStatus: string;
  customerName: string;
  customerCity: string | null;
  kg: number;
  itemCount: number;
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
function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
}

export function BeatDispatchClient({
  beat, orders, drivers, helpers, isNoBeatTile,
}: {
  beat: { id: string; name: string };
  orders: OrderItem[];
  drivers: UserOption[];
  helpers: UserOption[];
  isNoBeatTile?: boolean;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [showBulk, setShowBulk] = useState(false);
  const [vehicle, setVehicle] = useState("");

  const [driverMode, setDriverMode] = useState<"registered" | "adhoc">(
    drivers.length > 0 ? "registered" : "adhoc"
  );
  const [driverId, setDriverId] = useState<string>("");
  const [driver, setDriver] = useState("");
  const [driverPhone, setDriverPhone] = useState("");

  const [helperId, setHelperId] = useState<string>("");
  const [pending, startTransition] = useTransition();

  function pickRegisteredDriver(id: string) {
    setDriverId(id);
    const d = drivers.find(x => x.id === id);
    if (d) {
      setDriver(d.name);
      setDriverPhone(d.phone ?? "");
    }
  }

  const canBulk =
    vehicle.trim().length > 0 &&
    driver.trim().length > 0 &&
    (driverMode === "adhoc" || !!driverId);

  const totalOrders = orders.length;
  const totalKg     = orders.reduce((s, o) => s + o.kg, 0);
  const totalAmount = orders.reduce((s, o) => s + o.totalAmount, 0);

  const selectedHelper = helpers.find(h => h.id === helperId);
  const orderWordSingle = t("common.order");
  const orderWordPlural = t("common.orders");

  function handleBulk() {
    if (!canBulk) {
      toast.error(t("beat.toast_vehicle_driver_required"));
      return;
    }
    const confirmMsg = helperId
      ? t("beat.bulk_confirm_with_helper", { n: totalOrders, beat: beat.name })
      : t("beat.bulk_confirm", { n: totalOrders, beat: beat.name });
    if (!confirm(confirmMsg)) return;

    startTransition(async () => {
      let res;
      if (isNoBeatTile) {
        res = await dispatchSelectedOrders({
          orderIds: orders.map(o => o.id),
          vehicleNumber: vehicle.trim(),
          driverName: driver.trim(),
          driverPhone: driverPhone.trim() || undefined,
          driverUserId: driverMode === "registered" ? driverId : undefined,
          helperUserId: helperId || undefined,
        });
      } else {
        res = await bulkDispatchByBeat({
          beatId: beat.id,
          vehicleNumber: vehicle.trim(),
          driverName: driver.trim(),
          driverPhone: driverPhone.trim() || undefined,
          driverUserId: driverMode === "registered" ? driverId : undefined,
          helperUserId: helperId || undefined,
        });
      }

      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      const firstFailureErr = res.results?.find(r => !r.ok)?.error;
      const total     = res.total     ?? 0;
      const succeeded = res.succeeded ?? 0;
      const failed    = res.failed    ?? 0;
      if (succeeded === 0) {
        toast.error(firstFailureErr ?? t("truck_wizard.toast_all_failed", { total }), {
          duration: 12000,
          description: firstFailureErr ? t("truck_wizard.toast_n_of_m_failed", { failed, total }) : undefined,
        });
        return;
      }
      if (failed > 0) {
        toast.warning(
          t("truck_wizard.toast_n_of_m_dispatched", { succeeded, total, failed }),
          { description: firstFailureErr, duration: 10000 },
        );
      } else {
        const msg = succeeded === 1
          ? t("truck_wizard.toast_succeeded_one", { n: succeeded })
          : t("truck_wizard.toast_succeeded_many", { n: succeeded });
        toast.success(msg);
      }
      setShowBulk(false);
      router.refresh();
      router.push("/dispatch");
    });
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <Link href="/dispatch" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
          <ArrowLeft size={11}/> {t("beat.all_beats")}
        </Link>
        <h1 className="text-base font-bold leading-tight inline-flex items-center gap-1.5">
          {isNoBeatTile && <AlertTriangle size={14} className="text-warn"/>}
          {beat.name}
        </h1>
        <p className="text-2xs text-ink-muted mb-3">
          {totalOrders} {totalOrders === 1 ? orderWordSingle : orderWordPlural} · {formatKg(totalKg)} · {formatINR(totalAmount)}
        </p>

        {isNoBeatTile && (
          <div className="bg-warn-soft border border-warn/40 rounded-md p-2.5 mb-3 text-xs">
            <div className="font-semibold inline-flex items-center gap-1 mb-1">
              <AlertTriangle size={11} className="text-warn"/> {t("beat.no_beat_warn_title")}
            </div>
            <p className="text-ink-muted">
              {t("beat.no_beat_warn_body", { customersLink: "__CUSTOMERS_LINK__" }).split("__CUSTOMERS_LINK__").map((part, i, arr) => (
                <span key={i}>
                  {part}
                  {i < arr.length - 1 && (
                    <Link href="/customers" className="text-accent hover:underline">{t("beat.customers_link")}</Link>
                  )}
                </span>
              ))}
            </p>
          </div>
        )}

        {totalOrders > 0 && (
          <>
            <Button
              className="w-full mb-2"
              onClick={() => setShowBulk(true)}
              disabled={pending}
            >
              <Truck size={13}/> {totalOrders === 1
                ? t("beat.dispatch_all_n_one", { n: totalOrders })
                : t("beat.dispatch_all_n_many", { n: totalOrders })}
            </Button>
            <Link
              href={`/dispatch/load-truck${!isNoBeatTile ? `?beat=${beat.id}` : ""}`}
              className="w-full mb-3 inline-flex items-center justify-center gap-1.5 h-10 rounded-md border border-accent/40 text-accent text-sm font-medium hover:bg-accent-soft active:bg-accent-soft/80 transition-colors"
            >
              <Truck size={13}/> {t("beat.load_truck_pick")}
            </Link>
          </>
        )}

        {orders.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
            <Package size={28} className="mx-auto text-ink-subtle mb-2"/>
            <p className="font-semibold text-sm mb-0.5">{t("beat.nothing_in_beat")}</p>
            <p className="text-xs text-ink-muted">{t("beat.empty_desc")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-2xs uppercase tracking-wide text-ink-muted">
              {t("beat.or_dispatch_one")}
            </p>
            {orders.map(o => (
              <Link
                key={o.id}
                href={`/dispatch/${beat.id}/${o.id}`}
                className="block bg-paper-card border border-paper-line rounded-md p-3 hover:bg-paper-subtle/40 active:bg-paper-subtle transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{o.customerName}</div>
                    <div className="text-2xs text-ink-muted mt-0.5">
                      <span className="font-mono">{o.rupyzOrderId}</span>
                      {o.customerCity && <> · {o.customerCity}</>}
                      {o.appStatus === "partially_dispatched" && <> · <span className="text-warn">{t("status.partly_sent_inline")}</span></>}
                      {o.appStatus === "loaded" && <> · <span className="text-accent">{t("status.loaded_inline")}</span></>}
                    </div>
                    <div className="text-2xs text-ink-muted mt-0.5">
                      <span className="tabular"><strong className="text-ink">{formatKg(o.kg)}</strong></span>
                      <span className="text-ink-subtle"> · </span>
                      <span className="tabular">{formatINR(o.totalAmount)}</span>
                      <span className="text-ink-subtle"> · </span>
                      <span>{o.itemCount} {o.itemCount === 1 ? t("common.item") : t("common.items")}</span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-ink-subtle shrink-0"/>
                </div>
              </Link>
            ))}
          </div>
        )}

        <AutoRefresh />
      </div>

      {showBulk && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center"
          onClick={() => !pending && setShowBulk(false)}
        >
          <div
            className="bg-paper-card border border-paper-line rounded-t-lg sm:rounded-lg shadow-xl w-full sm:max-w-sm p-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <Truck size={16} className="text-accent"/>
              <h2 className="font-semibold">{t("beat.bulk_title")}</h2>
            </div>
            <p className="text-xs text-ink-muted mb-3">
              {helperId
                ? (totalOrders === 1
                  ? t("beat.bulk_desc_with_helper_one", { n: totalOrders })
                  : t("beat.bulk_desc_with_helper_many", { n: totalOrders }))
                : (totalOrders === 1
                  ? t("beat.bulk_desc_one", { n: totalOrders })
                  : t("beat.bulk_desc_many", { n: totalOrders }))}
            </p>

            <Label className="text-2xs uppercase tracking-wide text-ink-muted">{t("truck_wizard.vehicle_label")} *</Label>
            <Input
              className="mt-1 mb-3"
              placeholder="MH-20 AB 1234"
              value={vehicle}
              onChange={e => setVehicle(e.target.value)}
              autoFocus
            />

            <Label className="text-2xs uppercase tracking-wide text-ink-muted">{t("truck_wizard.driver_label")} *</Label>
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
                className="w-full mt-1 mb-3 px-3 py-2 text-sm bg-paper-card border border-paper-line rounded focus:outline-none focus:ring-2 focus:ring-accent/30"
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
                className="mt-1 mb-3"
                placeholder={t("truck_wizard.driver_eg")}
                value={driver}
                onChange={e => setDriver(e.target.value)}
              />
            )}

            <Label className="text-2xs uppercase tracking-wide text-ink-muted">{t("truck_wizard.driver_phone_label")} {t("common.optional_paren")}</Label>
            <Input
              className="mt-1 mb-4"
              placeholder={driverMode === "registered" && driverId ? "" : "9876543210"}
              inputMode="tel"
              value={driverPhone}
              onChange={e => setDriverPhone(e.target.value)}
              disabled={driverMode === "registered" && !!driverId}
            />

            {helpers.length > 0 ? (
              <>
                <Label className="text-2xs uppercase tracking-wide text-ink-muted inline-flex items-center gap-1">
                  <UserPlus size={10}/> {t("truck_wizard.helper_label")} {t("common.optional_paren")}
                </Label>
                <select
                  className="w-full mt-1 mb-1 px-3 py-2 text-sm bg-paper-card border border-paper-line rounded focus:outline-none focus:ring-2 focus:ring-accent/30"
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
                  <p className="text-2xs text-ink-muted mb-3">
                    {t("beat.helper_will_see_n", { name: selectedHelper.name, n: totalOrders })}
                  </p>
                )}
                {!selectedHelper && <div className="mb-3"/>}
              </>
            ) : (
              <p className="text-2xs text-ink-subtle italic mb-3">
                {t("beat.no_helpers_add")}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="ghost"
                onClick={() => setShowBulk(false)}
                disabled={pending}
                className="sm:flex-1"
              >
                {t("common.cancel")}
              </Button>
              <Button
                disabled={!canBulk || pending}
                onClick={handleBulk}
                className="sm:flex-1"
              >
                <Truck size={11}/> {pending ? t("truck_wizard.dispatching") : t("beat.dispatch_n", { n: totalOrders })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
