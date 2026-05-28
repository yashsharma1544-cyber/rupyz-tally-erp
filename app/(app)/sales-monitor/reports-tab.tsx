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
  const [downloadLevel, setDownloadLevel] = useState<"customer" | "beat" | "area" | "org">("customer");
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
    import("xlsx").then((XLSX) => {
      const data = buildExportRows(downloadLevel, rows, areas, grand);
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Report");
      const jcLabelShort = allJc ? "AllJC" : `JC${jcs.find((j) => j.id === jcId)?.jc_number ?? ""}`;
      XLSX.writeFile(wb, `sales-report-${jcLabelShort}-${downloadLevel}.xlsx`);
    });
  }

  function exportPdf() {
    if (!rows) return;
    Promise.all([import("jspdf"), import("jspdf-autotable")]).then(([jsPDFModule, autoTableModule]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { jsPDF } = jsPDFModule as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const autoTable = (autoTableModule as any).default ?? (autoTableModule as any);

      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const data = buildExportRows(downloadLevel, rows, areas, grand);
      const titleLevel = downloadLevel === "customer" ? "Customer" : downloadLevel === "beat" ? "Beat" : downloadLevel === "area" ? "Area" : "Organisation";
      const periodShort = allJc ? "All JC" : `JC ${jcs.find((j) => j.id === jcId)?.jc_number ?? ""}`;

      // Title block
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text(`Sushil Agencies — Sales Report`, 40, 40);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`${periodShort} · ${titleLevel} level`, 40, 58);
      doc.setFontSize(9);
      const pctStr = pct(grand.a, grand.t)?.toFixed(1) ?? "—";
      doc.text(
        `Target ${fmtKg(grand.t)} kg   |   Achievement ${fmtKg(grand.a)} kg   |   Ach ${pctStr}%   |   Avg/JC ${fmtKg(grand.v)} kg`,
        40,
        74,
      );

      // Table
      if (data.length > 0) {
        const head = [Object.keys(data[0])];
        const body = data.map((r) => Object.values(r).map((v) => (v === "" || v == null ? "" : String(v))));
        autoTable(doc, {
          startY: 92,
          head,
          body,
          styles: { fontSize: 9, cellPadding: 4 },
          headStyles: { fillColor: [40, 80, 60], textColor: 255, fontStyle: "bold" },
          alternateRowStyles: { fillColor: [248, 248, 245] },
          margin: { left: 40, right: 40 },
          theme: "grid",
        });
      }

      // Footer with generation timestamp on each page
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pageCount = (doc.internal as any).getNumberOfPages?.() ?? 1;
      const stamp = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(`Generated ${stamp} · Page ${i} of ${pageCount}`, 40, doc.internal.pageSize.getHeight() - 20);
      }

      const fname = `sales-report-${allJc ? "AllJC" : `JC${jcs.find((j) => j.id === jcId)?.jc_number ?? ""}`}-${downloadLevel}.pdf`;
      doc.save(fname);
    });
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
            <div className="flex gap-2 ml-auto items-end">
              <label className="block">
                <span className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Download level</span>
                <select
                  value={downloadLevel}
                  onChange={(e) => setDownloadLevel(e.target.value as typeof downloadLevel)}
                  className="mt-1 h-9 px-2 rounded border border-paper-line bg-paper text-sm"
                >
                  <option value="customer">Customer</option>
                  <option value="beat">Beat</option>
                  <option value="area">Area</option>
                  <option value="org">Organisation</option>
                </select>
              </label>
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

// Build flat export rows at the chosen granularity (used for Excel)
type ExportLevel = "customer" | "beat" | "area" | "org";
function buildExportRows(
  level: ExportLevel,
  rows: ReportRow[],
  areas: AreaAgg[],
  grand: { t: number; a: number; v: number },
): Record<string, string | number>[] {
  const achPct = (a: number, t: number) =>
    t > 0 ? Math.round((a / t) * 1000) / 10 : "";

  if (level === "customer") {
    return rows.map((r) => ({
      Area: r.area_name,
      Beat: r.beat_name,
      Customer: r.customer_name,
      "Target (kg)": Math.round(r.target_kg * 10) / 10,
      "Achievement (kg)": Math.round(r.achievement_kg * 10) / 10,
      "Ach %": achPct(r.achievement_kg, r.target_kg),
      "Avg Sale (kg)": Math.round(r.avg_kg * 10) / 10,
      "Last Order": r.last_order_date ?? "",
      "Last Order kg": Math.round(r.last_order_kg * 10) / 10,
    }));
  }

  if (level === "beat") {
    const out: Record<string, string | number>[] = [];
    for (const a of areas) {
      for (const b of a.beats) {
        out.push({
          Area: a.area_name,
          Beat: b.beat_name,
          "Target (kg)": Math.round(b.target * 10) / 10,
          "Achievement (kg)": Math.round(b.ach * 10) / 10,
          "Ach %": achPct(b.ach, b.target),
          "Avg Sale (kg)": Math.round(b.avg * 10) / 10,
        });
      }
    }
    return out;
  }

  if (level === "area") {
    return areas.map((a) => ({
      Area: a.area_name,
      "Target (kg)": Math.round(a.target * 10) / 10,
      "Achievement (kg)": Math.round(a.ach * 10) / 10,
      "Ach %": achPct(a.ach, a.target),
      "Avg Sale (kg)": Math.round(a.avg * 10) / 10,
    }));
  }

  // org
  return [
    {
      Organisation: "Sushil Agencies",
      "Target (kg)": Math.round(grand.t * 10) / 10,
      "Achievement (kg)": Math.round(grand.a * 10) / 10,
      "Ach %": achPct(grand.a, grand.t),
      "Avg Sale (kg)": Math.round(grand.v * 10) / 10,
    },
  ];
}
