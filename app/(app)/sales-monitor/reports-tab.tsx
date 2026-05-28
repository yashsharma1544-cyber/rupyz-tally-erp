"use client";

import { useMemo, useState, type ReactNode } from "react";
import { getReportRows, type ReportRow } from "./reports-actions";

type JC = { id: string; jc_number: number; start_date: string; end_date: string };

function fmtKg(n: number): string {
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}
function pct(ach: number, tgt: number): number | null {
  if (!tgt || tgt <= 0) return null;
  return (ach / tgt) * 100;
}
function pctClass(p: number | null): string {
  if (p == null) return "text-ink-subtle";
  if (p >= 100) return "text-ok font-semibold";
  if (p >= 50) return "text-warn font-semibold";
  return "text-danger font-semibold";
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

type BeatAgg = {
  beat_id: string;
  beat_name: string;
  target: number;
  ach: number;
  avg: number;
  customers: ReportRow[];
};
type AreaAgg = {
  area_id: string;
  area_name: string;
  target: number;
  ach: number;
  avg: number;
  beats: BeatAgg[];
};

export function ReportsTab({ jcs, currentJcId }: { jcs: JC[]; currentJcId: string | null }) {
  const [jcId, setJcId] = useState<string>(currentJcId ?? jcs[0]?.id ?? "");
  const [allJc, setAllJc] = useState(false);
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openAreas, setOpenAreas] = useState<Set<string>>(new Set());
  const [openBeats, setOpenBeats] = useState<Set<string>>(new Set());

  const jcLabel = (j: JC) => `JC ${j.jc_number} (${j.start_date.slice(5)} → ${j.end_date.slice(5)})`;

  async function load() {
    setLoading(true);
    setErr(null);
    const res = await getReportRows(allJc ? null : jcId, allJc);
    setLoading(false);
    if ("error" in res) {
      setErr(res.error);
      setRows(null);
    } else {
      setRows(res.rows);
    }
  }

  // Roll up customer rows → beats → areas
  const areas: AreaAgg[] = useMemo(() => {
    if (!rows) return [];
    const areaMap = new Map<string, AreaAgg>();
    for (const r of rows) {
      let a = areaMap.get(r.area_id);
      if (!a) {
        a = { area_id: r.area_id, area_name: r.area_name, target: 0, ach: 0, avg: 0, beats: [] };
        areaMap.set(r.area_id, a);
      }
      let b = a.beats.find((x) => x.beat_id === r.beat_id);
      if (!b) {
        b = { beat_id: r.beat_id, beat_name: r.beat_name, target: 0, ach: 0, avg: 0, customers: [] };
        a.beats.push(b);
      }
      b.customers.push(r);
      b.target += r.target_kg;
      b.ach += r.achievement_kg;
      b.avg += r.avg_kg;
      a.target += r.target_kg;
      a.ach += r.achievement_kg;
      a.avg += r.avg_kg;
    }
    const out = Array.from(areaMap.values());
    out.forEach((a) => {
      a.beats.sort((x, y) => y.target - x.target);
      a.beats.forEach((b) => b.customers.sort((x, y) => y.target_kg - x.target_kg));
    });
    out.sort((x, y) => y.target - x.target);
    return out;
  }, [rows]);

  const grand = useMemo(
    () => areas.reduce((acc, a) => ({ t: acc.t + a.target, a: acc.a + a.ach, v: acc.v + a.avg }), { t: 0, a: 0, v: 0 }),
    [areas],
  );

  // KPI extras: beat counts by achievement bucket, and the gap-to-target
  const kpi = useMemo(() => {
    if (!rows) return null;
    const allBeats = areas.flatMap((a) => a.beats);
    const beatsWithTarget = allBeats.filter((b) => b.target > 0);
    const onTrack = beatsWithTarget.filter((b) => b.ach / b.target >= 1).length;
    const lagging = beatsWithTarget.filter((b) => b.ach / b.target < 0.5).length;
    const gap = Math.max(0, grand.t - grand.a);
    const custWithTarget = rows.filter((r) => r.target_kg > 0).length;
    const custAchieved = rows.filter((r) => r.target_kg > 0 && r.achievement_kg >= r.target_kg).length;
    return { onTrack, lagging, totalBeats: beatsWithTarget.length, gap, custWithTarget, custAchieved };
  }, [rows, areas, grand]);

  function toggleArea(id: string) {
    setOpenAreas((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleBeat(id: string) {
    setOpenBeats((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function exportExcel() {
    if (!rows) return;
    // dynamic import keeps the page light
    import("xlsx").then((XLSX) => {
      const data = rows.map((r) => ({
        Area: r.area_name,
        Beat: r.beat_name,
        Customer: r.customer_name,
        "Target (kg)": r.target_kg,
        "Achievement (kg)": r.achievement_kg,
        "Avg Sale (kg)": r.avg_kg,
        "Ach %": r.target_kg > 0 ? Math.round((r.achievement_kg / r.target_kg) * 1000) / 10 : "",
        "Last Order": r.last_order_date ?? "",
        "Last Order kg": r.last_order_kg,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Report");
      const label = allJc ? "AllJC" : `JC${jcs.find((j) => j.id === jcId)?.jc_number ?? ""}`;
      XLSX.writeFile(wb, `sales-report-${label}.xlsx`);
    });
  }

  function exportPdf() {
    window.print();
  }

  const periodLabel = allJc ? "All JCs" : jcLabel(jcs.find((j) => j.id === jcId) ?? jcs[0]);

  return (
    <div className="space-y-5">
      {/* Controls (hidden when printing) */}
      <div className="bg-paper-card border border-paper-line rounded-md p-4 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Journey Cycle</span>
            <select
              value={jcId}
              onChange={(e) => setJcId(e.target.value)}
              disabled={allJc}
              className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm disabled:opacity-50"
            >
              {jcs.map((j) => (
                <option key={j.id} value={j.id}>{jcLabel(j)}</option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm h-9">
            <input type="checkbox" checked={allJc} onChange={(e) => setAllJc(e.target.checked)} />
            All JC
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="h-9 px-4 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Run report"}
          </button>
          {rows && (
            <div className="flex gap-2 ml-auto">
              <button onClick={exportExcel} className="h-9 px-3 rounded border border-paper-line bg-paper-card text-sm hover:bg-paper-subtle">
                Export Excel
              </button>
              <button onClick={exportPdf} className="h-9 px-3 rounded border border-paper-line bg-paper-card text-sm hover:bg-paper-subtle">
                Export PDF
              </button>
            </div>
          )}
        </div>
        {err && <div className="mt-3 text-sm text-danger">{err}</div>}
      </div>

      {rows && kpi && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 print:grid-cols-4">
          <ReportKpi
            label="Target"
            value={`${fmtKg(grand.t)} kg`}
            sub={`${areas.length} areas`}
          />
          <ReportKpi
            label="Achievement"
            value={`${fmtKg(grand.a)} kg`}
            sub={grand.t > 0 ? `gap ${fmtKg(kpi.gap)} kg` : "no target set"}
          />
          <ReportKpi
            label="Achievement %"
            value={pct(grand.a, grand.t) != null ? `${pct(grand.a, grand.t)!.toFixed(1)}%` : "—"}
            valueClass={pctClass(pct(grand.a, grand.t))}
            sub="of target"
          />
          <ReportKpi
            label="On-track beats"
            value={`${kpi.onTrack}/${kpi.totalBeats}`}
            sub={`${kpi.lagging} under 50%`}
          />
        </div>
      )}

      {rows && (
        <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-paper-line">
            <div className="font-semibold text-sm">Target vs Achievement — {periodLabel}</div>
            <div className="text-2xs text-ink-muted mt-0.5">
              Target {fmtKg(grand.t)} kg · Achievement {fmtKg(grand.a)} kg ·
              {" "}{pct(grand.a, grand.t)?.toFixed(1) ?? "—"}% · Avg/JC {fmtKg(grand.v)} kg
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-paper-subtle/60 border-b border-paper-line">
                <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                  <th className="px-3 py-2.5 font-medium">Area / Beat / Customer</th>
                  <th className="px-3 py-2.5 font-medium text-right">Target</th>
                  <th className="px-3 py-2.5 font-medium text-right">Achievement</th>
                  <th className="px-3 py-2.5 font-medium text-right">Ach %</th>
                  <th className="px-3 py-2.5 font-medium text-right">Avg/JC</th>
                  <th className="px-3 py-2.5 font-medium text-right">Last order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {areas.map((a) => {
                  const aPct = pct(a.ach, a.target);
                  const aOpen = openAreas.has(a.area_id);
                  return (
                    <FragmentArea key={a.area_id}>
                      <tr className="bg-paper-subtle/30 hover:bg-paper-subtle/50 font-semibold">
                        <td className="px-3 py-2.5">
                          <button onClick={() => toggleArea(a.area_id)} className="inline-flex items-center gap-1.5 hover:text-accent">
                            <span className={`transition-transform ${aOpen ? "rotate-90" : ""}`}>›</span>
                            {a.area_name}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular">{fmtKg(a.target)}</td>
                        <td className="px-3 py-2.5 text-right tabular">{fmtKg(a.ach)}</td>
                        <td className={`px-3 py-2.5 text-right tabular ${pctClass(aPct)}`}>{aPct != null ? aPct.toFixed(0) + "%" : "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular text-ink-muted">{fmtKg(a.avg)}</td>
                        <td className="px-3 py-2.5"></td>
                      </tr>
                      {aOpen &&
                        a.beats.map((b) => {
                          const bPct = pct(b.ach, b.target);
                          const bOpen = openBeats.has(b.beat_id);
                          return (
                            <FragmentArea key={b.beat_id}>
                              <tr className="hover:bg-paper-subtle/40">
                                <td className="px-3 py-2 pl-8">
                                  <button onClick={() => toggleBeat(b.beat_id)} className="inline-flex items-center gap-1.5 font-medium hover:text-accent">
                                    <span className={`transition-transform ${bOpen ? "rotate-90" : ""}`}>›</span>
                                    {b.beat_name}
                                  </button>
                                </td>
                                <td className="px-3 py-2 text-right tabular">{fmtKg(b.target)}</td>
                                <td className="px-3 py-2 text-right tabular">{fmtKg(b.ach)}</td>
                                <td className={`px-3 py-2 text-right tabular ${pctClass(bPct)}`}>{bPct != null ? bPct.toFixed(0) + "%" : "—"}</td>
                                <td className="px-3 py-2 text-right tabular text-ink-muted">{fmtKg(b.avg)}</td>
                                <td className="px-3 py-2"></td>
                              </tr>
                              {bOpen &&
                                b.customers.map((c) => {
                                  const cPct = pct(c.achievement_kg, c.target_kg);
                                  return (
                                    <tr key={c.customer_id} className="bg-paper-subtle/10 text-xs">
                                      <td className="px-3 py-1.5 pl-14 text-ink-muted">{c.customer_name}</td>
                                      <td className="px-3 py-1.5 text-right tabular">{fmtKg(c.target_kg)}</td>
                                      <td className="px-3 py-1.5 text-right tabular">{fmtKg(c.achievement_kg)}</td>
                                      <td className={`px-3 py-1.5 text-right tabular ${pctClass(cPct)}`}>{cPct != null ? cPct.toFixed(0) + "%" : "—"}</td>
                                      <td className="px-3 py-1.5 text-right tabular text-ink-subtle">{fmtKg(c.avg_kg)}</td>
                                      <td className="px-3 py-1.5 text-right text-ink-subtle whitespace-nowrap">
                                        {fmtDate(c.last_order_date)}{c.last_order_kg > 0 ? ` · ${fmtKg(c.last_order_kg)}kg` : ""}
                                      </td>
                                    </tr>
                                  );
                                })}
                            </FragmentArea>
                          );
                        })}
                    </FragmentArea>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!rows && !loading && (
        <div className="bg-paper-card border border-dashed border-paper-line rounded-md p-8 text-center text-sm text-ink-muted">
          Pick a Journey Cycle (or All JC) and Run report.
        </div>
      )}
    </div>
  );
}

// Helper to group multiple <tr> without a wrapping element
function FragmentArea({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function ReportKpi({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-3">
      <div className="text-2xs uppercase tracking-wide text-ink-muted font-medium">{label}</div>
      <div className={`text-xl font-bold tabular mt-0.5 ${valueClass ?? "text-ink"}`}>{value}</div>
      {sub && <div className="text-2xs text-ink-subtle mt-0.5">{sub}</div>}
    </div>
  );
}
