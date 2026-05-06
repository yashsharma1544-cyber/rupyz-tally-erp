// =============================================================================
// /dispatch — godown dispatch app home
//
// Mobile-first PWA at /dispatch. Shows beats with approved orders, each as a
// big tappable tile with order count + kg + amount.
//
// Auth: admin and dispatch only.
// =============================================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { Truck, ChevronRight, MapPin, Package, IndianRupee } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
}

interface BeatRow {
  beat_id: string;
  beat_name: string;
  order_count: number;
  total_kg: number;
  total_amount: number;
}

export default async function DispatchHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/dispatch");

  const { data: me } = await supabase.from("app_users").select("full_name, role, active").eq("id", user.id).single();
  if (!me?.active) redirect("/login");
  if (!["admin", "dispatch"].includes(me.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center bg-paper">
        <div>
          <h1 className="font-semibold text-base mb-1">Not authorized</h1>
          <p className="text-sm text-ink-muted mb-4">Dispatch app requires the &lsquo;dispatch&rsquo; or &lsquo;admin&rsquo; role.</p>
          <Link href="/dashboard" className="text-accent text-sm">Go to dashboard</Link>
        </div>
      </div>
    );
  }

  const { data: kpis } = await supabase.rpc("dispatch_kpis_by_beat");
  const beatRows = (kpis ?? []) as BeatRow[];

  const totalOrders = beatRows.reduce((s, b) => s + Number(b.order_count), 0);
  const totalKg     = beatRows.reduce((s, b) => s + Number(b.total_kg), 0);
  const totalAmount = beatRows.reduce((s, b) => s + Number(b.total_amount), 0);

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-md mx-auto px-3 py-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded bg-accent text-paper-card flex items-center justify-center shrink-0">
            <Truck size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold leading-tight">Dispatch</h1>
            <p className="text-2xs text-ink-muted">{me.full_name}</p>
          </div>
        </div>

        {/* Total KPI strip */}
        <div className="bg-paper-card border border-paper-line rounded-md p-3 my-3">
          <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">Approved &amp; ready to dispatch</div>
          <div className="grid grid-cols-3 gap-2">
            <KpiTile icon={Package}   label="Orders" value={totalOrders.toLocaleString("en-IN")} />
            <KpiTile icon={Package}   label="Total" value={formatKg(totalKg)} />
            <KpiTile icon={IndianRupee} label="Value" value={formatINR(totalAmount)} />
          </div>
          <div className="text-2xs text-ink-subtle mt-2 text-center">
            across {beatRows.length} beat{beatRows.length === 1 ? "" : "s"}
          </div>
        </div>

        {/* Beat tiles */}
        {beatRows.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-6 text-center">
            <Truck size={28} className="mx-auto text-ink-subtle mb-2"/>
            <p className="font-semibold text-sm mb-0.5">Nothing to dispatch right now</p>
            <p className="text-xs text-ink-muted">When admin approves orders, the beats will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {beatRows.map(b => (
              <Link
                key={b.beat_id}
                href={`/dispatch/${b.beat_id}`}
                className="block bg-paper-card border border-paper-line rounded-md p-3.5 hover:bg-paper-subtle/40 active:bg-paper-subtle transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
                    <MapPin size={15}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-sm truncate">{b.beat_name}</h2>
                    <div className="text-2xs text-ink-muted flex items-center gap-2 mt-0.5">
                      <span className="tabular"><strong className="text-ink">{b.order_count}</strong> orders</span>
                      <span className="text-ink-subtle">·</span>
                      <span className="tabular"><strong className="text-ink">{formatKg(b.total_kg)}</strong></span>
                      <span className="text-ink-subtle">·</span>
                      <span className="tabular">{formatINR(b.total_amount)}</span>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-ink-subtle shrink-0"/>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center text-2xs text-ink-subtle">
          <Link href="/" className="hover:text-ink-muted">← Main app</Link>
        </div>
      </div>
    </div>
  );
}

// Small tile component for the KPI strip
function KpiTile({
  icon: Icon, label, value,
}: { icon: typeof Package; label: string; value: string }) {
  void Icon;
  return (
    <div className="bg-paper-subtle/50 rounded p-2 text-center">
      <div className="text-2xs text-ink-muted mb-0.5">{label}</div>
      <div className="font-bold text-sm tabular truncate">{value}</div>
    </div>
  );
}
