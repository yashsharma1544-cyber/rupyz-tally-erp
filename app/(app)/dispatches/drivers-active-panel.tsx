"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Truck, Clock, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface ActiveDriver {
  driver_user_id: string;
  driver_name: string;
  driver_phone: string;
  loading_count: number;
  shipped_count: number;
  vehicle_numbers: string[] | null;
  total_amount: number;
  oldest_at: string;
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * Embeddable panel that lists drivers with currently-active dispatches.
 * Refreshes every 30s. Click a driver to filter to their trips.
 */
export function DriversActivePanel() {
  const [drivers, setDrivers] = useState<ActiveDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function fetchDrivers() {
      const { data, error } = await supabase.rpc("drivers_active_now");
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      setDrivers((data ?? []) as ActiveDriver[]);
      setError(null);
      setLoading(false);
    }

    fetchDrivers();
    const interval = setInterval(fetchDrivers, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
        <p className="text-xs text-ink-muted">Loading active drivers…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-4">
        <p className="text-xs text-danger">Couldn&apos;t load drivers: {error}</p>
      </div>
    );
  }

  if (drivers.length === 0) {
    return null; // hide entirely when nobody's active
  }

  return (
    <div className="mb-4">
      <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold mb-2 inline-flex items-center gap-1.5">
        <Truck size={11}/> Drivers active now
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {drivers.map(d => {
          const vehiclesLabel = (d.vehicle_numbers ?? []).join(", ") || "—";
          return (
            <Link
              key={d.driver_user_id}
              href={`/trucks?driver=${d.driver_user_id}`}
              className="bg-paper-card border border-paper-line rounded-md p-3 hover:bg-paper-subtle/40 active:bg-paper-subtle transition-colors block"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
                  <Truck size={11}/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{d.driver_name || "(no name)"}</div>
                  {d.driver_phone && (
                    <div className="text-2xs text-ink-muted font-mono">{d.driver_phone}</div>
                  )}
                </div>
                <ChevronRight size={12} className="text-ink-subtle shrink-0"/>
              </div>
              <div className="text-2xs text-ink-muted font-mono truncate mb-1">
                {vehiclesLabel}
              </div>
              <div className="text-2xs flex items-center gap-2 flex-wrap">
                {d.loading_count > 0 && (
                  <span className="text-warn">
                    <strong className="tabular">{d.loading_count}</strong> loading
                  </span>
                )}
                {d.shipped_count > 0 && (
                  <span className="text-accent">
                    <strong className="tabular">{d.shipped_count}</strong> en route
                  </span>
                )}
                <span className="text-ink-subtle">·</span>
                <span className="text-ink-muted tabular">{formatINR(d.total_amount)}</span>
              </div>
              {d.oldest_at && (
                <div className="text-2xs text-ink-subtle mt-1 inline-flex items-center gap-1">
                  <Clock size={9}/> oldest: {formatRelative(d.oldest_at)}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
