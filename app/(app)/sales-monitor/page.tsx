import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { DashboardTab } from "./dashboard-tab";
import { MisTab } from "./mis-tab";
import { TargetsTab } from "./targets-tab";
import { ReportsTab } from "./reports-tab";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: { tab?: string; date?: string };
};

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "mis", label: "MIS" },
  { key: "reports", label: "Reports" },
  { key: "targets", label: "Targets" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function SalesMonitorPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!appUser || appUser.role !== "admin") {
    return (
      <div className="p-8 text-center">
        <h1 className="text-lg font-semibold mb-2">Not authorized</h1>
        <p className="text-sm text-ink-muted">Sales Monitor is admin-only.</p>
      </div>
    );
  }

  const tab: TabKey = (TABS.find((t) => t.key === searchParams.tab)?.key ?? "dashboard") as TabKey;

  // Default to today in IST. Allow ?date=YYYY-MM-DD override.
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayISO = istNow.toISOString().slice(0, 10);
  const viewDate =
    searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
      ? searchParams.date
      : todayISO;

  // Preserve date across tab switches
  const tabHref = (k: string) =>
    `/sales-monitor?tab=${k}${viewDate !== todayISO ? `&date=${viewDate}` : ""}`;

  // Rupyz token / sync health — for a warning banner.
  // Token expired (optimistic 24h expiry, set when admin pastes it) OR the
  // 15-min sync hasn't landed recently → the Dashboard/MIS data may be stale.
  let tokenWarning: string | null = null;
  {
    const admin = createAdminClient();
    const { data: session } = await admin.from("rupyz_session").select("expires_at, last_team_activity_sync_at").eq("id", 1).maybeSingle();
    const now = Date.now();
    const exp = session?.expires_at ? new Date(session.expires_at).getTime() : 0;
    const lastSync = session?.last_team_activity_sync_at ? new Date(session.last_team_activity_sync_at).getTime() : 0;
    const minsSinceSync = lastSync ? Math.floor((now - lastSync) / 60000) : Infinity;
    if (!exp || now > exp) {
      tokenWarning = "The Rupyz token has expired — the every-15-min sync is paused, so Dashboard & MIS data may be stale. Refresh the token in Settings.";
    } else if (minsSinceSync > 45) {
      const label = minsSinceSync === Infinity ? "never" : `${minsSinceSync} min ago`;
      tokenWarning = `The Rupyz sync last succeeded ${label}. Data may be stale — check the token in Settings.`;
    }
  }

  // Data for the Targets + Reports tabs (both need the JC list)
  let targetsData: { jcs: JcRow[]; areas: AreaRow[]; currentJcId: string | null } | null = null;
  if (tab === "targets" || tab === "reports") {
    const admin = createAdminClient();
    const [{ data: jcs }, { data: areas }] = await Promise.all([
      admin.from("journey_cycles").select("id, jc_number, start_date, end_date").order("start_date"),
      admin.from("areas").select("id, name").order("name"),
    ]);
    const jcList = (jcs ?? []) as JcRow[];
    const current = jcList.find((j) => j.start_date <= todayISO && j.end_date >= todayISO);
    targetsData = { jcs: jcList, areas: (areas ?? []) as AreaRow[], currentJcId: current?.id ?? null };
  }

  return (
    <div className="max-w-md mx-auto p-3 sm:p-6">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight">Sales Monitor</h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Team performance, targets &amp; reporting
        </p>
      </div>

      {/* Token / sync health banner */}
      {tokenWarning && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft/40 px-3 py-2.5 text-sm">
          <span className="text-warn font-semibold shrink-0">⚠</span>
          <div className="flex-1 text-ink">
            {tokenWarning}{" "}
            <Link href="/settings" className="text-accent font-medium hover:underline whitespace-nowrap">
              Open Settings →
            </Link>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <nav className="flex items-center gap-1 border-b border-paper-line mb-5 overflow-x-auto">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-ink-muted hover:text-ink hover:border-paper-line"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {/* Tab content */}
      {tab === "dashboard" && <DashboardTab viewDate={viewDate} todayISO={todayISO} />}
      {tab === "mis" && <MisTab viewDate={viewDate} todayISO={todayISO} />}
      {tab === "reports" && targetsData && (
        <ReportsTab jcs={targetsData.jcs} currentJcId={targetsData.currentJcId} />
      )}
      {tab === "targets" && targetsData && (
        <TargetsTab jcs={targetsData.jcs} areas={targetsData.areas} currentJcId={targetsData.currentJcId} />
      )}
    </div>
  );
}

type JcRow = { id: string; jc_number: number; start_date: string; end_date: string };
type AreaRow = { id: string; name: string };

function ComingSoon({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-10 text-center max-w-2xl">
      <div className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-accent bg-accent-soft/40 rounded-full px-2.5 py-1 mb-3">
        Building next
      </div>
      <h2 className="text-base font-semibold mb-1">{name}</h2>
      <p className="text-sm text-ink-muted max-w-md mx-auto">{desc}</p>
    </div>
  );
}
