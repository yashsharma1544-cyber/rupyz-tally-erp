import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { FocusKanban } from "./focus-kanban";
import { LastUpdated } from "./last-updated";

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

export async function DashboardTab({ viewDate, todayISO, lastSyncAt }: { viewDate: string; todayISO: string; lastSyncAt: string | null }) {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("salesman_daily_activity")
    .select(
      "rupyz_user_id, salesman_id, name, mobile, sc_count, tc_count, pc_count, nc_count, order_value, order_count, weight_kg, productivity_percent, coverage_percent, beat_list, last_activity",
    )
    .eq("activity_date", viewDate)
    .order("name");

  const rows = (data ?? []) as ActivityRow[];

  // ---------------------------------------------------------------------------
  // Pull today's PJP plan so we can show planned beats per salesman even when
  // the salesman has not started the day (no activity row yet from Rupyz).
  // ---------------------------------------------------------------------------
  type PlanInfo = {
    beats: Array<{ id: string; name: string }>;
    name: string | null;
    mobile: string | null;
  };
  const planBySalesman = new Map<string, PlanInfo>();
  const targetPerVisitByBeatId = new Map<string, number>();
  const beatJcTargetByBeatId = new Map<string, number>();
  const beatNameById = new Map<string, string>();
  const beatIdByName = new Map<string, string>();

  const { data: jcRows } = await admin
    .from("journey_cycles")
    .select("id, start_date, end_date")
    .lte("start_date", viewDate)
    .gte("end_date", viewDate)
    .limit(1);
  const jc = jcRows && jcRows[0];

  if (jc) {
    const startMs = new Date((jc.start_date as string) + "T00:00:00Z").getTime();
    const viewMs = new Date(viewDate + "T00:00:00Z").getTime();
    const jcDay = Math.floor((viewMs - startMs) / 86400000) + 1;

    const { data: pjp } = await admin
      .from("beat_journey_plan")
      .select("salesman_id, beat_id, beat:beats(id, name), salesman:salesmen(id, name, phone, active)")
      .eq("jc_id", jc.id)
      .eq("jc_day", jcDay)
      .not("salesman_id", "is", null);

    for (const row of pjp ?? []) {
      const sid = row.salesman_id as string | null;
      if (!sid) continue;
      const sm = Array.isArray(row.salesman) ? row.salesman[0] : row.salesman;
      if (!sm || !(sm as { active: boolean }).active) continue;
      const beat = Array.isArray(row.beat) ? row.beat[0] : row.beat;
      const beatId = (beat as { id: string } | null)?.id ?? (row.beat_id as string | null) ?? null;
      const beatName = (beat as { name: string } | null)?.name ?? null;
      const fullName = (sm as { name: string | null }).name ?? null;
      const mobile = (sm as { phone: string | null }).phone ?? null;
      if (!planBySalesman.has(sid)) {
        planBySalesman.set(sid, { beats: [], name: fullName, mobile });
      }
      if (beatId && beatName) {
        planBySalesman.get(sid)!.beats.push({ id: beatId, name: beatName });
        beatNameById.set(beatId, beatName);
        beatIdByName.set(beatName, beatId);
      }
    }

    // Compute per-visit target for every beat: JC target ÷ distinct visit-days in PJP.
    // Multiple salesmen on the same beat-day count as one visit.
    const { data: allPjpForJc } = await admin
      .from("beat_journey_plan")
      .select("beat_id, jc_day")
      .eq("jc_id", jc.id);
    const visitsByBeatId = new Map<string, Set<number>>();
    for (const row of allPjpForJc ?? []) {
      const bid = row.beat_id as string;
      const day = row.jc_day as number;
      if (!bid || day == null) continue;
      if (!visitsByBeatId.has(bid)) visitsByBeatId.set(bid, new Set());
      visitsByBeatId.get(bid)!.add(day);
    }

    const { data: targets } = await admin
      .from("jc_beat_targets")
      .select("beat_id, beat_target")
      .eq("jc_id", jc.id);
    for (const t of targets ?? []) {
      const bid = t.beat_id as string | null;
      if (!bid) continue;
      const visitCount = visitsByBeatId.get(bid)?.size ?? 0;
      const total = Number(t.beat_target) || 0;
      if (total > 0) beatJcTargetByBeatId.set(bid, total);
      if (visitCount > 0 && total > 0) {
        targetPerVisitByBeatId.set(bid, total / visitCount);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Build the display rows = union of activity rows + plan-only rows.
  // Activity rows take precedence (they have real numbers). Plan-only rows get
  // zero counts and are flagged so the UI can render them subtly.
  // ---------------------------------------------------------------------------
  type DisplayRow = {
    key: string;
    salesman_id: string | null;
    name: string | null;
    beats: Array<{ id: string; name: string }>;
    beatLabel: string;
    beatTargetKg: number;
    beatJcTargetKg: number;
    sc_count: number;
    tc_count: number;
    pc_count: number;
    order_value: number;
    weight_kg: number;
    planOnly: boolean;
  };

  function sumPerVisitTargets(beats: Array<{ id: string; name: string }>): number {
    let sum = 0;
    for (const b of beats) sum += targetPerVisitByBeatId.get(b.id) || 0;
    return sum;
  }

  function sumJcTargets(beats: Array<{ id: string; name: string }>): number {
    let sum = 0;
    for (const b of beats) sum += beatJcTargetByBeatId.get(b.id) || 0;
    return sum;
  }

  const seenSalesmen = new Set<string>();
  const displayRows: DisplayRow[] = [];

  for (const r of rows) {
    const plannedBeats = r.salesman_id ? planBySalesman.get(r.salesman_id)?.beats ?? [] : [];
    const activityBeatNames = r.beat_list && r.beat_list.length > 0 ? r.beat_list.map(b => b.name) : [];
    // Merge: planned beats first (have ids), then activity beats not already in the planned set
    const merged: Array<{ id: string; name: string }> = [...plannedBeats];
    const seenNames = new Set(plannedBeats.map(b => b.name));
    for (const name of activityBeatNames) {
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      const id = beatIdByName.get(name);
      // We still want to show the beat name even if we don't know its id; just use name as a synthetic key
      merged.push({ id: id ?? `name:${name}`, name });
    }
    const beatLabel = merged.length > 0 ? merged.map(b => b.name).join(", ") : "—";
    displayRows.push({
      key: r.salesman_id ?? `unmapped-${r.rupyz_user_id}`,
      salesman_id: r.salesman_id,
      name: r.name,
      beats: merged,
      beatLabel,
      beatTargetKg: sumPerVisitTargets(merged),
      beatJcTargetKg: sumJcTargets(merged),
      sc_count: r.sc_count || 0,
      tc_count: r.tc_count || 0,
      pc_count: r.pc_count || 0,
      order_value: Number(r.order_value) || 0,
      weight_kg: Number(r.weight_kg) || 0,
      planOnly: false,
    });
    if (r.salesman_id) seenSalesmen.add(r.salesman_id);
  }

  // Add plan-only rows (salesmen with a PJP entry but no activity yet)
  for (const [sid, plan] of planBySalesman.entries()) {
    if (seenSalesmen.has(sid)) continue;
    displayRows.push({
      key: sid,
      salesman_id: sid,
      name: plan.name,
      beats: plan.beats,
      beatLabel: plan.beats.length > 0 ? plan.beats.map(b => b.name).join(", ") : "—",
      beatTargetKg: sumPerVisitTargets(plan.beats),
      beatJcTargetKg: sumJcTargets(plan.beats),
      sc_count: 0,
      tc_count: 0,
      pc_count: 0,
      order_value: 0,
      weight_kg: 0,
      planOnly: true,
    });
  }

  displayRows.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  // Totals come from actual activity only (planned-only rows are zero anyway).
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
        <LastUpdated lastSyncAt={lastSyncAt} />
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiTile label="Scheduled (SC)" value={tot.sc.toLocaleString("en-IN")} />
        <KpiTile label="Visited (TC)" value={tot.tc.toLocaleString("en-IN")} sub={`${pct(tot.tc, tot.sc)} of SC`} />
        <KpiTile label="Productive (PC)" value={tot.pc.toLocaleString("en-IN")} sub={`${pct(tot.pc, tot.tc)} of TC`} accent="ok" />
        <KpiTile
          label="Order qty (kg)"
          value={fmtKg(tot.kg)}
          sub={(() => {
            // Achievement vs today's target (if target known)
            const seen = new Set<string>();
            let target = 0;
            for (const row of displayRows) {
              for (const b of row.beats) {
                if (!seen.has(b.id)) {
                  seen.add(b.id);
                  target += targetPerVisitByBeatId.get(b.id) || 0;
                }
              }
            }
            if (target > 0) {
              return `${pct(tot.kg, target)} of target · ${inr(tot.value)}`;
            }
            return inr(tot.value);
          })()}
        />
        <KpiTile
          label="Order target (kg)"
          value={(() => {
            const seen = new Set<string>();
            let target = 0;
            for (const row of displayRows) {
              for (const b of row.beats) {
                if (!seen.has(b.id)) {
                  seen.add(b.id);
                  target += targetPerVisitByBeatId.get(b.id) || 0;
                }
              }
            }
            return target > 0 ? fmtKg(target) : "—";
          })()}
          sub="today's planned visits"
        />
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
                  <th className="px-3 py-2.5 font-medium text-right" title="Full JC beat target (jc_beat_targets.beat_target)">Target (JC)</th>
                  <th className="px-3 py-2.5 font-medium text-right" title="Per-visit target = JC beat target ÷ planned visit-days (same-day multi-salesman counts as one visit)">Target (today)</th>
                  <th className="px-3 py-2.5 font-medium text-right">SC</th>
                  <th className="px-3 py-2.5 font-medium text-right">TC</th>
                  <th className="px-3 py-2.5 font-medium text-right">PC</th>
                  <th className="px-3 py-2.5 font-medium text-right">TC%</th>
                  <th className="px-3 py-2.5 font-medium text-right">PC%</th>
                  <th className="px-3 py-2.5 font-medium text-right">Kg</th>
                  <th className="px-3 py-2.5 font-medium text-right">Order value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {displayRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-ink-muted text-sm">
                      No activity recorded for {prettyDate(viewDate)}.
                      {isToday && " The sync may not have run yet today."}
                    </td>
                  </tr>
                )}
                {displayRows.map((r) => {
                  return (
                    <tr key={r.key} className={`hover:bg-paper-subtle/40 ${r.planOnly ? "text-ink-muted" : ""}`}>
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
                        {r.planOnly && (
                          <span className="ml-1.5 text-2xs text-ink-subtle italic" title="Planned in PJP — no activity recorded yet">not started</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-ink-muted">
                        {r.beats.length === 0 ? "—" : r.beats.map((b, idx) => (
                          <span key={b.id}>
                            {b.id.startsWith("name:") ? (
                              <span>{b.name}</span>
                            ) : (
                              <Link
                                href={`/sales-monitor/reports/beat/${b.id}?all=true`}
                                className="hover:text-accent hover:underline"
                              >
                                {b.name}
                              </Link>
                            )}
                            {idx < r.beats.length - 1 ? ", " : ""}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-3 text-right tabular text-ink-subtle">{r.beatJcTargetKg > 0 ? fmtKg(r.beatJcTargetKg) : "—"}</td>
                      <td className="px-3 py-3 text-right tabular text-ink-muted">{r.beatTargetKg > 0 ? fmtKg(r.beatTargetKg) : "—"}</td>
                      <td className="px-3 py-3 text-right tabular">{r.planOnly ? "—" : r.sc_count}</td>
                      <td className="px-3 py-3 text-right tabular">{r.planOnly ? "—" : r.tc_count}</td>
                      <td className="px-3 py-3 text-right tabular font-medium text-ok">{r.planOnly ? "—" : r.pc_count}</td>
                      <td className="px-3 py-3 text-right tabular">{r.planOnly ? "—" : pct(r.tc_count, r.sc_count)}</td>
                      <td className="px-3 py-3 text-right tabular">{r.planOnly ? "—" : pct(r.pc_count, r.tc_count)}</td>
                      <td className="px-3 py-3 text-right tabular font-medium">{r.planOnly ? "—" : fmtKg(r.weight_kg)}</td>
                      <td className="px-3 py-3 text-right tabular">{r.planOnly ? "—" : inr(r.order_value)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {displayRows.length > 0 && (
                <tfoot className="border-t-2 border-paper-line bg-paper-subtle/40 font-semibold">
                  <tr>
                    <td className="px-3 py-2.5" colSpan={2}>Total</td>
                    <td className="px-3 py-2.5 text-right tabular text-ink-muted">{(() => {
                      // Sum each beat's full JC target only once
                      const seen = new Set<string>();
                      let totalJcTarget = 0;
                      for (const row of displayRows) {
                        for (const b of row.beats) {
                          if (!seen.has(b.id)) {
                            seen.add(b.id);
                            totalJcTarget += beatJcTargetByBeatId.get(b.id) || 0;
                          }
                        }
                      }
                      return totalJcTarget > 0 ? fmtKg(totalJcTarget) : "—";
                    })()}</td>
                    <td className="px-3 py-2.5 text-right tabular">{(() => {
                      // Sum each beat's per-visit target only once (same beat may appear on multiple rows
                      // when 2 salesmen are scheduled to walk it today — still counts as one visit).
                      const seen = new Set<string>();
                      let totalTarget = 0;
                      for (const row of displayRows) {
                        for (const b of row.beats) {
                          if (!seen.has(b.id)) {
                            seen.add(b.id);
                            totalTarget += targetPerVisitByBeatId.get(b.id) || 0;
                          }
                        }
                      }
                      return totalTarget > 0 ? fmtKg(totalTarget) : "—";
                    })()}</td>
                    <td className="px-3 py-2.5 text-right tabular">{tot.sc}</td>
                    <td className="px-3 py-2.5 text-right tabular">{tot.tc}</td>
                    <td className="px-3 py-2.5 text-right tabular text-ok">{tot.pc}</td>
                    <td className="px-3 py-2.5 text-right tabular">{pct(tot.tc, tot.sc)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{pct(tot.pc, tot.tc)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtKg(tot.kg)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{inr(tot.value)}</td>
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

