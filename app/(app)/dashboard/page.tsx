import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Users2, Package, MapPin, UserCircle2, ArrowUpRight } from "lucide-react";
import Link from "next/link";

async function getCount(table: string) {
  const supabase = await createClient();
  const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
  return count ?? 0;
}

export default async function DashboardPage() {
  const [customers, products, beats, salesmen] = await Promise.all([
    getCount("customers"),
    getCount("products"),
    getCount("beats"),
    getCount("salesmen"),
  ]);

  const stats = [
    { label: "Customers", value: customers, href: "/customers", icon: Users2 },
    { label: "Products",  value: products,  href: "/products",  icon: Package },
    { label: "Beats",     value: beats,     href: "/beats",     icon: MapPin },
    { label: "Salesmen",  value: salesmen,  href: "/salesmen",  icon: UserCircle2 },
  ];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Operational snapshot" />
      <div className="p-6 space-y-6">
        <section>
          <h2 className="text-2xs uppercase tracking-[0.2em] text-ink-subtle mb-3">Masters</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {stats.map((s) => (
              <Link
                key={s.label}
                href={s.href}
                className="group bg-paper-card border border-paper-line rounded-md p-4 hover:border-accent transition-all hover:shadow-card"
              >
                <div className="flex items-start justify-between mb-3">
                  <s.icon size={16} className="text-ink-subtle group-hover:text-accent transition-colors" />
                  <ArrowUpRight size={14} className="text-ink-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="tabular text-3xl font-bold leading-none">{s.value.toLocaleString("en-IN")}</div>
                <div className="text-xs text-ink-muted mt-1.5 uppercase tracking-wide">{s.label}</div>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-2xs uppercase tracking-[0.2em] text-ink-subtle mb-3">Today's Orders</h2>
          <div className="bg-paper-card border border-paper-line rounded-md p-8 text-center">
            <p className="text-sm text-ink-muted">
              Orders will appear here once the Rupyz scraper is live <span className="text-ink-subtle">(Phase 2)</span>.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-2xs uppercase tracking-[0.2em] text-ink-subtle mb-3">System Status</h2>
          <div className="bg-paper-card border border-paper-line rounded-md divide-y divide-paper-line">
            <Row label="Rupyz fetcher"  state="pending"  detail="Phase 2 — not yet built" />
            <Row label="Tally bridge"   state="pending"  detail="Phase 4 — not yet built" />
            <Row label="WATi WhatsApp"  state="pending"  detail="Phase 5 — not yet built" />
            <Row label="Database"       state="ok"       detail="Connected · 1,096 customers · 43 SKUs" />
          </div>
        </section>
      </div>
    </>
  );
}

function Row({ label, state, detail }: { label: string; state: "ok" | "pending" | "error"; detail: string }) {
  const dot = {
    ok: "bg-ok",
    pending: "bg-warn",
    error: "bg-danger",
  }[state];
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
