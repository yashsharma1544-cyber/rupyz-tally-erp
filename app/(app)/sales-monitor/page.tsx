import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SalesMonitorClient } from "./sales-monitor-client";

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

  if (!appUser || appUser.role !== "admin") {
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

  // Yesterday — for the "Copy from yesterday" affordance.
  const yest = new Date(viewDate + "T00:00:00Z");
  yest.setUTCDate(yest.getUTCDate() - 1);
  const yesterdayISO = yest.toISOString().slice(0, 10);

  // Fetch everything for the view in parallel.
  const [
    { data: salesmen },
    { data: beats },
    { data: assignments },
    { data: targets },
    { data: checkins },
  ] = await Promise.all([
    supabase.from("salesmen")
      .select("id, name, phone")
      .eq("active", true)
      .order("name"),
    supabase.from("beats")
      .select("id, name, city")
      .eq("active", true)
      .order("name"),
    supabase.from("salesman_beat_assignments")
      .select("salesman_id, beat_id")
      .eq("assignment_date", viewDate),
    supabase.from("daily_sales_targets")
      .select("salesman_id, target_kg")
      .eq("target_date", viewDate),
    supabase.from("daily_sales_checkins")
      .select("salesman_id, checked_in_at")
      .eq("checkin_date", viewDate),
  ]);

  return (
    <SalesMonitorClient
      viewDate={viewDate}
      yesterdayDate={yesterdayISO}
      isToday={viewDate === todayISO}
      salesmen={salesmen || []}
      beats={beats || []}
      assignments={assignments || []}
      targets={(targets || []).map(t => ({ salesman_id: t.salesman_id, target_kg: Number(t.target_kg) }))}
      checkins={checkins || []}
    />
  );
}
