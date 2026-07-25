'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { exportXlsx, stamp, type XlsxColumn } from './export-xlsx';
import { loadSales, companyOf, beatOf, pct, fmtPct, type SaleRow } from './use-sales-data';

type Metric = 'kg' | 'amount';
type Cell = { cy: number; ly: number };
type BeatNode = { beat: string; jc: Record<number, Cell>; total: Cell; customers: Set<string> };

const JCS = Array.from({ length: 13 }, (_, i) => i + 1);
const blank = (): Cell => ({ cy: 0, ly: 0 });

function priorLabel(fy: string): string {
  const m = fy.match(/^(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${String(Number(m[1]) - 1).padStart(2, '0')}-${String(Number(m[2]) - 1).padStart(2, '0')}`;
}

export default function BeatMatrixTab() {
  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState('all');
  const [metric, setMetric] = useState<Metric>('kg');
  const [fy, setFy] = useState<string | null>(null);
  const [csvBeat, setCsvBeat] = useState('all');

  useEffect(() => {
    loadSales()
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  const fys = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => r.fy_label))).sort();
  }, [rows]);

  const companies = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => companyOf(r.company_name))))
      .filter(Boolean)
      .sort();
  }, [rows]);

  const latestFy = fys[fys.length - 1] ?? '';
  const cyFy = fy ?? latestFy;
  const lyFy = priorLabel(cyFy);

  // The cycle currently in progress — only meaningful for the live FY.
  const currentJc = useMemo(() => {
    if (!rows || !latestFy) return 0;
    const live = rows.filter((r) => r.fy_label === latestFy).map((r) => r.jc_number);
    return live.length ? Math.max(...live) : 0;
  }, [rows, latestFy]);
  const liveJc = cyFy === latestFy ? currentJc : null;

  const model = useMemo(() => {
    if (!rows || !cyFy) return null;

    const scoped = rows.filter((r) => {
      if (company !== 'all' && companyOf(r.company_name) !== company) return false;
      return r.fy_label === cyFy || r.fy_label === lyFy;
    });

    const beats = new Map<string, BeatNode>();

    for (const r of scoped) {
      const b = beatOf(r.beat);
      const side: keyof Cell = r.fy_label === cyFy ? 'cy' : 'ly';

      let node = beats.get(b);
      if (!node) {
        node = { beat: b, jc: {}, total: blank(), customers: new Set() };
        beats.set(b, node);
      }
      (node.jc[r.jc_number] ??= blank())[side] += r[metric];
      node.total[side] += r[metric];
      node.customers.add(r.party_name);
    }

    const list = Array.from(beats.values()).sort((a, b) => b.total.cy - a.total.cy);

    const footer: { jc: Record<number, Cell>; total: Cell } = { jc: {}, total: blank() };
    let custCount = 0;
    for (const b of list) {
      custCount += b.customers.size;
      for (const n of JCS) {
        const c = b.jc[n];
        if (!c) continue;
        (footer.jc[n] ??= blank()).cy += c.cy;
        footer.jc[n].ly += c.ly;
      }
      footer.total.cy += b.total.cy;
      footer.total.ly += b.total.ly;
    }

    return { list, footer, custCount };
  }, [rows, company, metric, cyFy, lyFy]);

  async function exportCsv() {
    if (!model) return;
    const src = csvBeat === 'all' ? model.list : model.list.filter((b) => b.beat === csvBeat);
    const money = metric === 'amount';

    const columns: XlsxColumn[] = [
      { key: 'beat', header: 'Beat', width: 32 },
      { key: 'cust', header: 'Customers', type: 'int' },
    ];
    for (const n of JCS) {
      columns.push({ key: `jc${n}cy`, header: `JC${n} CY`, type: money ? 'money' : 'number' });
      columns.push({ key: `jc${n}ly`, header: `JC${n} LY`, type: money ? 'money' : 'number' });
    }
    columns.push(
      { key: 'totCy', header: `Total ${cyFy}`, type: money ? 'money' : 'number', width: 16 },
      { key: 'totLy', header: `Total ${lyFy}`, type: money ? 'money' : 'number', width: 16 },
      { key: 'chg', header: 'Change %', type: 'percent' }
    );

    const build = (b: (typeof src)[number]) => {
      const o: Record<string, unknown> = { beat: b.beat, cust: b.customers.size };
      for (const n of JCS) {
        o[`jc${n}cy`] = Math.round(b.jc[n]?.cy ?? 0);
        o[`jc${n}ly`] = Math.round(b.jc[n]?.ly ?? 0);
      }
      o.totCy = Math.round(b.total.cy);
      o.totLy = Math.round(b.total.ly);
      o.chg = pct(b.total.cy, b.total.ly);
      return o;
    };

    const totals: Record<string, unknown> = { beat: 'All beats', cust: model.custCount };
    for (const n of JCS) {
      totals[`jc${n}cy`] = Math.round(model.footer.jc[n]?.cy ?? 0);
      totals[`jc${n}ly`] = Math.round(model.footer.jc[n]?.ly ?? 0);
    }
    totals.totCy = Math.round(model.footer.total.cy);
    totals.totLy = Math.round(model.footer.total.ly);
    totals.chg = pct(model.footer.total.cy, model.footer.total.ly);

    await exportXlsx({
      filename: `Beat_Matrix_${metric}_${(csvBeat === 'all' ? 'all' : csvBeat).replace(/[^A-Za-z0-9]+/g, '_')}_${cyFy}_${stamp()}`,
      sheetName: `Beat x JC ${cyFy}`,
      title: `Beat × JC Matrix · ${money ? 'Value' : 'Kg'}`,
      subtitle: `FY ${cyFy} vs FY ${lyFy} · ${
        company === 'all' ? 'both companies' : company
      } · ${src.length} beats${liveJc ? ` · JC${liveJc} in progress` : ''}`,
      columns,
      rows: src.map(build),
      totals: csvBeat === 'all' ? totals : undefined,
      highlightHeaders: liveJc ? [`JC${liveJc} CY`, `JC${liveJc} LY`] : [],
    });
  }

  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="text-xs font-medium text-red-800">Could not load the matrix</p>
        <p className="mt-1 break-words font-mono text-[11px] text-red-700">{error}</p>
      </div>
    );

  if (!rows || !model) return <p className="p-4 text-sm text-gray-500">Loading beat matrix…</p>;

  const fmt = (n: number) =>
    n === 0
      ? '—'
      : metric === 'kg'
      ? Math.round(n).toLocaleString('en-IN')
      : '₹' + Math.round(n).toLocaleString('en-IN');

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Beat × JC Matrix · CY vs LY</h2>
          <p className="text-xs text-gray-500">
            FY {cyFy} vs FY {lyFy} · {model.list.length} beats ·{' '}
            {model.custCount.toLocaleString('en-IN')} customers
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="all">Both companies</option>
            {companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <div className="flex overflow-hidden rounded-md border border-gray-300">
            {(['kg', 'amount'] as Metric[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`px-3 py-1.5 text-sm ${
                  metric === m ? 'bg-teal-700 text-white' : 'bg-white text-gray-600'
                }`}
              >
                {m === 'kg' ? 'Kg' : '₹'}
              </button>
            ))}
          </div>

          <div className="flex overflow-hidden rounded-md border border-gray-300">
            {fys.map((f) => (
              <button
                key={f}
                onClick={() => setFy(f)}
                className={`px-3 py-1.5 text-sm ${
                  cyFy === f ? 'bg-teal-700 text-white' : 'bg-white text-gray-600'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <select
            value={csvBeat}
            onChange={(e) => setCsvBeat(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="all">All beats</option>
            {model.list.map((b) => (
              <option key={b.beat} value={b.beat}>
                {b.beat}
              </option>
            ))}
          </select>
          <button
            onClick={exportCsv}
            className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            Excel
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="text-sm">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-20 border-b border-r border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600"
              >
                Beat
              </th>
              {JCS.map((n) => (
                <th
                  key={n}
                  colSpan={2}
                  className={`border-b border-l px-2 py-1.5 text-center text-xs font-semibold ${
                    n === liveJc
                      ? 'border-teal-300 bg-teal-100 text-teal-900'
                      : 'border-gray-200 bg-gray-50 text-gray-700'
                  }`}
                >
                  JC{n}
                  {n === liveJc && (
                    <span className="ml-1 text-[9px] font-medium uppercase tracking-wide text-teal-700">
                      live
                    </span>
                  )}
                </th>
              ))}
              <th
                colSpan={3}
                className="border-b border-l border-gray-200 bg-gray-50 px-2 py-1.5 text-center text-xs font-semibold text-gray-700"
              >
                Total
              </th>
            </tr>
            <tr>
              {JCS.map((n) => (
                <SubHead key={n} live={n === liveJc} />
              ))}
              <th className="border-b border-l border-gray-200 bg-gray-50 px-2 py-1 text-right text-[10px] font-medium text-gray-500">
                CY
              </th>
              <th className="border-b border-gray-200 bg-gray-50 px-2 py-1 text-right text-[10px] font-medium text-gray-500">
                LY
              </th>
              <th className="border-b border-gray-200 bg-gray-50 px-2 py-1 text-right text-[10px] font-medium text-gray-500">
                Δ
              </th>
            </tr>
          </thead>

          <tbody>
            {model.list.map((b) => (
              <tr key={b.beat} className="border-t border-gray-100 hover:bg-teal-50/30">
                <td className="sticky left-0 z-10 whitespace-nowrap border-r border-gray-200 bg-white px-3 py-2">
                  <Link
                    href={`/sales/beat/${encodeURIComponent(b.beat)}`}
                    className="font-medium text-gray-900 hover:text-teal-800 hover:underline"
                  >
                    {b.beat}
                  </Link>
                  <span className="ml-2 text-[10px] text-gray-400">{b.customers.size} cust</span>
                </td>
                {JCS.map((n) => (
                  <Pair key={n} cell={b.jc[n]} fmt={fmt} bold live={n === liveJc} />
                ))}
                <TotalCells cell={b.total} fmt={fmt} />
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="sticky left-0 z-10 border-r border-gray-200 bg-gray-50 px-3 py-2 text-gray-900">
                All beats
              </td>
              {JCS.map((n) => (
                <Pair key={n} cell={model.footer.jc[n]} fmt={fmt} bold live={n === liveJc} />
              ))}
              <TotalCells cell={model.footer.total} fmt={fmt} />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="px-1 text-[11px] text-gray-400">
        Tap a beat to open its own page with customers, weekly split and CSV. Teal marks JC
        {liveJc ?? '—'}, the cycle in progress; amber marks a cycle running behind last year.
      </p>
    </section>
  );
}

function SubHead({ live }: { live?: boolean }) {
  const base = live ? 'bg-teal-50' : 'bg-gray-50';
  return (
    <>
      <th
        className={`border-b border-l px-2 py-1 text-right text-[10px] font-medium ${base} ${
          live ? 'border-teal-300 text-teal-800' : 'border-gray-200 text-gray-500'
        }`}
      >
        CY
      </th>
      <th
        className={`border-b border-gray-200 px-2 py-1 text-right text-[10px] font-medium ${base} ${
          live ? 'text-teal-700' : 'text-gray-400'
        }`}
      >
        LY
      </th>
    </>
  );
}

function Pair({
  cell,
  fmt,
  bold,
  live,
}: {
  cell: Cell | undefined;
  fmt: (n: number) => string;
  bold?: boolean;
  live?: boolean;
}) {
  const cy = cell?.cy ?? 0;
  const ly = cell?.ly ?? 0;
  const behind = ly > 0 && cy < ly;
  return (
    <>
      <td
        className={`whitespace-nowrap border-l px-2 py-1.5 text-right tabular-nums ${
          live ? 'border-teal-300 bg-teal-50/70' : 'border-gray-100'
        } ${bold ? 'font-medium text-gray-900' : 'text-gray-700'}`}
      >
        {fmt(cy)}
      </td>
      <td
        className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-gray-400 ${
          behind ? 'bg-amber-50' : live ? 'bg-teal-50/70' : ''
        }`}
      >
        {fmt(ly)}
      </td>
    </>
  );
}

function TotalCells({ cell, fmt }: { cell: Cell; fmt: (n: number) => string }) {
  const p = pct(cell.cy, cell.ly);
  return (
    <>
      <td className="whitespace-nowrap border-l border-gray-200 px-2 py-1.5 text-right font-semibold tabular-nums text-gray-900">
        {fmt(cell.cy)}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-gray-500">
        {fmt(cell.ly)}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
        {p == null ? (
          <span className="text-gray-400">—</span>
        ) : (
          <span className={p >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-600'}>
            {fmtPct(p)}
          </span>
        )}
      </td>
    </>
  );
}
