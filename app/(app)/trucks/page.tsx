// =============================================================================
// /trucks — list of completed truck-trips with "View route" actions.
//
// A truck-trip is one (vehicle, driver, date) grouping. Shows totals and a
// "View route on map" link that opens Google Maps with all the delivered
// stops as waypoints (in chronological order of POD capture).
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, Truck, Calendar, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TruckTrip {
  vehicle_number: string;
  driver_name: string;
  driver_user_id: string | null;
  trip_date: string; // YYYY-MM-DD
  dispatch_count: number;
  delivered_count: number;
  with_gps_count: number;
  total_qty: number;
  total_amount: number;
  earliest_at: string;
  latest_at: string;
}

interface DispatchPodRow {
  id: string;
  vehicle_number: string | null;
  driver_name: string | null;
  shipped_at: string | null;
  created_at: string;
  status: string;
  pod: { latitude: number | null; longitude: number | null; captured_at: string | null } | { latitude: number | null; longitude: number | null; captured_at: string | null }[] | null;
  order: { rupyz_order_id: string; customer: { name: string } | { name: string }[] | null } | { rupyz_order_id: string; customer: { name: string } | { name: string }[] | null }[] | null;
}

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// Build a Google Maps URL that draws a route through the given lat/long stops.
// Google Maps directions URL supports up to 9 intermediate waypoints (10 total).
// If we have more, we fall back to a search URL with all points pinned.
function buildMapUrl(points: Array<{ lat: number; lng: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${points[0].lat},${points[0].lng}`;
  }
  // Up to 10 points → real directions
  if (points.length <= 10) {
    const origin = `${points[0].lat},${points[0].lng}`;
    const destination = `${points[points.length - 1].lat},${points[points.length - 1].lng}`;
    const waypoints = points.slice(1, -1).map(p => `${p.lat},${p.lng}`).join("|");
    let url = `https://www.google.com/maps/dir/?api2=1&origin=${origin}&destination=${destination}&travelmode=driving`;
    if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
    return url;
  }
  // More than 10 → fallback to a /maps/dir/ path with first 10 (Google can show all)
  // Actually best: /maps/dir/lat,lng/lat,lng/... which supports many points
  const path = points.map(p => `${p.lat},${p.lng}`).join("/");
  return `https://www.google.com/maps/dir/${path}`;
}

