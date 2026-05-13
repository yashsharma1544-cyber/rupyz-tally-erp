"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Truck, Package, UserPlus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { bulkDispatchByBeat } from "@/app/(app)/dispatches/actions";

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
  beat, orders, helpers, isNoBeatTile,
}: {
  beat: { id: string; name: string };
  orders: OrderItem[];
  helpers: UserOption[];
  isNoBeatTile?: boolean;
}) {
  const router = useRouter();
  const [showBulk, setShowBulk] = useState(false);
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [helperId, setHelperId] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const canBulk = vehicle.trim().length > 0 && driver.trim().length > 0;

  const totalOrders = orders.length;
  const totalKg     = orders.reduce((s, o) => s + o.kg, 0);
  const totalAmount = orders.reduce((s, o) => s + o.totalAmount, 0);

  const selectedHelper = helpers.find(h => h.id === helperId);

  function handleBulk() {
    if (!canBulk) {
      toast.error("Vehicle # and driver name are required");
      return;
    }
    if (!confirm(`Dispatch all ${totalOrders} orders for ${beat.name}? This creates ${totalOrders} dispatch records, all with the same vehicle/driver${helperId ? "/helper" : ""}.`)) return;
    startTransition(async () => {
      const res = await bulkDispatchByBeat({
        beatId: beat.id,
        vehicleNumber: vehicle.trim(),
        driverName: driver.trim(),
        driverPhone: driverPhone.trim() || undefined,
        helperUserId: helperId || undefined,
      });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      const firstFailureErr = res.results?.find(r => !r.ok)?.error;
      if (res.succeeded === 0) {
        toast.error(firstFailureErr ?? `All ${res.total} dispatches failed`, {
          duration: 12000,
          description: firstFailureErr ? `${res.failed} of ${res.total} orders failed` : undefined,
        });
        return;
      }
      if (res.failed && res.failed > 0) {
        toast.warning(
          `${res.succeeded} of ${res.total} dispatched · ${res.failed} failed`,
          { description: firstFailureErr, duration: 10000 },
        );
      } else {
        toast.success(`${res.succeeded} orders dispatched`);
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
          <ArrowLeft size={11}/> All beats
        </Link>
        <h1 className="text-base font-bold leading-tight inline-flex items-center gap-1.5">
          {isNoBeatTile && <AlertTriangle size={14} className="text-warn"/>}
          {beat.name}
        </h1>
        <p className="text-2xs text-ink-muted mb-3">
          {totalOrders} order{totalOrders === 1 ? "" : "s"} · {formatKg(totalKg)} · {formatINR(totalAmount)}
        </p>

        {/* Warning banner for no-beat tile */}
        {isNoBeatTile && (
          <div className="bg-warn-soft border border-warn/40 rounded-md p-2.5 mb-3 text-xs">
            <div className="font-semibold inline-flex items-center gap-1 mb-1">
              <AlertTriangle size={11} className="text-warn"/> Customers without beat assignment
            </div>
            <p className="text-ink-muted">
              These customers don&apos;t belong to any beat yet. Dispatch them one at a time below, or use &ldquo;Load a truck&rdquo; to pick them.
              Fix beat assignment in <Link href="/customers" className="text-accent hover:underline">Customers</Link>.
            </p>
          </div>
        )}

        {totalOrders > 0 && (
          <>
            {/* Bulk dispatch only works for real beats — bulkDispatchByBeat needs a real beat_id.
                For no-beat tile, skip this button. */}
            {!isNoBeatTile && (
              <Button
                className="w-full mb-2"
                onClick={() => setShowBulk(true)}
                disabled={pending}
              >
                <Truck size={13}/> Dispatch all {totalOrders} orders
              </Button>
            )}
            <Link
              href={`/dispatch/load-truck${!isNoBeatTile ? `?beat=${beat.id}` : ""}`}
              className="w-full mb-3 inline-flex items-center justify-center gap-1.5 h-10 rounded-md border border-accent/40 text-accent text-sm font-medium hover:bg-accent-soft active:bg-accent-soft/80 transition-colors"
            >
              <Truck size={13}/> Load a truck (pick orders)
            </Link>
          </>
        )}

        {orders.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
            <Package size={28} className="mx-auto text-ink-subtle mb-2"/>
            <p className="font-semibold text-sm mb-0.5">Nothing to dispatch in this beat</p>
            <p className="text-xs text-ink-muted">When admin approves orders, they&apos;ll show here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-2xs uppercase tracking-wide text-ink-muted">
              {isNoBeatTile ? "Dispatch one at a time" : "Or dispatch one at a time"}
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
                      {o.appStatus === "partially_dispatched" && <> · <span className="text-warn">partly sent</span></>}
                      {o.appStatus === "loaded" && <> · <span className="text-accent">loaded</span></>}
                    </div>
                    <div className="text-2xs text-ink-muted mt-0.5">
                      <span className="tabular"><strong className="text-ink">{formatKg(o.kg)}</strong></span>
                      <span className="text-ink-subtle"> · </span>
                      <span className="tabular">{formatINR(o.totalAmount)}</span>
                      <span className="text-ink-subtle"> · </span>
                      <span>{o.itemCount} item{o.itemCount === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-ink-subtle shrink-0"/>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {showBulk && !isNoBeatTile && (
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
              <h2 className="font-semibold">Dispatch all orders</h2>
            </div>
            <p className="text-xs text-ink-muted mb-3">
              Creates {totalOrders} dispatch{totalOrders === 1 ? "" : "es"} with full quantities, all with the same vehicle{helperId ? ", driver, and helper" : " and driver"}.
            </p>

            <Label className="text-2xs uppercase tracking-wide text-ink-muted">Vehicle # *</Label>
            <Input
              className="mt-1 mb-3"
              placeholder="MH-20 AB 1234"
              value={vehicle}
              onChange={e => setVehicle(e.target.value)}
              autoFocus
            />

            <Label className="text-2xs uppercase tracking-wide text-ink-muted">Driver name *</Label>
            <Input
              className="mt-1 mb-3"
              placeholder="e.g. Ramesh"
              value={driver}
              onChange={e => setDriver(e.target.value)}
            />

            <Label className="text-2xs uppercase tracking-wide text-ink-muted">Driver phone (optional)</Label>
            <Input
              className="mt-1 mb-4"
              placeholder="9876543210"
              inputMode="tel"
              value={driverPhone}
              onChange={e => setDriverPhone(e.target.value)}
            />

            {helpers.length > 0 ? (
              <>
                <Label className="text-2xs uppercase tracking-wide text-ink-muted inline-flex items-center gap-1">
                  <UserPlus size={10}/> Helper (optional)
                </Label>
                <select
                  className="w-full mt-1 mb-1 px-3 py-2 text-sm bg-paper-card border border-paper-line rounded focus:outline-none focus:ring-2 focus:ring-accent/30"
                  value={helperId}
                  onChange={(e) => setHelperId(e.target.value)}
                >
                  <option value="">— No helper —</option>
                  {helpers.map(h => (
                    <option key={h.id} value={h.id}>
                      {h.name}{h.phone ? ` · ${h.phone}` : ""}
                    </option>
                  ))}
                </select>
                {selectedHelper && (
                  <p className="text-2xs text-ink-muted mb-3">
                    {selectedHelper.name} will see all {totalOrders} dispatches.
                  </p>
                )}
                {!selectedHelper && <div className="mb-3"/>}
              </>
            ) : (
              <p className="text-2xs text-ink-subtle italic mb-3">
                No helpers configured. Add helpers in Users with role &lsquo;van_helper&rsquo;.
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="ghost"
                onClick={() => setShowBulk(false)}
                disabled={pending}
                className="sm:flex-1"
              >
                Cancel
              </Button>
              <Button
                disabled={!canBulk || pending}
                onClick={handleBulk}
                className="sm:flex-1"
              >
                <Truck size={11}/> {pending ? "Dispatching…" : `Dispatch ${totalOrders}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
