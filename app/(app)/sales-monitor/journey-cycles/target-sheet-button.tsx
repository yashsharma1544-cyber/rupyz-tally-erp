"use client";

import { useState } from "react";
import { getBeatTargets } from "./pjp-actions";

type Salesman = { id: string; name?: string; full_name?: string };
type Beat = { id: string; name: string };
type JourneyCycleLite = {
  id: string;
  jc_number: number;
  start_date: string;
  end_date: string;
  days_count: number;
};

type Props = {
  jc: JourneyCycleLite;
  salesmen: Salesman[];
  beats: Beat[];
  /** planMap[salesmanId][jcDay] = beatId | null */
  planMap: Record<string, Record<number, string | null>>;
  /** visitMap[salesmanId][jcDay] = "order" | "collection" */
  visitMap: Record<string, Record<number, "order" | "collection">>;
};

const TEAL = "FF0D5B58";
const TEALLT = "FFD9EDEB";
const GREY = "FFF3F4F6";
const AMBER = "FFFEF3C7";
const YELLOW = "FFFFF9C4";
const KG = "#,##,##0;[Red]-#,##,##0;-";

function addDays(iso: string, n: number): Date {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const pretty = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
const wd = (d: Date) =>
  d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });

export function TargetSheetButton({ jc, salesmen, beats, planMap, visitMap }: Props) {
  const [from, setFrom] = useState(() => iso(new Date()));
  const [to, setTo] = useState(jc.end_date);
  const [pick, setPick] = useState<string>("__all");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const nameOf = (s: Salesman) => s.name ?? s.full_name ?? "Salesman";

  const chosen = pick === "__all" ? salesmen : salesmen.filter((s) => s.id === pick);

  async function build() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await getBeatTargets(jc.id);
      if (!res.ok) throw new Error(res.error || "Could not load targets");
      const targetByBeat = new Map(res.targets.map((t) => [t.beat_id, t.target_kg]));
      const beatName = new Map(beats.map((b) => [b.id, b.name]));

      // Days in the selected window
      const days: { day: number; date: Date }[] = [];
      for (let d = 1; d <= jc.days_count; d++) {
        const date = addDays(jc.start_date, d - 1);
        const s = iso(date);
        if (s >= from && s <= to) days.push({ day: d, date });
      }
      if (days.length === 0) throw new Error("No cycle days fall in that range.");
      if (chosen.length === 0) throw new Error("Pick at least one salesman.");

      // Order-visit days per beat across the WHOLE cycle (not just the window),
      // so a weekly Jalna beat divides by 4 on its own.
      const visitDays = new Map<string, Set<number>>();
      for (const s of salesmen) {
        for (let d = 1; d <= jc.days_count; d++) {
          const bid = planMap[s.id]?.[d];
          if (!bid) continue;
          if ((visitMap[s.id]?.[d] ?? "order") === "collection") continue;
          if (!visitDays.has(bid)) visitDays.set(bid, new Set());
          visitDays.get(bid)!.add(d);
        }
      }

      // How many salesmen share a beat on a given day (to split joint visits)
      const sharers = (bid: string, day: number) =>
        salesmen.filter(
          (s) =>
            planMap[s.id]?.[day] === bid &&
            (visitMap[s.id]?.[day] ?? "order") === "order"
        ).length || 1;

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "Sushil Agencies ERP";
      wb.created = new Date();

      const totalsRef: { name: string; sheet: string; row: number }[] = [];

      for (const s of chosen) {
        const label = nameOf(s).slice(0, 28);
        const ws = wb.addWorksheet(label, {
          views: [{ state: "frozen", ySplit: 5 }],
        });

        ws.mergeCells(1, 1, 1, 8);
        const t = ws.getCell(1, 1);
        t.value = `JC${jc.jc_number} targets \u00b7 ${nameOf(s)}`;
        t.font = { bold: true, size: 14, color: { argb: TEAL } };
        ws.getRow(1).height = 22;

        ws.mergeCells(2, 1, 2, 8);
        const sub = ws.getCell(2, 1);
        sub.value =
          `${pretty(days[0].date)} to ${pretty(days[days.length - 1].date)} \u00b7 ` +
          `cycle ${jc.start_date} to ${jc.end_date} \u00b7 targets in kg`;
        sub.font = { size: 9, italic: true, color: { argb: "FF6B7280" } };

        ws.mergeCells(3, 1, 3, 8);
        const legend = ws.getCell(3, 1);
        legend.value =
          "Fill the yellow Actual kg column (example: 2450). Variance calculates itself. " +
          "Amber rows are collection days and carry no kg target.";
        legend.font = { size: 9, bold: true, color: { argb: "FF92400E" } };
        legend.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };

        const head = ["Date", "Day", "JC Day", "Beat", "Visit type", "Target kg", "Actual kg", "Variance"];
        const hr = ws.getRow(5);
        head.forEach((h, i) => {
          const c = hr.getCell(i + 1);
          c.value = h;
          c.font = { bold: true, size: 10, color: { argb: "FF374151" } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
          c.alignment = { horizontal: i >= 5 || i === 2 ? "right" : "left", vertical: "middle" };
          c.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
        });
        hr.height = 18;

        let r = 6;
        for (const { day, date } of days) {
          const bid = planMap[s.id]?.[day] ?? null;
          const isColl = (visitMap[s.id]?.[day] ?? "order") === "collection";
          const bname = bid ? beatName.get(bid) ?? "(unknown beat)" : "\u2014 off \u2014";

          let target = 0;
          if (bid && !isColl) {
            const total = targetByBeat.get(bid) ?? 0;
            const nDays = visitDays.get(bid)?.size ?? 1;
            target = Math.round(total / nDays / sharers(bid, day));
          }

          const row = ws.getRow(r);
          row.getCell(1).value = pretty(date);
          row.getCell(2).value = wd(date);
          row.getCell(3).value = day;
          row.getCell(4).value = bname;
          row.getCell(5).value = bid ? (isColl ? "Collection" : "Order") : "";
          row.getCell(6).value = target;
          row.getCell(7).value = null;
          row.getCell(8).value = { formula: `IF(G${r}="","",G${r}-F${r})` };

          for (let i = 1; i <= 8; i++) {
            const c = row.getCell(i);
            c.font = {
              size: 10,
              color: { argb: bid ? "FF111827" : "FF9CA3AF" },
              bold: i === 6 && target > 0,
            };
            c.alignment = { horizontal: i >= 6 || i === 3 ? "right" : "left", vertical: "middle" };
            c.border = { bottom: { style: "thin", color: { argb: "FFF3F4F6" } } };
            if (isColl) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } };
          }
          row.getCell(6).numFmt = KG;
          row.getCell(7).numFmt = KG;
          row.getCell(8).numFmt = KG;
          row.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
          r++;
        }

        const tot = ws.getRow(r);
        tot.getCell(1).value = "Total";
        tot.getCell(6).value = { formula: `SUM(F6:F${r - 1})` };
        tot.getCell(7).value = { formula: `SUM(G6:G${r - 1})` };
        tot.getCell(8).value = { formula: `IF(G${r}=0,"",G${r}-F${r})` };
        for (let i = 1; i <= 8; i++) {
          const c = tot.getCell(i);
          c.font = { bold: true, size: 10 };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEALLT } };
          c.border = { top: { style: "medium", color: { argb: "FF9CA3AF" } } };
          c.alignment = { horizontal: i >= 6 || i === 3 ? "right" : "left" };
          if (i >= 6) c.numFmt = KG;
        }

        [11, 7, 8, 30, 12, 13, 13, 13].forEach((w, i) => (ws.getColumn(i + 1).width = w));
        ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 8 } };
        totalsRef.push({ name: nameOf(s), sheet: label, row: r });
      }

      // Summary first
      const sum = wb.addWorksheet("Summary");
      wb.worksheets.splice(wb.worksheets.indexOf(sum), 1);
      wb.worksheets.unshift(sum);

      sum.mergeCells(1, 1, 1, 4);
      const st = sum.getCell(1, 1);
      st.value = `JC${jc.jc_number} target sheet`;
      st.font = { bold: true, size: 14, color: { argb: TEAL } };
      sum.mergeCells(2, 1, 2, 4);
      sum.getCell(2, 1).value =
        `${pretty(days[0].date)} to ${pretty(days[days.length - 1].date)} \u00b7 ` +
        (chosen.length === salesmen.length
          ? "all salesmen"
          : chosen.map((c) => nameOf(c)).join(", "));
      sum.getCell(2, 1).font = { size: 9, italic: true, color: { argb: "FF6B7280" } };

      ["Salesman", "Target kg", "Actual kg", "Variance"].forEach((h, i) => {
        const c = sum.getCell(4, i + 1);
        c.value = h;
        c.font = { bold: true, size: 10, color: { argb: "FF374151" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
        c.alignment = { horizontal: i ? "right" : "left" };
      });

      let sr = 5;
      for (const t of totalsRef) {
        sum.getCell(sr, 1).value = t.name;
        sum.getCell(sr, 2).value = { formula: `'${t.sheet}'!F${t.row}` };
        sum.getCell(sr, 3).value = { formula: `'${t.sheet}'!G${t.row}` };
        sum.getCell(sr, 4).value = { formula: `IF(C${sr}=0,"",C${sr}-B${sr})` };
        for (let i = 2; i <= 4; i++) {
          sum.getCell(sr, i).numFmt = KG;
          sum.getCell(sr, i).alignment = { horizontal: "right" };
        }
        sr++;
      }
      sum.getCell(sr, 1).value = "Total";
      sum.getCell(sr, 2).value = { formula: `SUM(B5:B${sr - 1})` };
      sum.getCell(sr, 3).value = { formula: `SUM(C5:C${sr - 1})` };
      sum.getCell(sr, 4).value = { formula: `IF(C${sr}=0,"",C${sr}-B${sr})` };
      for (let i = 1; i <= 4; i++) {
        const c = sum.getCell(sr, i);
        c.font = { bold: true, size: 11 };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEALLT } };
        c.border = { top: { style: "medium", color: { argb: "FF9CA3AF" } } };
        c.alignment = { horizontal: i > 1 ? "right" : "left" };
        if (i > 1) c.numFmt = KG;
      }

      const notes = [
        "",
        "How targets are worked out",
        "Each beat's JC target is divided by the number of order-visit days planned for it in this cycle.",
        "A beat visited weekly therefore divides by 4; a beat visited once carries its whole target on that day.",
        "When two salesmen share a beat on the same day, that day's figure is split equally between them.",
        "Collection days keep the beat but carry no kg target.",
        "Source: beat_jc_targets and the PJP grid, Rupyz-Tally ERP.",
      ];
      let nr = sr + 2;
      for (const line of notes) {
        const c = sum.getCell(nr, 1);
        c.value = line;
        c.font = {
          size: 9,
          bold: line.startsWith("How"),
          color: { argb: line.startsWith("How") ? "FF374151" : "FF6B7280" },
        };
        nr++;
      }
      [26, 14, 14, 14].forEach((w, i) => (sum.getColumn(i + 1).width = w));

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const who =
        chosen.length === salesmen.length
          ? "All"
          : chosen.length === 1
          ? nameOf(chosen[0]).replace(/[^A-Za-z0-9]+/g, "_")
          : `${chosen.length}_salesmen`;
      a.download = `JC${jc.jc_number}_Targets_${who}_${from}_to_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`${days.length} days \u00b7 ${chosen.length} salesman sheet(s)`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-paper-line bg-paper-card px-3 py-2">
      <span className="text-2xs uppercase tracking-wider text-ink-subtle font-semibold">
        Target sheet
      </span>
      <input
        type="date"
        value={from}
        min={jc.start_date}
        max={jc.end_date}
        onChange={(e) => setFrom(e.target.value)}
        className="text-xs border border-paper-line rounded px-2 py-1 bg-white"
      />
      <span className="text-ink-subtle text-xs">to</span>
      <input
        type="date"
        value={to}
        min={jc.start_date}
        max={jc.end_date}
        onChange={(e) => setTo(e.target.value)}
        className="text-xs border border-paper-line rounded px-2 py-1 bg-white"
      />
      <select
        value={pick}
        onChange={(e) => {
          setPick(e.target.value);
          setMsg(null);
        }}
        className="text-xs border border-paper-line rounded px-2 py-1 bg-white max-w-[180px]"
      >
        <option value="__all">All salesmen</option>
        {salesmen.map((s) => (
          <option key={s.id} value={s.id}>
            {nameOf(s)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={build}
        disabled={busy || from > to || chosen.length === 0}
        className="text-xs font-medium rounded px-3 py-1.5 bg-accent text-white disabled:opacity-50"
      >
        {busy ? "Building\u2026" : "Download Excel"}
      </button>
      {msg && <span className="text-2xs text-ink-subtle">{msg}</span>}
    </div>
  );
}
