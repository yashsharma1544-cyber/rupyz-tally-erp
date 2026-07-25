'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { downloadCsv } from './shared';
import { loadSales, companyOf, beatOf, pct, fmtPct, type SaleRow } from './use-sales-data';

type Metric = 'kg' | 'amount';
type Cell = { cy: number; ly: number };
type CustNode = { name: string; company: string; jc: Record<number, Cell>; total: Cell };
type BeatNode = {
  beat: string;
  jc: Record<number, Cell>;
  total: Cell;
  customers: CustNode[];
};

const JCS = Array.from({ length: 13 }, (_, i) => i + 1);
const blank = (): Cell => ({ cy: 0, ly: 0 });

/** "26-27" -> "25-26" */
function priorLabel(fy: string): string {
  const m = fy.match(/^(\d{2})-(\d{2})$/);
  if (!m) return '';
  const a = Number(m[1]) - 1;
  const b = Number(m[2]) - 1;
  return `${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
}

export default function BeatMatrixTab({
  onOpenBeat,
}: {
  onOpenBeat: (beat: string) => void;
}) {
  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState('all');
  const [metric, setMetric] = useState<Metric>('kg');
  const [fy, setFy] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
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

  const cyFy = fy ?? fys[fys.length - 1] ?? '';
  const lyFy = priorLabel(cyFy);

  const model = useMemo(() => {
    if (!rows || !cyFy) return null;

    const scoped = rows.filter((r) => {
      if (company !== 'all' && companyOf(r.company_name) !== company) return false;
      return r.fy_label === cyFy || r.fy_label === lyFy;
    });

    const beats = new Map<string, BeatNode>();
    const custIdx = new Map<string, CustNode>();

    for (const r of scoped) {
      const b = beatOf(r.beat);
      const side: keyof Cell = r.fy_label === cyFy ? 'cy' : 'ly';
      const v = r[metric];

      let node = beats.get(b);
      if (!node) {
        node = { beat: b, jc: {}, total: blank(), customers: [] };
        beats.set(b, node);
      }
      (node.jc[r.jc_number] ??= blank())[side] += v;
      node.total[side] += v;

      const key = `${b}||${r.party_name}`;
      let cust = custIdx.get(key);
      if (!cust) {
        cust = {
          name: r.party_name,
          company: companyOf(r.company_name),
          jc: {},
          total: blank(),
        };
        custIdx.set(key, cust);
        node.customers.push(cust);
      }
      (cust.jc[r.jc_number] ??= blank())[side] += v;
      cust.total[side] += v;
    }

    const list = Array.from(beats.values()).sort((a, b) => b.total.cy - a.total.cy);
    for (const b of list) b.customers.sort((x, y) => y.total.cy - x.total.cy);

    const footer: { jc: Record<number, Cell>; total: Cell } = { jc: {}, total: blank() };
    for (const b of list) {
      for (const n of JCS) {
        const c = b.jc[n];
        if (!c) continue;
        (footer.jc[n] ??= blank()).cy += c.cy;
        footer.jc[n].ly += c.ly;
      }
      footer.total.cy += b.total.cy;
      footer.total.ly += b.total.ly;
    }

    const custCount = custIdx.size;
    return { list, footer, custCount };
  }, [rows, company, metric, cyFy, lyFy]);

  function toggle(beat: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(beat)) next.delete(beat);
      else next.add(beat);
      return next;
    });
  }

  function exportCsv() {
    if (!model) return;
    const src = csvBeat === 'all' ? model.list : model.list.filter((b) => b.beat === csvBeat);
    const out: Record<string, unknown>[] = [];

    for (const b of src) {
      const push = (label: string, customer: string, jc: Record<number, Cell>, total: Cell) => {
        const o: Record<string, unknown> = { Beat: label, Customer: customer };
        for (const n of JCS) {
          o[`JC${n} CY`] = Math.round(jc[n]?.cy ?? 0);
          o[`JC${n} LY`] = Math.round(jc[n]?.ly ?? 0);
        }
        o[`Total ${cyFy}`] = Math.round(total.cy);
        o[`Total ${lyFy}`] = Math.round(total.ly);
        o['Change %'] = pct(total.cy, total.ly)?.toFixed(1) ?? '';
        out.push(o);
      };
      push(b.beat, '(beat total)', b.jc, b.total);
      for (const c of b.customers) push(b.beat, c.name, c.jc, c.total);
    }

    const slug = csvBeat === 'all' ? 'all' : csvBeat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(out, `beat_matrix_${metric}_${slug}_${cyFy}.csv`);
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
      ? n >= 10000
        ? (n / 1000).toFixed(1) + 'k'
        : Math.round(n).toLocaleString('en-IN')
      : n >= 100000
      ? '₹' + (n / 100000).toFixed(1) + 'L'
      : '₹' + Math.round(n).toLocaleString('en-IN');

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Beat × JC Matrix · CY vs LY
          </h2>
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
            CSV
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
                Beat / Customer
              </th>
              {JCS.map((n) => (
                <th
                  key={n}
                  colSpan={2}
                  className="border-b border-l border-gray-200 bg-gray-50 px-2 py-1.5 text-center text-xs font-semibold text-gray-700"
                >
                  JC{n}
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
                <SubHead key={n} />
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
            {model.list.map((b) => {
              const isOpen = open.has(b.beat);
              return (
                <Fragment key={b.beat}>
                  <tr className="border-t border-gray-100 hover:bg-teal-50/30">
                    <td className="sticky left-0 z-10 whitespace-nowrap border-r border-gray-200 bg-white px-3 py-2">
                      <button
                        onClick={() => toggle(b.beat)}
                        className="mr-1 w-3 text-gray-400 hover:text-teal-700"
                        aria-label={isOpen ? 'Collapse' : 'Expand'}
                      >
                        {isOpen ? '▾' : '▸'}
                      </button>
                      <button
                        onClick={() => onOpenBeat(b.beat)}
                        className="font-medium text-gray-900 hover:text-teal-800 hover:underline"
                      >
                        {b.beat}
                      </button>
                      <span className="ml-2 text-[10px] text-gray-400">
                        {b.customers.length} cust
                      </span>
                    </td>
                    {JCS.map((n) => (
                      <Pair key={n} cell={b.jc[n]} fmt={fmt} bold />
                    ))}
                    <TotalCells cell={b.total} fmt={fmt} />
                  </tr>

                  {isOpen &&
                    b.customers.map((c) => (
                      <tr key={`${b.beat}-${c.name}`} className="border-t border-gray-50 bg-gray-50/40">
                        <td className="sticky left-0 z-10 whitespace-nowrap border-r border-gray-200 bg-gray-50/95 py-1.5 pl-8 pr-3 text-gray-700">
                          {c.name}
                          <span className="ml-2 text-[10px] uppercase text-gray-400">
                            {c.company}
                          </span>
                        </td>
                        {JCS.map((n) => (
                          <Pair key={n} cell={c.jc[n]} fmt={fmt} />
                        ))}
                        <TotalCells cell={c.total} fmt={fmt} />
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="sticky left-0 z-10 border-r border-gray-200 bg-gray-50 px-3 py-2 text-gray-900">
                All beats
              </td>
              {JCS.map((n) => (
                <Pair key={n} cell={model.footer.jc[n]} fmt={fmt} bold />
              ))}
              <TotalCells cell={model.footer.total} fmt={fmt} />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="px-1 text-[11px] text-gray-400">
        Tap the arrow to expand a beat into its customers, or the beat name to open Beat Detail.
        Amber marks a cycle running behind last year.
      </p>
    </section>
  );
}

function SubHead() {
  return (
    <>
      <th className="border-b border-l border-gray-200 bg-gray-50 px-2 py-1 text-right text-[10px] font-medium text-gray-500">
        CY
      </th>
      <th className="border-b border-gray-200 bg-gray-50 px-2 py-1 text-right text-[10px] font-medium text-gray-400">
        LY
      </th>
    </>
  );
}

function Pair({
  cell,
  fmt,
  bold,
}: {
  cell: Cell | undefined;
  fmt: (n: number) => string;
  bold?: boolean;
}) {
  const cy = cell?.cy ?? 0;
  const ly = cell?.ly ?? 0;
  const behind = ly > 0 && cy < ly;
  return (
    <>
      <td
        className={`whitespace-nowrap border-l border-gray-100 px-2 py-1.5 text-right tabular-nums ${
          bold ? 'font-medium text-gray-900' : 'text-gray-700'
        }`}
      >
        {fmt(cy)}
      </td>
      <td
        className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-gray-400 ${
          behind ? 'bg-amber-50' : ''
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
