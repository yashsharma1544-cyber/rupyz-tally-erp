// =============================================================================
// /load — godown loading app home (vehicle-first)
//
// Flow: Invoice (billing) → LOAD → Dispatch.
//   1. Pick the vehicle + loaders for this session (creates a vehicle_loads row,
//      redirects to /load?load=<id>).
//   2. Work the invoice-gated order queue; open each order, confirm qtys,
//      "Mark loaded" → attaches a pending dispatch to this vehicle load.
//   3. The vehicle then shows on /dispatch for "Vehicle left" (driver/helper).
//
// Auth: admin and dispatch only. Jalna-only queue.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { Boxes, ChevronRight, MapPin, Package, Hourglass, Receipt, Truck, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "@/components/auto-refresh";
import { getT } from "@/lib/i18n/server";
import { LoadSessionStart } from "./load-session-start";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
function isJalna(city: string | null | undefined): boolean {
  if (!city) return false;
  return city.trim().toLowerCase() === "jalna";
}

interface OrderRow {
  id: string;
  rupyz_order_id: string;
  invoice_number: string | null;
  total_amount: number;
  app_status: string;
  customer: { id: string; name: string; city: string | null } | null;
  beat: { id: string; name: string; city: string | null } | null;
  item_count: number;
  on_this_load: boolean;
}

