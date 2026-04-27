"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Truck, Clock, ChevronRight, Search, RefreshCw, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import type { AppUser, VanTrip, VanTripStatus } from "@/lib/types";
import { toast } from "sonner";

type TripWithBeat = VanTrip & {
  beat?: { id: string; name: string } | null;
  lead?: { id: string; full_name: string } | null;
};

function statusBadge(s: VanTripStatus): { variant: "neutral" | "ok" | "warn" | "danger" | "accent"; label: string } {
  return {
    planning:    { variant: "warn"   as const, label: "Planning" },
    loading:     { variant: "warn"   as const, label: "Ready to start" },
    in_progress: { variant: "accent" as const, label: "On Route" },
    returned:    { variant: "warn"   as const, label: "Awaiting Reconcile" },
    reconciled:  { variant: "ok"     as const, label: "Reconciled" },
    cancelled:   { variant: "danger" as const, label: "Cancelled" },
  }[s];
}

export function VanHome({ me }: { me: AppUser }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [trips, setTrips] = useState<TripWithBeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function reload(opts: { silent?: boolean } = {}) {
    if (!opts.silent) setLoading(true);
    const { data, error } = await supabase
      .from("van_trips")
      .select("*, beat:beats(id,name), lead:app_users!van_trips_lead_id_fkey(id,full_name)")
      .order("trip_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) toast.error(error.message);
    else setTrips((data ?? []) as unknown as TripWithBeat[]);
    if (!opts.silent) setLoading(false);
  }

  useEffect(() => {
    reload();
    // Refresh on focus / visibility return — silent (no loading state) so the
    // trip list doesn't blank out for half a second every time the user
    // switches tabs back.
    function onFocus() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      reload({ silent: true });
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // For van_lead: only show trips they're the lead of (or admin sees all)
  const myTrips = useMemo(() => {
    if (me.role === "admin") return trips;
    return trips.filter(t => t.lead_id === me.id);
  }, [trips, me]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return myTrips;
    return myTrips.filter(t =>
      t.trip_number.toLowerCase().includes(q) ||
      t.beat?.name?.toLowerCase().includes(q) ||
      t.lead?.full_name?.toLowerCase().includes(q),
    );
  }, [myTrips, search]);

  const onRoute  = filtered.filter(t => t.status === "in_progress");
  const ready    = filtered.filter(t => t.status === "loading" || t.status === "planning");
  const awaiting = filtered.filter(t => t.status === "returned");
  const recent   = filtered.filter(t => t.status === "reconciled" || t.status === "cancelled").slice(0, 5);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        {/* Header */}
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold leading-tight">VAN</h1>
            <p className="text-xs text-ink-muted">Hi, {me.full_name.split(" ")[0]}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => reload()} className="p-2 text-ink-muted hover:text-ink" aria-label="Refresh" disabled={loading}>
              <RefreshCw size={15} className={loading ? "animate-spin" : ""}/>
            </button>
            <button onClick={handleSignOut} className="p-2 text-ink-muted hover:text-ink" aria-label="Sign out">
              <LogOut size={15}/>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search trip / beat…"
            className="pl-8"
          />
        </div>

        {loading && trips.length === 0 ? (
          <div className="text-center text-sm text-ink-muted py-12">Loading trips…</div>
        ) : myTrips.length === 0 ? (
          <div className="text-center bg-paper-card border border-paper-line rounded-md p-8 mt-6">
            <Truck size={28} className="mx-auto mb-3 text-ink-subtle"/>
            <h2 className="font-semibold mb-1">No trips assigned to you</h2>
            <p className="text-xs text-ink-muted">
              Trips will appear here once admin creates one with you as the lead.
            </p>
          </div>
        ) : (
          <>
            <Section title="On route" subtitle="Tap to bill" trips={onRoute} variant="primary"/>
            <Section title="Ready to start" subtitle="Verify load and start" trips={ready} variant="primary"/>
            <Section title="Awaiting reconciliation" subtitle="Office only" trips={awaiting} variant="muted"/>
            <Section title="Recent" trips={recent} variant="muted" collapsed/>
          </>
        )}
      </div>

      <div className="text-2xs text-center text-ink-subtle pb-4">
        {me.role} · v0.4 · {me.email}
      </div>
    </div>
  );
}

function Section({
  title, subtitle, trips, variant, collapsed,
}: {
  title: string;
  subtitle?: string;
  trips: TripWithBeat[];
  variant: "primary" | "muted";
  collapsed?: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsed);
  if (trips.length === 0) return null;
  return (
    <div className="mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-baseline justify-between mb-2"
      >
        <div className="text-left">
          <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold">{title}</h2>
          {subtitle && expanded && <p className="text-2xs text-ink-subtle">{subtitle}</p>}
        </div>
        <span className="text-2xs text-ink-muted">
          {trips.length} {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {trips.map(t => <TripCard key={t.id} trip={t} variant={variant}/>)}
        </div>
      )}
    </div>
  );
}

function TripCard({ trip, variant }: { trip: TripWithBeat; variant: "primary" | "muted" }) {
  const sb = statusBadge(trip.status);
  const isOnRoute = trip.status === "in_progress";
  const isReady   = trip.status === "loading" || trip.status === "planning";

  // Where to navigate:
  //   in_progress → /van/[tripId] (mobile billing app)
  //   loading/planning → /van/[tripId]/start (pre-trip start view)
  //   else → desktop trip detail (read-only on phone, but admin may still want it)
  const href = isOnRoute
    ? `/van/${trip.id}`
    : isReady
      ? `/van/${trip.id}/start`
      : `/trips/${trip.id}`;

  const dateLabel = new Date(trip.trip_date).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const dim = variant === "muted" ? "opacity-70" : "";

  return (
    <Link
      href={href}
      className={`block bg-paper-card border rounded-md p-3 ${dim} ${
        isOnRoute ? "border-accent/40 bg-accent-soft/30" : "border-paper-line"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="font-mono text-xs text-ink-muted">{trip.trip_number}</span>
        <Badge variant={sb.variant}>{sb.label}</Badge>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm">{trip.beat?.name ?? "—"}</div>
          <div className="text-2xs text-ink-muted">
            {dateLabel}
            {trip.lead && <> · {trip.lead.full_name}</>}
          </div>
        </div>
        {(isOnRoute || isReady) && (
          <ChevronRight size={16} className={isOnRoute ? "text-accent" : "text-ink-muted"} />
        )}
      </div>
      {isOnRoute && (
        <div className="mt-2 inline-flex items-center gap-1 text-2xs text-accent font-medium">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-75 animate-ping"></span>
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent"></span>
          </span>
          Live · tap to bill
        </div>
      )}
      {isReady && (
        <div className="mt-2 inline-flex items-center gap-1 text-2xs text-warn font-medium">
          <Clock size={10}/> Tap to verify load and start
        </div>
      )}
    </Link>
  );
}
