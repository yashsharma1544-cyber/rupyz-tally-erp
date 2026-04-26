"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { VanTrip, VanTripStatus, AppUser } from "@/lib/types";
import { toast } from "sonner";

function statusBadge(s: VanTripStatus): { variant: "neutral" | "ok" | "warn" | "danger" | "accent"; label: string } {
  return {
    planning:    { variant: "warn"    as const, label: "Planning" },
    loading:     { variant: "warn"    as const, label: "Loading" },
    in_progress: { variant: "accent"  as const, label: "On Route" },
    returned:    { variant: "warn"    as const, label: "Awaiting Reconcile" },
    reconciled:  { variant: "ok"      as const, label: "Reconciled" },
    cancelled:   { variant: "danger"  as const, label: "Cancelled" },
  }[s];
}

export function TripsClient({ me }: { me: AppUser }) {
  void me;
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<VanTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusF, setStatusF] = useState<string>("active");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let q = supabase.from("van_trips")
        .select("*, beat:beats(id,name), lead:app_users!van_trips_lead_id_fkey(id,full_name)")
        .order("trip_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100);
      if (statusF === "active") q = q.in("status", ["planning", "loading", "in_progress", "returned"]);
      else if (statusF !== "all") q = q.eq("status", statusF);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) toast.error(error.message);
      else setRows((data ?? []) as unknown as VanTrip[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase, statusF]);

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Select value={statusF} onValueChange={setStatusF}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active (in progress / open)</SelectItem>
            <SelectItem value="planning">Planning</SelectItem>
            <SelectItem value="in_progress">On Route</SelectItem>
            <SelectItem value="returned">Awaiting Reconcile</SelectItem>
            <SelectItem value="reconciled">Reconciled</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-ink-muted ml-auto">{rows.length} trips</div>
      </div>

      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper-subtle/60 border-b border-paper-line">
            <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-2 font-medium">Trip #</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Beat</th>
              <th className="px-3 py-2 font-medium">Vehicle</th>
              <th className="px-3 py-2 font-medium">Lead</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-line">
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-muted">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-ink-muted">
                  <Truck size={28} className="mx-auto mb-2 text-ink-subtle"/>
                  No trips yet. Click "New Trip" to plan one.
                </td>
              </tr>
            ) : rows.map((t) => {
              const sb = statusBadge(t.status);
              return (
                <tr key={t.id} className="hover:bg-paper-subtle/40">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/trips/${t.id}`} className="text-accent hover:underline">{t.trip_number}</Link>
                  </td>
                  <td className="px-3 py-2 tabular text-ink-muted text-xs">
                    {new Date(t.trip_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{t.beat?.name ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-muted">
                    <div className="capitalize">{t.vehicle_type}</div>
                    {t.vehicle_number && <div className="tabular text-2xs">{t.vehicle_number}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {t.lead?.full_name ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={sb.variant}>{sb.label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Helpful hints for empty/in-progress states */}
      {rows.some(t => t.status === "in_progress") && (
        <div className="mt-3 text-xs text-ink-muted">
          <Truck size={11} className="inline mr-1"/> Trips on route — open the trip to use the mobile billing app at <code className="text-accent">/van/&lt;tripId&gt;</code>
        </div>
      )}
    </div>
  );
}