export default async function LoadHomePage({
  searchParams,
}: {
  searchParams: Promise<{ load?: string }>;
}) {
  const { load: loadId } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/load");

  const { t } = await getT();

  const { data: me } = await supabase
    .from("app_users")
    .select("full_name, role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active) redirect("/login");
  if (!["admin", "dispatch"].includes(me.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <h1 className="font-semibold text-base mb-1">{t("common.not_authorized")}</h1>
          <p className="text-sm text-ink-muted mb-4">{t("loading.role_required")}</p>
          <Link href="/dashboard" className="text-accent text-sm">{t("common.go_to_dashboard")}</Link>
        </div>
      </div>
    );
  }

  // Resolve active load session (if ?load= present and still 'loading')
  let activeLoad: { id: string; vehicleNumber: string; loaders: string } | null = null;
  if (loadId) {
    const { data: vl } = await supabase
      .from("vehicle_loads")
      .select("id, status, vehicles(number)")
      .eq("id", loadId)
      .maybeSingle();
    if (vl && vl.status === "loading") {
      const vehNum = Array.isArray(vl.vehicles)
        ? (vl.vehicles[0] as { number?: string } | undefined)?.number
        : (vl.vehicles as { number?: string } | null)?.number;
      const { data: loaderRows } = await supabase
        .from("vehicle_load_loaders")
        .select("app_users(full_name)")
        .eq("load_id", loadId);
      const loaderNames = (loaderRows ?? [])
        .map(r => {
          const u = Array.isArray(r.app_users) ? r.app_users[0] : r.app_users;
          return (u as { full_name?: string } | null)?.full_name ?? null;
        })
        .filter(Boolean)
        .join(", ");
      activeLoad = { id: vl.id, vehicleNumber: vehNum ?? "—", loaders: loaderNames };
    }
  }

  // If no active session, show the vehicle + loaders picker
  if (!activeLoad) {
    const { data: vehicles } = await supabase
      .from("vehicles").select("id, number, make, capacity_kg").eq("active", true).order("number");
    const { data: loaders } = await supabase
      .from("app_users").select("id, full_name, phone, role")
      .in("role", ["van_helper", "dispatch"]).eq("active", true).order("full_name");

    return (
      <div className="min-h-screen bg-paper">
        <div className="max-w-md mx-auto px-3 py-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded bg-accent text-paper-card flex items-center justify-center shrink-0">
              <Truck size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-bold leading-tight">Start loading</h1>
              <p className="text-2xs text-ink-muted">{me.full_name} · pick the vehicle &amp; loaders</p>
            </div>
          </div>
          <LoadSessionStart
            vehicles={(vehicles ?? []).map(v => ({ id: v.id, number: v.number, make: v.make, capacityKg: v.capacity_kg }))}
            loaders={(loaders ?? []).map(l => ({ id: l.id, name: l.full_name, phone: l.phone }))}
          />
          <div className="mt-6 text-center text-2xs text-ink-subtle">
            <Link href="/" className="hover:text-ink-muted">← {t("common.back_to_main")}</Link>
          </div>
        </div>
      </div>
    );
  }

  // Active session — show the invoice-gated queue, marking which orders are on this load
  const { data: rawOrders } = await supabase
    .from("orders")
    .select(`
      id, rupyz_order_id, invoice_number, total_amount, app_status,
      customer:customers!inner(id, name, city, beat:beats(id, name, city)),
      items:order_items(id),
      dispatches:dispatches(id, load_id, status)
    `)
    .in("app_status", ["invoiced", "loading", "loaded", "partially_dispatched"])
    .order("rupyz_created_at", { ascending: true });

  const allOrders: OrderRow[] = (rawOrders ?? []).map(o => {
    const customer = Array.isArray(o.customer) ? o.customer[0] : o.customer;
    const beatRel = customer?.beat;
    const beat = Array.isArray(beatRel) ? beatRel[0] : beatRel;
    const disp = (o.dispatches ?? []) as Array<{ load_id: string | null; status: string }>;
    const onThisLoad = disp.some(d => d.load_id === activeLoad!.id && d.status === "pending");
    return {
      id: o.id,
      rupyz_order_id: o.rupyz_order_id,
      invoice_number: o.invoice_number ?? null,
      total_amount: Number(o.total_amount),
      app_status: o.app_status,
      customer: customer ? { id: customer.id, name: customer.name, city: customer.city } : null,
      beat: beat ? { id: beat.id, name: beat.name, city: beat.city } : null,
      item_count: o.items?.length ?? 0,
      on_this_load: onThisLoad,
    };
  });

  const orders = allOrders.filter(o => isJalna(o.beat?.city) || isJalna(o.customer?.city));

  const byBeat = new Map<string, { beatName: string; orders: OrderRow[] }>();
  const unassigned: OrderRow[] = [];
  for (const o of orders) {
    if (!o.beat) { unassigned.push(o); continue; }
    if (!byBeat.has(o.beat.id)) byBeat.set(o.beat.id, { beatName: o.beat.name, orders: [] });
    byBeat.get(o.beat.id)!.orders.push(o);
  }
  const beatGroups = Array.from(byBeat.entries()).sort((a, b) => a[1].beatName.localeCompare(b[1].beatName));

  const loadedHereCount = orders.filter(o => o.on_this_load).length;
  const toLoadCount = orders.filter(o => !o.on_this_load && o.invoice_number).length;

  const itemsLabel = t("common.items");

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded bg-accent text-paper-card flex items-center justify-center shrink-0">
            <Boxes size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold leading-tight">{t("loading.page_title")}</h1>
            <p className="text-2xs text-ink-muted">{me.full_name} · {t("loading.jalna_only")}</p>
          </div>
        </div>

        {/* Active vehicle banner */}
        <div className="bg-accent-soft border border-accent/30 rounded-md p-3 my-3">
          <div className="flex items-center gap-2">
            <Truck size={16} className="text-accent shrink-0"/>
            <div className="flex-1 min-w-0">
              <div className="text-2xs uppercase tracking-wide text-accent/80 font-semibold">Loading into</div>
              <div className="font-mono font-bold text-base leading-tight truncate">{activeLoad.vehicleNumber}</div>
              {activeLoad.loaders && <div className="text-2xs text-ink-muted truncate">Loaders: {activeLoad.loaders}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-bold tabular text-accent leading-none">{loadedHereCount}</div>
              <div className="text-2xs text-ink-muted">loaded</div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            <Link
              href="/dispatch"
              className="flex-1 inline-flex items-center justify-center gap-1 h-9 rounded-md bg-accent text-paper-card text-xs font-semibold hover:bg-accent/90"
            >
              Done loading → Dispatch
            </Link>
            <Link
              href="/load"
              className="inline-flex items-center justify-center gap-1 h-9 px-3 rounded-md border border-paper-line bg-paper-card text-xs hover:bg-paper-subtle"
            >
              Switch vehicle
            </Link>
          </div>
        </div>

        {toLoadCount === 0 && loadedHereCount === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
            <Boxes size={28} className="mx-auto text-ink-subtle mb-2"/>
            <p className="font-semibold text-sm mb-0.5">{t("loading.nothing_to_load")}</p>
            <p className="text-xs text-ink-muted">{t("loading.empty_state_desc")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {beatGroups.map(([beatId, group]) => (
              <BeatGroup key={beatId} beatName={group.beatName} orders={group.orders} loadId={activeLoad!.id} itemsLabel={itemsLabel}/>
            ))}
            {unassigned.length > 0 && (
              <BeatGroup beatName={t("loading.no_beat_assigned")} orders={unassigned} loadId={activeLoad!.id} itemsLabel={itemsLabel}/>
            )}
          </div>
        )}

        <div className="mt-6 text-center text-2xs text-ink-subtle">
          <Link href="/" className="hover:text-ink-muted">← {t("common.back_to_main")}</Link>
        </div>

        <AutoRefresh />
      </div>
    </div>
  );
}

function BeatGroup({
  beatName, orders, loadId, itemsLabel,
}: {
  beatName: string;
  orders: OrderRow[];
  loadId: string;
  itemsLabel: string;
}) {
  return (
    <section>
      <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold mb-1.5 inline-flex items-center gap-1">
        <MapPin size={10}/> {beatName}
        <span className="ml-1 text-ink-subtle tabular">({orders.length})</span>
      </h2>
      <div className="space-y-2">
        {orders.map(o => (
          <Link
            key={o.id}
            href={`/load/orders/${o.id}?load=${loadId}`}
            className={`block border rounded-md p-3 transition-colors ${
              o.on_this_load
                ? "bg-accent-soft/30 border-accent/40"
                : "bg-paper-card border-paper-line hover:bg-paper-subtle/40 active:bg-paper-subtle"
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate inline-flex items-center gap-1.5">
                  {o.on_this_load && <Check size={13} className="text-accent shrink-0"/>}
                  {o.customer?.name ?? "—"}
                </div>
                <div className="text-2xs text-ink-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono">{o.rupyz_order_id}</span>
                  {o.customer?.city && <><span className="text-ink-subtle">·</span><span>{o.customer.city}</span></>}
                  <span className="text-ink-subtle">·</span>
                  <span className="inline-flex items-center gap-0.5"><Package size={9}/> {o.item_count} {itemsLabel}</span>
                  <span className="text-ink-subtle">·</span>
                  <span className="tabular">{formatINR(o.total_amount)}</span>
                </div>
                {o.invoice_number ? (
                  <div className="mt-1 inline-flex items-center gap-1 text-2xs text-accent font-semibold">
                    <Receipt size={9}/> inv <span className="font-mono">{o.invoice_number}</span>
                  </div>
                ) : (
                  <div className="mt-1 inline-flex items-center gap-1 text-2xs text-warn font-semibold">
                    <Hourglass size={9}/> waiting for invoice
                  </div>
                )}
                {o.on_this_load && (
                  <div className="mt-1 inline-flex items-center gap-1 text-2xs text-accent font-semibold">
                    <Check size={9}/> on this vehicle
                  </div>
                )}
              </div>
              <ChevronRight size={14} className="text-ink-subtle shrink-0 mt-0.5"/>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
