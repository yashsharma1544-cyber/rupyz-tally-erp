import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Users2, Package, MapPin, UserCircle2, ShoppingBag, ArrowUpRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";

async function getCount(table: string, eq?: { col: string; val: string | number | boolean }) {
  const supabase = await createClient();
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (eq) q = q.eq(eq.col, eq.val);
  const { count } = await q;
  return count ?? 0;
}

async function getOrderCountToday() {
  const supabase = await createClient();
  const since = new Date(); since.setHours(0,0,0,0);
  const { count } = await supabase.from("orders")
    .select("*", { count: "exact", head: true })
    .gte("rupyz_created_at", since.toISOString());
  return count ?? 0;
}

async function getOrderCountByStatus(status: string) {
  return getCount("orders", { col: "app_status", val: status });
}

async function getLastSync() {
  const supabase = await createClient();
  const { data } = await supabase.from("rupyz_sync_log")
    .select("started_at, status, orders_inserted")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export default async function DashboardPage() {
  const [customers, products, beats, salesmen, ordersToday, pendingApproval, dispatchedToday, lastSync] =
    await Promise.all([
      getCount("customers"),
      getCount("products"),
      getCount("beats"),
      getCount("salesmen"),
      getOrderCountToday(),
      getOrderCountByStatus("received"),
      getOrderCountByStatus("dispatched"),
      getLastSync(),
    ]);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Operational snapshot" />
      <div className="p-6 space-y-6">
        <section>
          <h2 className="text-2xs uppercase tracking-[0.2em] text-ink-subtle mb-3">Today</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Stat label="Orders today" value={ordersToday} icon={ShoppingBag} href="/orders" highlight />
            <Stat label="Awaiting approval" value={pendingApproval} icon={ShoppingBag} href="/orders" />
            <Stat label="Dispatched" value={dispatchedToday} icon={CheckCircle2} href="/orders" />
          </div>
        </section>

        <section>
          <h2 className="text-2xs uppercase tracking-[0.2em] text-ink-subtle mb-3">Masters</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Customers" value={customers} icon={Users2} href="/customers" />
            <Stat label="Products"  value={products}  icon={Package} href="/products" />
            <Stat label="Beats"     value={beats}     icon={MapPin}  href="/beats" />
            <Stat label="Salesmen"  value={salesmen}  icon={UserCircle2} href="/salesmen" />
          </div>
        </section>

        <section>
          <h2 className="text-2xs uppercase tracking-[0.2em] text-ink-subtle mb-3">System Status</h2>
          <div className="bg-paper-card border border-paper-line rounded-md divide-y divide-paper-line">
            <Row
              label="Rupyz fetcher"
              state={lastSync?.status === "success" ? "ok" : lastSync?.status === "failed" ? "error" : "pending"}
              detail={
                lastSync
                  ? `Last sync ${new Date(lastSync.started_at).toLocaleString("en-IN")} · ${lastSync.status}`
                  : "Not yet run — go to Settings"
              }
            />
            <Row label="Tally bridge"   state="pending" detail="Phase 4 — not yet built" />
            <Row label="WATi WhatsApp"  state="pending" detail="Phase 5 — not yet built" />
            <Row label="Database"       state="ok"      detail={`Connected · ${customers.toLocaleString("en-IN")} customers · ${products} SKUs`} />
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({
  label, value, icon: Icon, href, highlight,
}: {
  label: string; value: number; icon: any; href: string; highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group bg-paper-card border rounded-md p-4 hover:border-accent transition-all hover:shadow-card ${highlight ? "border-accent" : "border-paper-line"}`}
    >
      <div className="flex items-start justify-between mb-3">
        <Icon size={16} className={highlight ? "text-accent" : "text-ink-subtle group-hover:text-accent"} />
        <ArrowUpRight size={14} className="text-ink-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div className="tabular text-3xl font-bold leading-none">{value.toLocaleString("en-IN")}</div>
      <div className="text-xs text-ink-muted mt-1.5 uppercase tracking-wide">{label}</div>
    </Link>
  );
}

function Row({ label, state, detail }: { label: string; state: "ok" | "pending" | "error"; detail: string }) {
  const dot = { ok: "bg-ok", pending: "bg-warn", error: "bg-danger" }[state];
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className="text-xs text-ink-muted">{detail}</span>
    </div>
  );
}
