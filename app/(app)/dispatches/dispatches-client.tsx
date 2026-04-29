"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Truck, MapPin, Eye, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { Dispatch, AppUser, DispatchStatus } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { toast } from "sonner";
import { shipDispatch } from "./actions";

function statusBadge(s: DispatchStatus): { variant: "neutral" | "ok" | "warn" | "danger" | "accent"; label: string } {
  return {
    pending:   { variant: "warn"   as const, label: "Pending" },
    shipped:   { variant: "accent" as const, label: "In transit" },
    delivered: { variant: "ok"     as const, label: "Delivered" },
    cancelled: { variant: "danger" as const, label: "Cancelled" },
  }[s];
}

export function DispatchesClient({ me }: { me: AppUser }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusF, setStatusF] = useState<string>("active"); // pending+shipped by default
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let q = supabase
        .from("dispatches")
        .select("*, order:orders(id, rupyz_order_id, customer_id, delivery_city, customer:customers(id,name,city,mobile)), pod:pods(*)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (statusF === "active") {
        q = q.in("status", ["pending", "shipped"]);
      } else if (statusF !== "all") {
        q = q.eq("status", statusF);
      }
      const { data, error } = await q;
      if (cancelled) return;
      if (error) toast.error(error.message);
      else setRows(((data ?? []) as unknown as (Dispatch & { pod: unknown })[])
        .map((d) => ({ ...d, pod: Array.isArray(d.pod) ? d.pod[0] ?? null : d.pod ?? null })) as unknown as Dispatch[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, statusF, reloadKey]);

  const canActOnDispatch = ["admin", "dispatch"].includes(me.role);

  return (
    <div className="p-3 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Select value={statusF} onValueChange={setStatusF}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active (pending + transit)</SelectItem>
            <SelectItem value="pending">Pending only</SelectItem>
            <SelectItem value="shipped">In transit only</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-ink-muted ml-auto">{rows.length} dispatches</div>
      </div>

      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-paper-subtle/60 border-b border-paper-line">
            <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-2 font-medium">Dispatch #</th>
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Vehicle / Driver</th>
              <th className="px-3 py-2 font-medium text-right">Total</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-line">
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-ink-muted">
                  <Package size={28} className="mx-auto mb-2 text-ink-subtle"/>
                  No dispatches yet. Approve some orders, then create a dispatch from the order detail.
                </td>
              </tr>
            ) : rows.map((d) => {
              const sb = statusBadge(d.status);
              return (
                <DispatchRow
                  key={d.id} d={d} sb={sb}
                  canAct={canActOnDispatch}
                  onChange={() => setReloadKey(k => k + 1)}
                />
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function DispatchRow({
  d, sb, canAct, onChange,
}: {
  d: Dispatch;
  sb: { variant: "neutral" | "ok" | "warn" | "danger" | "accent"; label: string };
  canAct: boolean;
  onChange: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleShip() {
    startTransition(async () => {
      const res = await shipDispatch(d.id);
      if (res.error) toast.error(res.error);
      else { toast.success(`Dispatch ${d.dispatch_number} shipped`); onChange(); }
    });
  }

  return (
    <tr className="hover:bg-paper-subtle/40">
      <td className="px-3 py-2 font-mono text-xs">{d.dispatch_number}</td>
      <td className="px-3 py-2">
        <Link href="/orders" className="text-accent hover:underline font-mono text-xs">
          {d.order?.rupyz_order_id ?? "—"}
        </Link>
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{d.order?.customer?.name ?? "—"}</div>
        <div className="text-2xs text-ink-subtle">{d.order?.customer?.city}</div>
      </td>
      <td className="px-3 py-2 text-xs text-ink-muted">
        {d.vehicle_number && <div className="tabular">{d.vehicle_number}</div>}
        {d.driver_name && <div>{d.driver_name}</div>}
      </td>
      <td className="px-3 py-2 text-right tabular font-medium">{formatINR(d.total_amount ?? 0)}</td>
      <td className="px-3 py-2">
        <Badge variant={sb.variant}>{sb.label}</Badge>
      </td>
      <td className="px-3 py-2 text-right">
        {canAct && d.status === "pending" && (
          <Button size="sm" onClick={handleShip} disabled={pending}>
            <Truck size={11}/> {pending ? "..." : "Ship"}
          </Button>
        )}
        {d.status === "shipped" && (
          <a href={`/pod/${d.id}`} target="_blank" rel="noopener noreferrer">
            <Button size="sm"><MapPin size={11}/> POD</Button>
          </a>
        )}
        {d.status === "delivered" && d.pod?.photo_url && (
          <a href={d.pod.photo_url} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline"><Eye size={11}/> Receipt</Button>
          </a>
        )}
      </td>
    </tr>
  );
}
