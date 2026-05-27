// =============================================================================
// /load — godown loading app home (vehicle-first, desktop redesign)
//
// Same flow + data as before (Invoice → LOAD → Dispatch). Presentation reflowed
// to the /orders desktop language: PageHeader + KPI cards + active-vehicle
// banner + the invoice-gated queue as bordered per-beat tables.
// LoadSessionStart (the picker) is unchanged. Still works on mobile.
//
// Auth: admin and dispatch only. Jalna-only queue.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { Boxes, ChevronRight, Package, Hourglass, Receipt, Truck, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
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
      <>
        <PageHeader
          title="Start loading"
          subtitle={`${me.full_name} · pick the vehicle & loaders`}
        />
        <div className="p-3 sm:p-6">
          <div className="max-w-xl bg-paper-card border border-paper-line rounded-md p-4 sm:p-5">
            <LoadSessionStart
              vehicles={(vehicles ?? []).map(v => ({ id: v.id, number: v.number, make: v.make, capacityKg: v.capacity_kg }))}
              loaders={(loaders ?? []).map(l => ({ id: l.id, name: l.full_name, phone: l.phone }))}
            />
          </div>
          <div className="mt-6 text-2xs text-ink-subtle lg:hidden">
            <Link href="/" className="hover:text-ink-muted">← {t("common.back_to_main")}</Link>
          </div>
        </div>
      </>
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
    <>
      <PageHeader
        title={t("loading.page_title")}
        subtitle={`${me.full_name} · ${t("loading.jalna_only")}`}
        actions={
          <Link href="/dispatch">
            <Button size="sm"><Truck size={14} /> Done loading → Dispatch</Button>
          </Link>
        }
      />

      <div className="p-3 sm:p-6">
        {/* Active vehicle + KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mb-6 max-w-3xl">
          <div className="sm:col-span-1 bg-accent-soft border border-accent/30 rounded-md p-3">
            <div className="flex items-center gap-2">
              <Truck size={16} className="text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-2xs uppercase tracking-wide text-accent/80 font-semibold">Loading into</div>
                <div className="font-mono font-bold text-base leading-tight truncate">{activeLoad.vehicleNumber}</div>
              </div>
            </div>
            {activeLoad.loaders && <div className="text-2xs text-ink-muted truncate mt-1">Loaders: {activeLoad.loaders}</div>}
            <Link href="/load" className="mt-2 inline-flex items-center justify-center gap-1 h-7 px-2.5 rounded border border-paper-line bg-paper-card text-2xs hover:bg-paper-subtle">
              Switch vehicle
            </Link>
          </div>
          <KpiTile icon={Check}   label="Loaded on this vehicle" value={loadedHereCount.toLocaleString("en-IN")} />
          <KpiTile icon={Boxes}   label="Invoiced, ready to load" value={toLoadCount.toLocaleString("en-IN")} />
        </div>

        {toLoadCount === 0 && loadedHereCount === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-8 text-center max-w-2xl">
            <Boxes size={28} className="mx-auto text-ink-subtle mb-2" />
            <p className="font-semibold text-sm mb-0.5">{t("loading.nothing_to_load")}</p>
            <p className="text-xs text-ink-muted">{t("loading.empty_state_desc")}</p>
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl">
            {beatGroups.map(([beatId, group]) => (
              <BeatTable key={beatId} beatName={group.beatName} orders={group.orders} loadId={activeLoad!.id} itemsLabel={itemsLabel} />
            ))}
            {unassigned.length > 0 && (
              <BeatTable beatName={t("loading.no_beat_assigned")} orders={unassigned} loadId={activeLoad!.id} itemsLabel={itemsLabel} />
            )}
          </div>
        )}

        <div className="mt-6 text-2xs text-ink-subtle lg:hidden">
          <Link href="/" className="hover:text-ink-muted">← {t("common.back_to_main")}</Link>
        </div>

        <AutoRefresh />
      </div>
    </>
  );
}

function BeatTable({
  beatName, orders, loadId, itemsLabel,
}: {
  beatName: string;
  orders: OrderRow[];
  loadId: string;
  itemsLabel: string;
}) {
  return (
    <section>
      <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold mb-2">
        {beatName} <span className="text-ink-subtle tabular">({orders.length})</span>
      </h2>
      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead className="bg-paper-subtle/60 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 font-medium">Order #</th>
                <th className="px-3 py-2.5 font-medium text-right">{itemsLabel}</th>
                <th className="px-3 py-2.5 font-medium text-right">Value</th>
                <th className="px-3 py-2.5 font-medium">Invoice</th>
                <th className="px-3 py-2.5 font-medium text-right w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {orders.map(o => (
                <tr key={o.id} className={`transition-colors ${o.on_this_load ? "bg-accent-soft/30" : "hover:bg-paper-subtle/40"}`}>
                  <td className="px-3 py-3">
                    <Link href={`/load/orders/${o.id}?load=${loadId}`} className="font-medium inline-flex items-center gap-1.5 hover:text-accent">
                      {o.on_this_load && <Check size={13} className="text-accent shrink-0" />}
                      {o.customer?.name ?? "—"}
                    </Link>
                    {o.customer?.city && <div className="text-2xs text-ink-subtle">{o.customer.city}</div>}
                    {o.on_this_load && (
                      <div className="text-2xs text-accent font-semibold inline-flex items-center gap-0.5 mt-0.5">
                        <Check size={9} /> on this vehicle
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-ink-muted">{o.rupyz_order_id}</td>
                  <td className="px-3 py-3 text-right tabular">
                    <span className="inline-flex items-center gap-0.5"><Package size={10} className="text-ink-subtle" /> {o.item_count}</span>
                  </td>
                  <td className="px-3 py-3 text-right tabular font-medium">{formatINR(o.total_amount)}</td>
                  <td className="px-3 py-3">
                    {o.invoice_number ? (
                      <span className="inline-flex items-center gap-1 text-2xs text-accent font-semibold">
                        <Receipt size={10} /> <span className="font-mono">{o.invoice_number}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-2xs text-warn font-semibold">
                        <Hourglass size={10} /> waiting
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link href={`/load/orders/${o.id}?load=${loadId}`} className="text-accent inline-flex items-center gap-1 hover:underline">
                      Open <ChevronRight size={13} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function KpiTile({
  icon: Icon, label, value,
}: { icon: typeof Package; label: string; value: string }) {
  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="p-1 rounded bg-accent-soft">
          <Icon size={12} className="text-accent" />
        </span>
        <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium leading-tight">{label}</span>
      </div>
      <div className="text-lg sm:text-xl font-bold tabular truncate">{value}</div>
    </div>
  );
}
