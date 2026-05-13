// =============================================================================
// /load — godown loading app home
//
// Mobile-first PWA at /load. Shows orders in 'approved' or 'loading' status,
// grouped by beat. Loading team taps an order to start loading.
//
// Auth: admin and dispatch only.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { Boxes, ChevronRight, MapPin, Package, Hourglass } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

interface OrderRow {
  id: string;
  rupyz_order_id: string;
  total_amount: number;
  app_status: string;
  customer: { id: string; name: string; city: string | null } | null;
  beat: { id: string; name: string } | null;
  item_count: number;
}

export default async function LoadHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/load");

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
          <h1 className="font-semibold text-base mb-1">Not authorized</h1>
          <p className="text-sm text-ink-muted mb-4">
            Loading app requires the &lsquo;dispatch&rsquo; or &lsquo;admin&rsquo; role.
          </p>
          <Link href="/dashboard" className="text-accent text-sm">Go to dashboard</Link>
        </div>
      </div>
    );
  }

  // Pull approved + loading orders. Inner join on customer to get beat.
  // Filter must use status IN list — we want approved (not yet started) and loading (in progress).
  const { data: rawOrders } = await supabase
    .from("orders")
    .select(`
      id, rupyz_order_id, total_amount, app_status,
      customer:customers!inner(id, name, city, beat:beats(id, name)),
      items:order_items(id)
    `)
    .in("app_status", ["approved", "loading"])
    .order("rupyz_created_at", { ascending: true });

  const orders: OrderRow[] = (rawOrders ?? []).map(o => {
    const customer = Array.isArray(o.customer) ? o.customer[0] : o.customer;
    const beatRel = customer?.beat;
    const beat = Array.isArray(beatRel) ? beatRel[0] : beatRel;
    return {
      id: o.id,
      rupyz_order_id: o.rupyz_order_id,
      total_amount: Number(o.total_amount),
      app_status: o.app_status,
      customer: customer ? { id: customer.id, name: customer.name, city: customer.city } : null,
      beat: beat ? { id: beat.id, name: beat.name } : null,
      item_count: o.items?.length ?? 0,
    };
  });

  // Group by beat
  const byBeat = new Map<string, { beatName: string; orders: OrderRow[] }>();
  const unassigned: OrderRow[] = [];
  for (const o of orders) {
    if (!o.beat) {
      unassigned.push(o);
      continue;
    }
    if (!byBeat.has(o.beat.id)) {
      byBeat.set(o.beat.id, { beatName: o.beat.name, orders: [] });
    }
    byBeat.get(o.beat.id)!.orders.push(o);
  }
  const beatGroups = Array.from(byBeat.entries()).sort((a, b) =>
    a[1].beatName.localeCompare(b[1].beatName)
  );

  const totalOrders = orders.length;
  const loadingCount = orders.filter(o => o.app_status === "loading").length;
  const approvedCount = orders.filter(o => o.app_status === "approved").length;
  const totalValue = orders.reduce((s, o) => s + o.total_amount, 0);

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded bg-accent text-paper-card flex items-center justify-center shrink-0">
            <Boxes size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold leading-tight">Loading</h1>
            <p className="text-2xs text-ink-muted">{me.full_name}</p>
          </div>
        </div>

        {/* KPI strip */}
        <div className="bg-paper-card border border-paper-line rounded-md p-3 my-3">
          <div className="text-2xs uppercase tracking-wide text-ink-muted mb-2">Loading queue</div>
          <div className="grid grid-cols-3 gap-2">
            <Kpi label="To start" value={approvedCount.toString()} accent="ink"/>
            <Kpi label="In progress" value={loadingCount.toString()} accent={loadingCount > 0 ? "warn" : "ink"}/>
            <Kpi label="Total value" value={formatINR(totalValue)} accent="ink"/>
          </div>
        </div>

        {/* Beat groups */}
        {totalOrders === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
            <Boxes size={28} className="mx-auto text-ink-subtle mb-2"/>
            <p className="font-semibold text-sm mb-0.5">Nothing to load right now</p>
            <p className="text-xs text-ink-muted">When admin approves orders, they&apos;ll appear here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {beatGroups.map(([beatId, group]) => (
              <BeatGroup key={beatId} beatName={group.beatName} orders={group.orders} />
            ))}
            {unassigned.length > 0 && (
              <BeatGroup beatName="No beat assigned" orders={unassigned} />
            )}
          </div>
        )}

        <div className="mt-6 text-center text-2xs text-ink-subtle">
          <Link href="/" className="hover:text-ink-muted">← Main app</Link>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: "ink" | "warn" }) {
  const color = accent === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="bg-paper-subtle/50 rounded p-2 text-center">
      <div className="text-2xs text-ink-muted mb-0.5">{label}</div>
      <div className={`font-bold text-sm tabular truncate ${color}`}>{value}</div>
    </div>
  );
}

function BeatGroup({ beatName, orders }: { beatName: string; orders: OrderRow[] }) {
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
            href={`/load/orders/${o.id}`}
            className="block bg-paper-card border border-paper-line rounded-md p-3 hover:bg-paper-subtle/40 active:bg-paper-subtle transition-colors"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{o.customer?.name ?? "—"}</div>
                <div className="text-2xs text-ink-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono">{o.rupyz_order_id}</span>
                  {o.customer?.city && <><span className="text-ink-subtle">·</span><span>{o.customer.city}</span></>}
                  <span className="text-ink-subtle">·</span>
                  <span className="inline-flex items-center gap-0.5"><Package size={9}/> {o.item_count} item{o.item_count === 1 ? "" : "s"}</span>
                  <span className="text-ink-subtle">·</span>
                  <span className="tabular">{formatINR(o.total_amount)}</span>
                </div>
                {o.app_status === "loading" && (
                  <div className="mt-1 inline-flex items-center gap-1 text-2xs text-warn font-semibold">
                    <Hourglass size={9}/> In progress
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
