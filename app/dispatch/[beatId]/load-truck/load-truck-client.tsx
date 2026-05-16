"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Truck, CheckSquare, Square, ChevronDown, ChevronRight, MapPin, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/context";
import { dispatchSelectedOrders } from "@/app/(app)/dispatches/actions";

interface OrderItem {
  id: string;
  rupyzOrderId: string;
  totalAmount: number;
  appStatus: string;
  customerName: string;
  customerCity: string | null;
  kg: number;
}

interface BeatGroup {
  beatId: string;
  beatName: string;
  orders: OrderItem[];
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
}

type Step = "pick" | "details";

interface UserOption {
  id: string;
  name: string;
  phone: string | null;
}

export function LoadTruckWizard({
  beatGroups, focusBeatId, drivers, helpers,
}: {
  beatGroups: BeatGroup[];
  focusBeatId: string | null;
  drivers: UserOption[];
  helpers: UserOption[];
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("pick");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [expandedBeats, setExpandedBeats] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (focusBeatId) s.add(focusBeatId);
    else if (beatGroups.length <= 2) for (const b of beatGroups) s.add(b.beatId);
    return s;
  });

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

  const allOrdersFlat = useMemo(() => {
    const m = new Map<string, { beatName: string; order: OrderItem }>();
    for (const g of beatGroups) for (const o of g.orders) m.set(o.id, { beatName: g.beatName, order: o });
    return m;
  }, [beatGroups]);

  const selectedOrders = useMemo(
    () => Array.from(selected).map(id => allOrdersFlat.get(id)).filter((x): x is { beatName: string; order: OrderItem } => !!x),
    [selected, allOrdersFlat],
  );
  const totalKg     = selectedOrders.reduce((s, x) => s + x.order.kg, 0);
  const totalAmount = selectedOrders.reduce((s, x) => s + x.order.totalAmount, 0);

  function toggleOne(id: string) {
    setSelected(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }
  function toggleBeatExpanded(beatId: string) {
    setExpandedBeats(prev => {
      const s = new Set(prev);
      if (s.has(beatId)) s.delete(beatId);
      else s.add(beatId);
      return s;
    });
  }

  function selectAllInBeat(beatId: string) {
    const beat = beatGroups.find(b => b.beatId === beatId);
    if (!beat) return;
    setSelected(prev => {
      const s = new Set(prev);
      for (const o of beat.orders) s.add(o.id);
      return s;
    });
  }
  function clearBeat(beatId: string) {
    const beat = beatGroups.find(b => b.beatId === beatId);
    if (!beat) return;
    setSelected(prev => {
      const s = new Set(prev);
      for (const o of beat.orders) s.delete(o.id);
      return s;
    });
  }
  function clearAll() { setSelected(new Set()); }

  function handleConfirm() {
    if (!vehicle.trim()) {
      toast.error(t("truck_wizard.toast_vehicle_required"));
      return;
    }
    if (driverMode === "registered" && !driverId) {
      toast.error(t("truck_wizard.toast_pick_driver_or_other"));
      return;
    }
    if (!driver.trim()) {
      toast.error(t("truck_wizard.toast_driver_required"));
      return;
    }
    startTransition(async () => {
      const res = await dispatchSelectedOrders({
        orderIds: Array.from(selected),
        vehicleNumber: vehicle.trim(),
        driverName: driver.trim(),
        driverPhone: driverPhone.trim() || undefined,
        driverUserId: driverMode === "registered" ? driverId : undefined,
        helperUserId: helperId || undefined,
        notes: notes.trim() || undefined,
      });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      const firstFailureErr = res.results?.find(r => !r.ok)?.error;
      if (res.succeeded === 0) {
        toast.error(firstFailureErr ?? t("truck_wizard.toast_all_failed", { total: res.total }), {
          duration: 12000,
          description: firstFailureErr ? t("truck_wizard.toast_n_of_m_failed", { failed: res.failed, total: res.total }) : undefined,
        });
        return;
      }
      if (res.failed && res.failed > 0) {
        toast.warning(
          t("truck_wizard.toast_n_of_m_dispatched", { succeeded: res.succeeded, total: res.total, failed: res.failed }),
          { description: firstFailureErr, duration: 10000 },
        );
      } else {
        const msg = res.succeeded === 1
          ? t("truck_wizard.toast_succeeded_one", { n: res.succeeded })
          : t("truck_wizard.toast_succeeded_many", { n: res.succeeded });
        toast.success(msg);
      }
      router.push(`/dispatch`);
    });
  }

  const selectedHelper = helpers.find(h => h.id === helperId);

  // ============ STEP 1: PICK ============
  if (step === "pick") {
    const totalAvailableOrders = beatGroups.reduce((s, b) => s + b.orders.length, 0);

    return (
      <div className="min-h-screen bg-paper pb-24">
        <div className="max-w-md mx-auto px-3 py-4">
          <Link href="/dispatch" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2">
            <ArrowLeft size={11}/> {t("truck_wizard.cancel")}
          </Link>

          <div className="text-2xs text-accent mb-1">{t("truck_wizard.step_1_of_2")}</div>
          <h1 className="text-base font-semibold leading-tight">
            {t("truck_wizard.which_orders")}
          </h1>
          <p className="text-xs text-ink-muted mt-0.5">
            {t("truck_wizard.pick_help")}
          </p>

          {selected.size > 0 && (
            <div className="flex items-center gap-3 mt-3 mb-1 text-xs">
              <button type="button" onClick={clearAll} className="text-ink-muted hover:underline">
                {t("truck_wizard.clear_all_selections")}
              </button>
            </div>
          )}

          {totalAvailableOrders === 0 ? (
            <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center mt-4">
              <p className="text-sm font-semibold mb-0.5">{t("truck_wizard.nothing_to_load")}</p>
              <p className="text-xs text-ink-muted">{t("truck_wizard.no_approved_now")}</p>
            </div>
          ) : (
            <div className="space-y-2 mt-3">
              {beatGroups.map(group => {
                const isExpanded = expandedBeats.has(group.beatId);
                const beatSelectedCount = group.orders.filter(o => selected.has(o.id)).length;
                const beatTotalKg = group.orders.reduce((s, o) => s + (selected.has(o.id) ? o.kg : 0), 0);
                const allInBeatSelected = beatSelectedCount === group.orders.length;
                const availableLabel = group.orders.length === 1
                  ? t("truck_wizard.n_orders_available_one", { n: group.orders.length })
                  : t("truck_wizard.n_orders_available_many", { n: group.orders.length });

                return (
                  <div
                    key={group.beatId}
                    className="bg-paper-card border border-paper-line rounded-md overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleBeatExpanded(group.beatId)}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-paper-subtle/50 transition-colors text-left"
                    >
                      <div className="shrink-0">
                        {isExpanded
                          ? <ChevronDown size={14} className="text-ink-muted"/>
                          : <ChevronRight size={14} className="text-ink-muted"/>
                        }
                      </div>
                      <div className="w-7 h-7 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
                        <MapPin size={12}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{group.beatName}</div>
                        <div className="text-2xs text-ink-muted mt-0.5">
                          {beatSelectedCount > 0
                            ? <><span className="text-accent tabular font-semibold">{t("truck_wizard.n_of_m_selected", { n: beatSelectedCount, m: group.orders.length })}</span> · <span className="tabular">{formatKg(beatTotalKg)}</span></>
                            : <>{availableLabel}</>
                          }
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-paper-line divide-y divide-paper-line">
                        <div className="px-3 py-1.5 bg-paper-subtle/40 flex items-center gap-3 text-2xs">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); allInBeatSelected ? clearBeat(group.beatId) : selectAllInBeat(group.beatId); }}
                            className="text-accent hover:underline"
                          >
                            {allInBeatSelected ? t("truck_wizard.clear_this_beat") : t("truck_wizard.select_all_in_beat")}
                          </button>
                        </div>

                        {group.orders.map(o => {
                          const isSelected = selected.has(o.id);
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => toggleOne(o.id)}
                              className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
                                isSelected ? "bg-accent-soft/30" : "hover:bg-paper-subtle/40"
                              }`}
                            >
                              <div className="shrink-0">
                                {isSelected
                                  ? <CheckSquare size={16} className="text-accent"/>
                                  : <Square size={16} className="text-ink-subtle"/>
                                }
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{o.customerName}</div>
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
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-paper-card/95 backdrop-blur border-t border-paper-line p-3">
          <div className="max-w-md mx-auto">
            <div className="text-2xs text-center text-ink-muted mb-1.5">
              {selected.size === 0
                ? t("truck_wizard.tap_to_select_truck")
                : <><strong className="text-ink tabular">{selected.size}</strong> · <strong className="text-ink tabular">{formatKg(totalKg)}</strong> · <strong className="text-ink tabular">{formatINR(totalAmount)}</strong></>
              }
            </div>
            <Button
              className="w-full"
              size="lg"
              disabled={selected.size === 0}
              onClick={() => setStep("details")}
            >
              {t("truck_wizard.next_truck_details")} <ArrowRight size={14}/>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ============ STEP 2: DETAILS ============
  const selectedByBeat = new Map<string, { beatName: string; orders: OrderItem[] }>();
  for (const x of selectedOrders) {
    const key = x.beatName;
    if (!selectedByBeat.has(key)) selectedByBeat.set(key, { beatName: x.beatName, orders: [] });
    selectedByBeat.get(key)!.orders.push(x.order);
  }
  const previewGroups = Array.from(selectedByBeat.values()).sort((a, b) => a.beatName.localeCompare(b.beatName));
  const orderWordSingle = t("common.order");
  const orderWordPlural = t("common.orders");

  return (
    <div className="min-h-screen bg-paper pb-24">
      <div className="max-w-md mx-auto px-3 py-4">
        <button
          type="button"
          onClick={() => setStep("pick")}
          className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft size={11}/> {t("truck_wizard.back_to_selection")}
        </button>

        <div className="text-2xs text-accent mb-1">{t("truck_wizard.step_2_of_2")}</div>
        <h1 className="text-base font-semibold leading-tight">{t("truck_wizard.truck_details")}</h1>
        <p className="text-xs text-ink-muted mt-0.5">
          {selected.size === 1
            ? t("truck_wizard.loading_n_orders_one", { n: selected.size })
            : t("truck_wizard.loading_n_orders_many", { n: selected.size })} ·
          {" "}<strong className="text-ink tabular">{formatKg(totalKg)}</strong> ·
          {" "}<strong className="text-ink tabular">{formatINR(totalAmount)}</strong>
          {previewGroups.length > 1 && <> · {t("truck_wizard.across_n_beats", { n: previewGroups.length })}</>}
        </p>

        <div className="mt-4">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold mb-2">
            {t("truck_wizard.orders_on_truck")}
          </h2>
          <div className="space-y-2">
            {previewGroups.map(g => (
              <div key={g.beatName} className="bg-paper-card border border-paper-line rounded overflow-hidden">
                <div className="px-3 py-1.5 bg-paper-subtle/40 text-2xs font-semibold text-ink-muted uppercase tracking-wide">
                  {g.beatName} · {g.orders.length} {g.orders.length === 1 ? orderWordSingle : orderWordPlural}
                </div>
                <div className="divide-y divide-paper-line">
                  {g.orders.map(o => (
                    <div key={o.id} className="px-3 py-2 flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium truncate flex-1">{o.customerName}</span>
                      <span className="text-2xs text-ink-muted tabular shrink-0">
                        {formatKg(o.kg)} · {formatINR(o.totalAmount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-paper-line space-y-3">
          <h2 className="text-xs uppercase tracking-wide text-ink-muted font-semibold">
            {t("truck_wizard.vehicle_and_driver")}
          </h2>
          <div>
            <Label className="text-xs">{t("truck_wizard.vehicle_label")} <span className="text-danger">*</span></Label>
            <Input
              className="mt-1"
              placeholder="MH-20 AB 1234"
              value={vehicle}
              onChange={e => setVehicle(e.target.value)}
              autoFocus
            />
          </div>
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
                  {t("truck_wizard.helper_will_see", { name: selectedHelper.name, n: selected.size })}
                </p>
              )}
            </div>
          ) : (
            <div className="text-2xs text-ink-subtle">
              <em>{t("truck_wizard.no_helpers_configured")}</em>
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
          <Button
            className="w-full"
            size="lg"
            onClick={handleConfirm}
            disabled={pending || !vehicle.trim() || !driver.trim()}
          >
            <Truck size={14}/> {pending
              ? t("truck_wizard.dispatching")
              : selected.size === 1
                ? t("truck_wizard.dispatch_n_orders_one", { n: selected.size })
                : t("truck_wizard.dispatch_n_orders_many", { n: selected.size })}
          </Button>
        </div>
      </div>
    </div>
  );
}
