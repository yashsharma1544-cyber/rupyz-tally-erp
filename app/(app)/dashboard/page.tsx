// =============================================================================
// /dashboard — task-focused home page
//
// Goal: tell the user what they should do today, with a single click to get
// there. Avoid charts, avoid noise. Each section answers "what's waiting for
// me?" or "what's stuck?".
//
// Sections (top to bottom):
//   1. Greeting + headline counters
//   2. Action items — things to do RIGHT NOW (with prominent buttons)
//   3. Today snapshot — quick stats with no buttons (just for awareness)
//   4. Stale items — only shown when there's something genuinely overdue
//   5. System status (Rupyz token, sync) — only shown if there's a problem
// =============================================================================

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CheckSquare, Truck, Route, AlertTriangle, ChevronRight, ShoppingBag,
  CheckCircle2, IndianRupee, Receipt, Clock, AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";  // Never cache; always show fresh
export const revalidate = 0;

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function greeting(): string {
  const hour = new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" });
  const h = parseInt(hour, 10);
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("app_users").select("full_name, role").eq("id", user.id).single();
  if (!me) redirect("/login");

  // Day boundaries for "today" filters (IST)
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayISO = startOfToday.toISOString();

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  // =============== Bulk parallel queries ===============
  const [
    pendingApprovalAgg,
    readyToSendAgg,
    onVanTripAgg,
    activeTripsAgg,
    returnedTripsAgg,
    todayOrdersAgg,
    todayDeliveredAgg,
    todayCollectionsAgg,
    outstandingAgg,
    staleApprovalAgg,
    staleApprovedAgg,
    rupyzSession,
    lastRupyzSync,
  ] = await Promise.all([
    // 1. Action items
    supabase.from("orders").select("total_amount", { count: "exact" }).eq("app_status", "received"),
    supabase.from("orders").select("total_amount", { count: "exact" }).in("app_status", ["approved", "partially_dispatched"]),
    supabase.from("orders").select("total_amount", { count: "exact" }).eq("app_status", "on_van_trip"),
    supabase.from("van_trips").select("id", { count: "exact" }).eq("status", "in_progress"),
    supabase.from("van_trips").select("id", { count: "exact" }).eq("status", "returned"),

    // 2. Today snapshot
    supabase.from("orders").select("total_amount", { count: "exact" }).gte("rupyz_created_at", startOfTodayISO),
    supabase.from("orders").select("total_amount", { count: "exact" }).eq("app_status", "delivered").gte("delivered_at", startOfTodayISO),
    supabase.from("trip_bills").select("total_amount").gte("confirmed_at", startOfTodayISO).eq("is_cancelled", false).not("confirmed_at", "is", null),

    // 3. Outstanding (from existing customer_outstanding table; legacy CSV-imported)
    supabase.from("customer_outstanding").select("amount"),

    // 4. Stale items
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("app_status", "received").lt("rupyz_created_at", yesterday),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("app_status", "approved").lt("approved_at", twoDaysAgo),

    // 5. System status — Rupyz token expiry
    supabase.from("rupyz_session").select("expires_at, last_refreshed_at").eq("id", 1).maybeSingle(),
    supabase.from("rupyz_sync_log").select("status, started_at, error_message").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  // ======= Reduce ========
  const sumAmt = (rows: { total_amount: number }[] | null | undefined) =>
    (rows ?? []).reduce((s, r) => s + Number(r.total_amount), 0);
  const sumCol = (rows: { amount: number }[] | null | undefined) =>
    (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);

  const pendingApproval = { count: pendingApprovalAgg.count ?? 0, amount: sumAmt(pendingApprovalAgg.data) };
  const readyToSend     = { count: readyToSendAgg.count ?? 0,    amount: sumAmt(readyToSendAgg.data) };
  const onVanTrip       = { count: onVanTripAgg.count ?? 0,      amount: sumAmt(onVanTripAgg.data) };
  const activeTrips     = activeTripsAgg.count ?? 0;
  const returnedTrips   = returnedTripsAgg.count ?? 0;

  const todayOrders     = { count: todayOrdersAgg.count ?? 0,    amount: sumAmt(todayOrdersAgg.data) };
  const todayDelivered  = { count: todayDeliveredAgg.count ?? 0, amount: sumAmt(todayDeliveredAgg.data) };
  const todayCollections = sumAmt(todayCollectionsAgg.data);
  const outstanding     = sumCol(outstandingAgg.data);

  const staleApproval = staleApprovalAgg.count ?? 0;
  const staleApproved = staleApprovedAgg.count ?? 0;

  // System status
  const tokenExpiresAt = rupyzSession?.data?.expires_at ? new Date(rupyzSession.data.expires_at) : null;
  const tokenExpired = tokenExpiresAt ? tokenExpiresAt.getTime() < Date.now() : false;
  const tokenExpiringSoon = tokenExpiresAt ? !tokenExpired && tokenExpiresAt.getTime() - Date.now() < 4 * 60 * 60 * 1000 : false;
  const lastSyncFailed = lastRupyzSync?.data?.status === "failed";

  // Tasks for the action-items section. Filter by what's actually present.
  const tasks: Array<{
    key: string;
    icon: typeof CheckSquare;
    title: string;
    detail: string;
    href: string;
    accent: "warn" | "accent" | "ok" | "danger";
    badge?: string;
  }> = [];

  if (pendingApproval.count > 0 && ["admin", "approver"].includes(me.role)) {
    tasks.push({
      key: "approve",
      icon: CheckSquare,
      title: `${pendingApproval.count} order${pendingApproval.count === 1 ? "" : "s"} waiting for approval`,
      detail: `Worth ${formatINR(pendingApproval.amount)} · review and approve`,
      href: "/orders?tab=approval",
      accent: "warn",
    });
  }

  if (readyToSend.count > 0 && ["admin", "van_lead", "dispatch"].includes(me.role)) {
    tasks.push({
      key: "send",
      icon: Truck,
      title: `${readyToSend.count} order${readyToSend.count === 1 ? "" : "s"} approved and ready to send`,
      detail: `Worth ${formatINR(readyToSend.amount)} · dispatch or add to a VAN trip`,
      // Dispatch role uses the mobile dispatch app; admin/van_lead get the desktop orders flow
      href: me.role === "dispatch" ? "/dispatch" : "/orders?tab=dispatch",
      accent: "accent",
    });
  }

  if (activeTrips > 0) {
    tasks.push({
      key: "trips",
      icon: Route,
      title: `${activeTrips} VAN trip${activeTrips === 1 ? "" : "s"} on the road`,
      detail: onVanTrip.count > 0
        ? `Carrying ${onVanTrip.count} pre-order${onVanTrip.count === 1 ? "" : "s"} · track progress`
        : `Track real-time progress`,
      href: "/trips",
      accent: "accent",
    });
  }

  if (returnedTrips > 0) {
    tasks.push({
      key: "reconcile",
      icon: Receipt,
      title: `${returnedTrips} trip${returnedTrips === 1 ? "" : "s"} returned, awaiting reconciliation`,
      detail: "Lead is back · close the trip and lock numbers",
      href: "/trips",
      accent: "warn",
      badge: "Action needed",
    });
  }

  // Stale items (only shown if non-zero)
  const stale: Array<{ icon: typeof Clock; text: string; href: string }> = [];
  if (staleApproval > 0) {
    stale.push({
      icon: Clock,
      text: `${staleApproval} order${staleApproval === 1 ? "" : "s"} stuck in approval over 24 hours`,
      href: "/orders?tab=approval",
    });
  }
  if (staleApproved > 0) {
    stale.push({
      icon: Clock,
      text: `${staleApproved} approved order${staleApproved === 1 ? "" : "s"} not yet sent in 2+ days`,
      href: "/orders?tab=dispatch",
    });
  }

  // System problems (only if present)
  const systemIssues: Array<{ text: string; href: string }> = [];
  if (tokenExpired) {
    systemIssues.push({ text: "Rupyz token has expired — sync isn't working", href: "/settings" });
  } else if (tokenExpiringSoon) {
    systemIssues.push({ text: "Rupyz token expires soon — refresh from Settings", href: "/settings" });
  }
  if (lastSyncFailed) {
    systemIssues.push({ text: "Last Rupyz sync failed — check Settings", href: "/settings" });
  }

  return (
    <>
      <PageHeader title={`${greeting()}, ${me.full_name.split(" ")[0]}`} subtitle="Here's what needs your attention today" />

      <div className="p-3 sm:p-6 max-w-5xl space-y-5 sm:space-y-6">

        {/* SYSTEM ISSUES — only when there are problems. Sits at top to grab attention. */}
        {systemIssues.length > 0 && (
          <div className="bg-danger-soft border border-danger/30 rounded-md p-3 sm:p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-danger">
              <AlertCircle size={14}/>
              {systemIssues.length === 1 ? "Action needed" : `${systemIssues.length} issues need attention`}
            </div>
            {systemIssues.map((iss, i) => (
              <Link key={i} href={iss.href} className="flex items-center justify-between text-sm text-ink hover:underline">
                <span>{iss.text}</span>
                <ChevronRight size={14} className="text-ink-subtle"/>
              </Link>
            ))}
          </div>
        )}

        {/* TASKS — the heart of the page. Big rows, prominent buttons. */}
        <section>
          <h2 className="text-2xs uppercase tracking-[0.2em] text-ink-subtle mb-2.5">Today&apos;s tasks</h2>
          {tasks.length === 0 ? (
            <div className="bg-paper-card border border-paper-line rounded-md p-6 sm:p-8 text-center">
              <CheckCircle2 size={32} className="mx-auto text-ok mb-2"/>
              <h3 className="font-semibold text-base mb-0.5">All caught up</h3>
              <p className="text-sm text-ink-muted">
                No orders need approval, no trips need attention. Take a moment.
              </p>
            </div>
          ) : (
            <div className="space-y-2 sm:space-y-2.5">
              {tasks.map(({ key, ...t }) => (
                <TaskCard key={key} {...t} />
              ))}
            </div>
          )}
        </section>

        {/* STALE — only when there's something to nudge about */}
        {stale.length > 0 && (
          <section>
            <h2 className="text-2xs uppercase tracking-[0.2em] text-ink-subtle mb-2.5">Catching up on older items</h2>
            <div className="bg-paper-card border border-paper-line rounded-md divide-y divide-paper-line">
              {stale.map((s, i) => (
                <Link key={i} href={s.href} className="flex items-center justify-between px-3 sm:px-4 py-3 hover:bg-paper-subtle/40 transition-colors">
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-warn shrink-0"/>
                    <span className="text-sm text-ink">{s.text}</span>
                  </div>
                  <ChevronRight size={14} className="text-ink-subtle shrink-0"/>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* TODAY SNAPSHOT — small stats, no buttons. For situational awareness only. */}
        <section>
          <h2 className="text-2xs uppercase tracking-[0.2em] text-ink-subtle mb-2.5">Today at a glance</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            <Stat label="New orders" icon={ShoppingBag} value={todayOrders.count.toLocaleString("en-IN")} sub={formatINR(todayOrders.amount)} />
            <Stat label="Delivered" icon={CheckCircle2} value={todayDelivered.count.toLocaleString("en-IN")} sub={formatINR(todayDelivered.amount)} />
            <Stat label="Collected" icon={IndianRupee} value={formatINR(todayCollections)} sub="VAN cash + credit" />
            <Stat label="Outstanding" icon={AlertTriangle} value={formatINR(outstanding)} sub="across all customers" warn={outstanding > 0} />
          </div>
        </section>

      </div>
    </>
  );
}

// =============================================================================
// COMPONENTS
// =============================================================================

function TaskCard({
  icon: Icon, title, detail, href, accent, badge,
}: {
  icon: typeof CheckSquare;
  title: string;
  detail: string;
  href: string;
  accent: "warn" | "accent" | "ok" | "danger";
  badge?: string;
}) {
  const accentMap: Record<string, { bg: string; border: string; iconColor: string; chevColor: string }> = {
    warn:   { bg: "bg-warn-soft",   border: "border-warn/30",   iconColor: "text-warn",   chevColor: "text-warn" },
    accent: { bg: "bg-accent-soft", border: "border-accent/30", iconColor: "text-accent", chevColor: "text-accent" },
    ok:     { bg: "bg-paper-card",  border: "border-paper-line",iconColor: "text-ok",     chevColor: "text-ok" },
    danger: { bg: "bg-danger-soft", border: "border-danger/30", iconColor: "text-danger", chevColor: "text-danger" },
  };
  const a = accentMap[accent];

  return (
    <Link
      href={href}
      className={`block ${a.bg} border ${a.border} rounded-md p-3 sm:p-4 hover:shadow-card transition-all group`}
    >
      <div className="flex items-start gap-3">
        <div className={`shrink-0 ${a.iconColor} mt-0.5`}>
          <Icon size={18}/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm sm:text-base">{title}</h3>
            {badge && <Badge variant="warn">{badge}</Badge>}
          </div>
          <p className="text-xs sm:text-sm text-ink-muted mt-0.5">{detail}</p>
        </div>
        <ChevronRight size={16} className={`shrink-0 mt-1 ${a.chevColor} group-hover:translate-x-0.5 transition-transform`}/>
      </div>
    </Link>
  );
}

function Stat({
  label, icon: Icon, value, sub, warn,
}: {
  label: string;
  icon: typeof ShoppingBag;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className={`bg-paper-card border ${warn ? "border-warn/30" : "border-paper-line"} rounded-md p-3`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={12} className={warn ? "text-warn" : "text-ink-subtle"}/>
        <span className="text-2xs uppercase tracking-wide text-ink-muted">{label}</span>
      </div>
      <div className="font-bold text-base sm:text-lg tabular truncate">{value}</div>
      {sub && <div className="text-2xs text-ink-subtle mt-0.5 truncate">{sub}</div>}
    </div>
  );
}
