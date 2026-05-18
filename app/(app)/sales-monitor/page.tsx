import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SalesMonitorClient } from "./sales-monitor-client";
import { getSummaryForDate } from "@/lib/sales-monitor/compute";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: { date?: string };
};

export default async function SalesMonitorPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!appUser || !["admin", "accounts"].includes(appUser.role)) {
    return (
      <div className="p-8 text-center">
        <h1 className="text-lg font-semibold mb-2">Not authorized</h1>
        <p className="text-sm text-ink-muted">Sales Monitor is admin-only.</p>
      </div>
    );
  }

  // Default to today in IST. Allow ?date=YYYY-MM-DD override.
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayISO = istNow.toISOString().slice(0, 10);
  const viewDate = searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
    ? searchParams.date
    : todayISO;

  const yest = new Date(viewDate + "T00:00:00Z");
  yest.setUTCDate(yest.getUTCDate() - 1);
  const yesterdayISO = yest.toISOString().slice(0, 10);

  // Single bulk fetch — one RPC returns the full per-salesman summary row.
  // Beats are still needed for the beat-selector dropdown.
  const [summary, { data: beats }] = await Promise.all([
    getSummaryForDate(viewDate),
    supabase.from("beats").select("id, name, city").eq("active", true).order("name"),
  ]);

  return (
    <SalesMonitorClient
      viewDate={viewDate}
      yesterdayDate={yesterdayISO}
      isToday={viewDate === todayISO}
      summary={summary}
      beats={beats || []}
    />
  );
}
