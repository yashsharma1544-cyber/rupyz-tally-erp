import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";

type Row = {
  rupyz_user_id: number;
  salesman_id: string | null;
  name: string | null;
  mobile: string | null;
  roles: string | null;
  manager: string | null;
  sc_count: number;
  tc_count: number;
  pc_count: number;
  nc_count: number;
  lead_count: number;
  telephonic_order_count: number;
  order_value: number;
  order_count: number;
  weight_kg: number;
  volume: number;
  productivity_percent: number;
  coverage_percent: number;
  beat_list: Array<{ id: number; name: string }> | null;
};

function inr(n: number): string {
  return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
}
function fmtKg(n: number): string {
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}
function addDaysISO(iso: string, d: number): string {
  const x = new Date(iso + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
}
function prettyDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function MisTab({ viewDate, todayISO }: { viewDate: string; todayISO: string }) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("salesman_daily_activity")
    .select(
      "rupyz_user_id, salesman_id, name, mobile, roles, manager, sc_count, tc_count, pc_count, nc_count, lead_count, telephonic_order_count, order_value, order_count, weight_kg, volume, productivity_percent, coverage_percent, beat_list",
    )
    .eq("activity_date", viewDate)
    .order("order_value", { ascending: false });

  const rows = (data ?? []) as Row[];
  const n = rows.length || 1;

  const tot = rows.reduce(
    (a, r) => {
      a.sc += r.sc_count || 0;
      a.tc += r.tc_count || 0;
      a.pc += r.pc_count || 0;
      a.nc += r.nc_count || 0;
      a.leads += r.lead_count || 0;
      a.value += Number(r.order_value) || 0;
      a.kg += Number(r.weight_kg) || 0;
      a.vol += Number(r.volume) || 0;
      a.prod += Number(r.productivity_percent) || 0;
      a.cov += Number(r.coverage_percent) || 0;
      return a;
    },
    { sc: 0, tc: 0, pc: 0, nc: 0, leads: 0, value: 0, kg: 0, vol: 0, prod: 0, cov: 0 },
  );
  // Rupyz computes overall productivity/coverage as the AVERAGE of per-salesman %.
  const productivity = rows.length ? tot.prod / n : 0;
  const coverage = rows.length ? tot.cov / n : 0;

  const isToday = viewDate === todayISO;
  const canNext = viewDate < todayISO;
  const nextDate = addDaysISO(viewDate, 1);

  return (
    <div className="space-y-5">
      {/* Date stepper */}
      <div className="flex items-center gap-2">
        <Link
          href={`/sales-monitor?tab=mis&date=${addDaysISO(viewDate, -1)}`}
          className="inline-flex items-center justify-center h-8 px-2.5 rounded border border-paper-line bg-paper-card text-sm hover:bg-paper-subtle"
          aria-label="Previous day"
        >
          ‹
        </Link>
        <div className="text-sm font-semibold tabular px-2">
          {prettyDate(viewDate)}
          {isToday && <span className="ml-2 text-2xs font-medium text-accent uppercase tracking-wide">Today</span>}
        </div>
        {canNext ? (
          <Link
            href={`/sales-monitor?tab=mis${nextDate !== todayISO ? `&date=${nextDate}` : ""}`}
            className="inline-flex items-center justify-center h-8 px-2.5 rounded border border-paper-line bg-paper-card text-sm hover:bg-paper-subtle"
            aria-label="Next day"
          >
            ›
          </Link>
        ) : (
          <span className="inline-flex items-center justify-center h-8 px-2.5 rounded border border-paper-line bg-paper-subtle text-sm text-ink-subtle">›</span>
        )}
      </div>

      {/* Header stat strip */}
      <div className="bg-paper-card border border-paper-line rounded-md p-4">
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Stat label="SC" value={tot.sc.toLocaleString("en-IN")} />
          <Stat label="TC" value={tot.tc.toLocaleString("en-IN")} />
          <Stat label="PC" value={tot.pc.toLocaleString("en-IN")} accent="ok" />
          <Stat label="NC" value={tot.nc.toLocaleString("en-IN")} />
          <Stat label="Leads" value={tot.leads.toLocaleString("en-IN")} />
          <Stat label="Productivity" value={productivity.toFixed(2) + "%"} />
          <Stat label="Coverage" value={coverage.toFixed(2) + "%"} />
          <Stat label="Weight" value={fmtKg(tot.kg) + " kg"} />
          <Stat label="Order value" value={inr(tot.value)} />
        </div>
      </div>

      {/* Per-salesman table */}
      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-paper-subtle/60 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Beats</th>
                <th className="px-3 py-2.5 font-medium text-right">SC</th>
                <th className="px-3 py-2.5 font-medium text-right">TC</th>
                <th className="px-3 py-2.5 font-medium text-right">PC</th>
                <th className="px-3 py-2.5 font-medium text-right">NC</th>
                <th className="px-3 py-2.5 font-medium text-right">Order value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-ink-muted text-sm">
                    No activity recorded for {prettyDate(viewDate)}.
                    {isToday && " The sync runs every 15 minutes."}
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const beats = r.beat_list && r.beat_list.length > 0 ? r.beat_list.map((b) => b.name).join(", ") : "—";
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
                      {r.mobile && <div className="text-2xs text-ink-subtle">{r.mobile}</div>}
                      {r.roles && <div className="text-2xs text-ink-subtle">{r.roles}</div>}
                    </td>
                    <td className="px-3 py-3 text-ink-muted">{beats}</td>
                    <td className="px-3 py-3 text-right tabular">{r.sc_count}</td>
                    <td className="px-3 py-3 text-right tabular">{r.tc_count}</td>
                    <td className="px-3 py-3 text-right tabular font-medium text-ok">{r.pc_count}</td>
                    <td className="px-3 py-3 text-right tabular">{r.nc_count}</td>
                    <td className="px-3 py-3 text-right tabular font-medium">{inr(Number(r.order_value) || 0)}</td>
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
                  <td className="px-3 py-2.5 text-right tabular">{tot.nc}</td>
                  <td className="px-3 py-2.5 text-right tabular">{inr(tot.value)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="text-2xs text-ink-subtle">
        Mirrors the Rupyz team-activity (MIS) screen · synced every 15 min · SC scheduled · TC visited · PC ordered · NC no-order.
      </p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "ok" }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-ink-muted font-medium">{label}</div>
      <div className={`text-lg font-bold tabular ${accent === "ok" ? "text-ok" : "text-ink"}`}>{value}</div>
    </div>
  );
}
