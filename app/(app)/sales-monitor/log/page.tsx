// =============================================================================
// /sales-monitor/log — admin observability for daily report sends
// =============================================================================
// Shows the audit trail from daily_sales_reports: who got what report when,
// success/failure, error messages, attempts. Failed rows have a Retry button.
//
// Default view: last 7 days, all salesmen, all report types, all statuses.
// Filter via query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD&salesman=<id>&type=morning&status=failed
// =============================================================================

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LogClient } from "./log-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export interface LogRow {
  id: string;
  salesman_id: string;
  salesman_name: string;
  report_date: string;
  report_type: "morning" | "midday" | "evening";
  status: "sent" | "failed" | "pending";
  sent_at: string | null;
  attempts: number;
  error_message: string | null;
  wati_message_id: string | null;
}

export interface SalesmanOpt {
  id: string;
  name: string;
}

function isoDateOffset(offsetDays: number): string {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const now = new Date(Date.now() + istOffsetMs);
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

export default async function LogPage({
  searchParams,
}: {
  searchParams: {
    from?: string;
    to?: string;
    salesman?: string;
    type?: string;
    status?: string;
  };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?from=/sales-monitor/log");

  const { data: me } = await supabase
    .from("app_users")
    .select("role, active")
    .eq("id", user.id)
    .single();
  if (!me?.active || !["admin", "accounts"].includes(me.role)) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">Not authorized</h1>
        <p className="text-sm text-ink-muted">
          Send-log access is admin only.
        </p>
      </div>
    );
  }

  // Resolve filter defaults — last 7 days
  const today = isoDateOffset(0);
  const weekAgo = isoDateOffset(-6); // -6 → 7 days inclusive
  const from = searchParams.from && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.from)
    ? searchParams.from
    : weekAgo;
  const to = searchParams.to && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.to)
    ? searchParams.to
    : today;
  const salesmanFilter = searchParams.salesman || "";
  const typeFilter = searchParams.type || "";
  const statusFilter = searchParams.status || "";

  // Load salesmen for the filter dropdown
  const { data: salesmenData } = await supabase
    .from("salesmen")
    .select("id, name")
    .eq("active", true)
    .order("name");
  const salesmen: SalesmanOpt[] = (salesmenData ?? []) as SalesmanOpt[];

  // Build the log query
  let q = supabase
    .from("daily_sales_reports")
    .select(
      "id, salesman_id, report_date, report_type, status, sent_at, attempts, error_message, wati_message_id",
    )
    .gte("report_date", from)
    .lte("report_date", to)
    .order("report_date", { ascending: false })
    .order("report_type", { ascending: true });

  if (salesmanFilter) q = q.eq("salesman_id", salesmanFilter);
  if (typeFilter) q = q.eq("report_type", typeFilter);
  if (statusFilter) q = q.eq("status", statusFilter);

  const { data: rawLogs, error } = await q;
  if (error) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-base font-semibold mb-1">
          Couldn&apos;t load send log
        </h1>
        <p className="text-xs text-ink-muted">{error.message}</p>
      </div>
    );
  }

  // Hydrate salesman names from the salesmen list (one in-memory lookup)
  const nameById = new Map<string, string>();
  for (const s of salesmen) nameById.set(s.id, s.name);

  const logs: LogRow[] = ((rawLogs ?? []) as Omit<LogRow, "salesman_name">[])
    .map((r) => ({
      ...r,
      salesman_name: nameById.get(r.salesman_id) ?? "(unknown salesman)",
    }));

  // Compute today's snapshot for the summary strip
  const todayLogs = logs.filter((l) => l.report_date === today);
  const todayCounts = {
    sent: todayLogs.filter((l) => l.status === "sent").length,
    failed: todayLogs.filter((l) => l.status === "failed").length,
    pending: todayLogs.filter((l) => l.status === "pending").length,
    total: todayLogs.length,
  };

  return (
    <LogClient
      logs={logs}
      salesmen={salesmen}
      filters={{ from, to, salesman: salesmanFilter, type: typeFilter, status: statusFilter }}
      todayCounts={todayCounts}
      todayISO={today}
    />
  );
}
