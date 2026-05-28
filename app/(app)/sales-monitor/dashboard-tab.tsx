import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { FocusKanban } from "./focus-kanban";

type ActivityRow = {
  rupyz_user_id: number;
  salesman_id: string | null;
  name: string | null;
  mobile: string | null;
  sc_count: number;
  tc_count: number;
  pc_count: number;
  nc_count: number;
  order_value: number;
  order_count: number;
  weight_kg: number;
  productivity_percent: number;
  coverage_percent: number;
  beat_list: Array<{ id: number; name: string; sc_count?: number }> | null;
  last_activity: string | null;
};

function pct(num: number, den: number): string {
  if (!den || den <= 0) return "—";
  return ((num / den) * 100).toFixed(0) + "%";
}

function inr(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function fmtKg(n: number): string {
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function addDaysISO(iso: string, delta: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function prettyDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export async function DashboardTab({ viewDate, todayISO }: { viewDate: string; todayISO: string }) {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("salesman_daily_activity")
    .select(
      "rupyz_user_id, salesman_id, name, mobile, sc_count, tc_count, pc_count, nc_count, order_value, order_count, weight_kg, productivity_percent, coverage_percent, beat_list, last_activity",
    )
    .eq("activity_date", viewDate)
    .order("name");

  const rows = (data ?? []) as ActivityRow[];

  // Totals
  const tot = rows.reduce(
    (a, r) => {
      a.sc += r.sc_count || 0;
      a.tc += r.tc_count || 0;
      a.pc += r.pc_count || 0;
      a.nc += r.nc_count || 0;
      a.value += Number(r.order_value) || 0;
      a.kg += Number(r.weight_kg) || 0;
      a.orders += r.order_count || 0;
      return a;
    },
    { sc: 0, tc: 0, pc: 0, nc: 0, value: 0, kg: 0, orders: 0 },
  );

  const prevHref = `/sales-monitor?tab=dashboard&date=${addDaysISO(viewDate, -1)}`;
  const nextDate = addDaysISO(viewDate, 1);
  const canGoNext = viewDate < todayISO;
  const isToday = viewDate === todayISO;

  return (
    <div className="space-y-5">
      {/* Date stepper */}
      <div className="flex items-center gap-2">
        <Link
          href={prevHref}
          className="inline-flex items-center justify-center h-8 px-2.5 rounded border border-paper-line bg-paper-card text-sm hover:bg-paper-subtle"
          aria-label="Previous day"
        >
          ‹
        </Link>
        <div className="text-sm font-semibold tabular px-2">
          {prettyDate(viewDate)}
          {isToday && <span className="ml-2 text-2xs font-medium text-accent uppercase tracking-wide">Today</span>}
        </div>
        {canGoNext ? (
          <Link
            href={`/sales-monitor?tab=dashboard${nextDate !== todayISO ? `&date=${nextDate}` : ""}`}
            className="inline-flex items-center justify-center h-8 px-2.5 rounded border border-paper-line bg-paper-card text-sm hover:bg-paper-subtle"
            aria-label="Next day"
          >
            ›
          </Link>
        ) : (
          <span className="inline-flex items-center justify-center h-8 px-2.5 rounded border border-paper-line bg-paper-subtle text-sm text-ink-subtle cursor-default">
            ›
          </span>
        )}
        {error && (
          <span className="text-2xs text-danger ml-2">Failed to load: {error.message}</span>
        )}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Scheduled (SC)" value={tot.sc.toLocaleString("en-IN")} />
        <KpiTile label="Visited (TC)" value={tot.tc.toLocaleString("en-IN")} sub={`${pct(tot.tc, tot.sc)} of SC`} />
        <KpiTile label="Productive (PC)" value={tot.pc.toLocaleString("en-IN")} sub={`${pct(tot.pc, tot.tc)} of TC`} accent="ok" />
        <KpiTile label="Order qty (kg)" value={fmtKg(tot.kg)} sub={inr(tot.value)} />
      </div>

      {/* Per-salesman table */}
      <section>
        <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold mb-2">
          Today&apos;s plan &amp; activity per salesman
        </h2>
        <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-paper-subtle/60 border-b border-paper-line">
                <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2.5 font-medium">Salesman</th>
                  <th className="px-3 py-2.5 font-medium">Beat</th>
                  <th className="px-3 py-2.5 font-medium text-right">SC</th>
                  <th className="px-3 py-2.5 font-medium text-right">TC</th>
                  <th className="px-3 py-2.5 font-medium text-right">PC</th>
                  <th className="px-3 py-2.5 font-medium text-right">TC%</th>
                  <th className="px-3 py-2.5 font-medium text-right">PC%</th>
                  <th className="px-3 py-2.5 font-medium text-right">Order value</th>
                  <th className="px-3 py-2.5 font-medium text-right">Kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-ink-muted text-sm">
                      No activity recorded for {prettyDate(viewDate)}.
                      {isToday && " The sync may not have run yet today."}
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const beat = r.beat_list && r.beat_list.length > 0 ? r.beat_list.map((b) => b.name).join(", ") : "—";
                  return (
                    <tr key={r.rupyz_user_id} className="hover:bg-paper-subtle/40">
                      <td className="px-3 py-3">
                        {r.salesman_id ? (
                          <Link href={`/sales-monitor/${r.salesman_id}`} className="font-medium hover:text-accent">
                            {r.name ?? "—"}
                          </Link>
                        ) : (
                          <span className="font-medium">{r.name ?? "—"}</span>
                        )}
                        {!r.salesman_id && (
                          <span className="ml-1.5 text-2xs text-warn" title="Not mapped to a salesman (set rupyz_id)">unmapped</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-ink-muted">{beat}</td>
                      <td className="px-3 py-3 text-right tabular">{r.sc_count}</td>
                      <td className="px-3 py-3 text-right tabular">{r.tc_count}</td>
                      <td className="px-3 py-3 text-right tabular font-medium text-ok">{r.pc_count}</td>
                      <td className="px-3 py-3 text-right tabular">{pct(r.tc_count, r.sc_count)}</td>
                      <td className="px-3 py-3 text-right tabular">{pct(r.pc_count, r.tc_count)}</td>
                      <td className="px-3 py-3 text-right tabular font-medium">{inr(Number(r.order_value) || 0)}</td>
                      <td className="px-3 py-3 text-right tabular">{fmtKg(r.weight_kg)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="border-t-2 border-paper-line bg-paper-subtle/40 font-semibold">
                  <tr>
                    <td className="px-3 py-2.5" colSpan={2}>Total</td>
                    <td className="px-3 py-2.5 text-right tabular">{tot.sc}</td>
                    <td className="px-3 py-2.5 text-right tabular">{tot.tc}</td>
                    <td className="px-3 py-2.5 text-right tabular text-ok">{tot.pc}</td>
                    <td className="px-3 py-2.5 text-right tabular">{pct(tot.tc, tot.sc)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{pct(tot.pc, tot.tc)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{inr(tot.value)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtKg(tot.kg)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
        <p className="text-2xs text-ink-subtle mt-2">
          SC = scheduled calls · TC = visited · PC = ordered · TC% = TC/SC · PC% = PC/TC. Live from Rupyz team-activity.
        </p>
      </section>

      {/* Focus customers */}
      <section>
        <h2 className="text-2xs uppercase tracking-wide text-ink-muted font-semibold mb-2">
          Focus customers — no order in 30 days
        </h2>
        <FocusKanban viewDate={viewDate} />
      </section>
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "ok" | "warn";
}) {
  const valueColor = accent === "ok" ? "text-ok" : accent === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-3">
      <div className="text-2xs uppercase tracking-wide text-ink-muted font-medium">{label}</div>
      <div className={`text-xl font-bold tabular mt-0.5 ${valueColor}`}>{value}</div>
      {sub && <div className="text-2xs text-ink-subtle mt-0.5">{sub}</div>}
    </div>
  );
}