export default async function TrucksPage({
  searchParams,
}: {
  searchParams: Promise<{ driver?: string }>;
}) {
  const { driver: filterDriverId } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/trucks");

  const { data: me } = await supabase.from("app_users").select("role, active").eq("id", user.id).single();
  if (!me?.active || !["admin", "dispatch", "accounts"].includes(me.role)) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">This page is for admin, dispatch, and accounts.</p>
      </div>
    );
  }

  // If filtering by driver, look up their name for the header
  let filterDriverName: string | null = null;
  if (filterDriverId) {
    const { data: drv } = await supabase
      .from("app_users")
      .select("full_name")
      .eq("id", filterDriverId)
      .maybeSingle();
    filterDriverName = drv?.full_name ?? "(unknown driver)";
  }

  const { data: trips, error } = await supabase.rpc("truck_trips");
  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm font-semibold mb-1">Couldn&apos;t load truck trips</p>
        <p className="text-xs text-ink-muted">{error.message}</p>
      </div>
    );
  }
  const allTripRows = (trips ?? []) as TruckTrip[];
  const tripRows = filterDriverId
    ? allTripRows.filter(t => t.driver_user_id === filterDriverId)
    : allTripRows;

  // For each trip, fetch the dispatches + POD points in chronological order
  // so we can build a route URL. We do one query for all dispatches with GPS
  // in this date range, then group in JS.
  const { data: rawDispatches } = await supabase
    .from("dispatches")
    .select(`
      id, vehicle_number, driver_name, shipped_at, created_at, status,
      pod:pods(latitude, longitude, captured_at),
      order:orders(rupyz_order_id, customer:customers(name))
    `)
    .eq("status", "delivered")
    .order("created_at", { ascending: true });

  const dispatchesByKey = new Map<string, DispatchPodRow[]>();
  for (const d of (rawDispatches ?? []) as unknown as DispatchPodRow[]) {
    const tripDate = (d.shipped_at ?? d.created_at).slice(0, 10);
    const key = `${d.vehicle_number ?? ""}::${d.driver_name ?? ""}::${tripDate}`;
    if (!dispatchesByKey.has(key)) dispatchesByKey.set(key, []);
    dispatchesByKey.get(key)!.push(d);
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Link href="/dashboard" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
          <ArrowLeft size={11}/> Dashboard
        </Link>

        <h1 className="text-xl font-semibold leading-tight mb-1 inline-flex items-center gap-2">
          <Truck size={18} className="text-accent"/> Truck trips
        </h1>
        <p className="text-sm text-ink-muted mb-5">
          Each card is a (truck, driver, day). View the delivery route on a map.
        </p>

        {filterDriverId && filterDriverName && (
          <div className="bg-accent-soft border border-accent/30 rounded-md px-3 py-2 mb-4 flex items-baseline justify-between gap-2 flex-wrap">
            <p className="text-xs">
              Showing trips for <strong className="text-accent">{filterDriverName}</strong>
            </p>
            <Link href="/trucks" className="text-2xs text-accent hover:underline">
              Clear filter
            </Link>
          </div>
        )}

        {tripRows.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
            <p className="text-sm font-semibold mb-0.5">No truck trips yet</p>
            <p className="text-xs text-ink-muted">As trucks deliver, they&apos;ll appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tripRows.map(t => {
              const key = `${t.vehicle_number}::${t.driver_name}::${t.trip_date}`;
              const dispatchList = dispatchesByKey.get(key) ?? [];
              // Get POD points sorted by captured_at
              const points = dispatchList
                .map(d => {
                  const pod = Array.isArray(d.pod) ? d.pod[0] : d.pod;
                  if (!pod || pod.latitude == null || pod.longitude == null) return null;
                  return { lat: pod.latitude, lng: pod.longitude, capturedAt: pod.captured_at ?? "" };
                })
                .filter((p): p is { lat: number; lng: number; capturedAt: string } => !!p)
                .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

              const mapUrl = points.length > 0 ? buildMapUrl(points.map(p => ({ lat: p.lat, lng: p.lng }))) : "";
              const customerNames = dispatchList.slice(0, 4).map(d => {
                const order = Array.isArray(d.order) ? d.order[0] : d.order;
                const c = order?.customer ? (Array.isArray(order.customer) ? order.customer[0] : order.customer) : null;
                return c?.name ?? "—";
              });

              return (
                <div
                  key={key}
                  className="bg-paper-card border border-paper-line rounded-md p-3.5"
                >
                  <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
                    <div className="font-semibold text-sm font-mono">
                      {t.vehicle_number || "(no vehicle)"}
                    </div>
                    <div className="text-2xs text-ink-muted inline-flex items-center gap-1">
                      <Calendar size={9}/> {fmtDate(t.trip_date)}
                    </div>
                  </div>
                  <div className="text-xs text-ink-muted mb-2">
                    Driver: <strong className="text-ink">{t.driver_name || "(no driver)"}</strong>
                  </div>
                  <div className="text-2xs text-ink-muted mb-2.5 flex flex-wrap gap-x-2">
                    <span className="tabular"><strong className="text-ink">{Number(t.delivered_count)}</strong> delivered</span>
                    {Number(t.dispatch_count) > Number(t.delivered_count) && (
                      <span className="tabular text-ink-subtle">· {Number(t.dispatch_count) - Number(t.delivered_count)} not yet</span>
                    )}
                    <span className="tabular">· <strong className="text-ink">{Number(t.with_gps_count)}</strong> with GPS</span>
                    <span>·</span>
                    <span className="tabular">{formatINR(Number(t.total_amount))}</span>
                  </div>

                  {customerNames.length > 0 && (
                    <p className="text-2xs text-ink-subtle mb-2.5 truncate">
                      {customerNames.join(", ")}{Number(t.delivered_count) > customerNames.length && ` …`}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {mapUrl && Number(t.with_gps_count) >= 2 ? (
                      <a
                        href={mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-accent/40 text-accent hover:bg-accent-soft transition-colors"
                      >
                        <MapPin size={11}/> View route ({points.length} stop{points.length === 1 ? "" : "s"})
                      </a>
                    ) : Number(t.with_gps_count) === 1 && mapUrl ? (
                      <a
                        href={mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-paper-line text-ink-muted hover:bg-paper-subtle transition-colors"
                      >
                        <MapPin size={11}/> View 1 stop
                      </a>
                    ) : (
                      <span className="text-2xs text-ink-subtle italic">
                        No GPS captured for this trip
                      </span>
                    )}

                    <Link
                      href={`/dispatches?vehicle=${encodeURIComponent(t.vehicle_number)}`}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-paper-line text-ink-muted hover:bg-paper-subtle transition-colors"
                    >
                      <Eye size={11}/> See dispatches
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
