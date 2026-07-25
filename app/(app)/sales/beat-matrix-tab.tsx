'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { downloadCsv } from './shared';
import { loadSales, companyOf, beatOf, pct, fmtPct, type SaleRow } from './use-sales-data';

type Metric = 'kg' | 'amount';
type Vals = { kg: number; amount: number; invoices: number };
type Cell = { cy: Vals; ly: Vals };
type CustNode = { name: string; company: string; jc: Record<number, Cell>; total: Cell };
type BeatNode = { beat: string; jc: Record<number, Cell>; total: Cell; customers: CustNode[] };

const JCS = Array.from({ length: 13 }, (_, i) => i + 1);
const zero = (): Vals => ({ kg: 0, amount: 0, invoices: 0 });
const blank = (): Cell => ({ cy: zero(), ly: zero() });

function priorLabel(fy: string): string {
  const m = fy.match(/^(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${String(Number(m[1]) - 1).padStart(2, '0')}-${String(Number(m[2]) - 1).padStart(2, '0')}`;
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const num = (n: number) => Math.round(n).toLocaleString('en-IN');
const rate = (v: Vals) => (v.kg ? v.amount / v.kg : 0);

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
  const [openBeats, setOpenBeats] = useState<Set<string>>(new Set());
  const [openCust, setOpenCust] = useState<Set<string>>(new Set());
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

    const add = (v: Vals, r: SaleRow) => {
      v.kg += r.kg;
      v.amount += r.amount;
      v.invoices += r.invoices;
    };

    for (const r of scoped) {
      const b = beatOf(r.beat);
      const side: keyof Cell = r.fy_label === cyFy ? 'cy' : 'ly';

      let node = beats.get(b);
      if (!node) {
        node = { beat: b, jc: {}, total: blank(), customers: [] };
        beats.set(b, node);
      }
      add((node.jc[r.jc_number] ??= blank())[side], r);
      add(node.total[side], r);

      const key = `${b}||${r.party_name}`;
      let cust = custIdx.get(key);
      if (!cust) {
        cust = { name: r.party_name, company: companyOf(r.company_name), jc: {}, total: blank() };
        custIdx.set(key, cust);
        node.customers.push(cust);
      }
      add((cust.jc[r.jc_number] ??= blank())[side], r);
      add(cust.total[side], r);
    }

    const list = Array.from(beats.values()).sort((a, b) => b.total.cy.kg - a.total.cy.kg);
    for (const b of list) b.customers.sort((x, y) => y.total.cy.kg - x.total.cy.kg);

    const footer: { jc: Record<number, Cell>; total: Cell } = { jc: {}, total: blank() };
    const merge = (dst: Vals, src: Vals) => {
      dst.kg += src.kg;
      dst.amount += src.amount;
      dst.invoices += src.invoices;
    };
    for (const b of list) {
      for (const n of JCS) {
        const c = b.jc[n];
        if (!c) continue;
        const f = (footer.jc[n] ??= blank());
        merge(f.cy, c.cy);
        merge(f.ly, c.ly);
      }
      merge(footer.total.cy, b.total.cy);
      merge(footer.total.ly, b.total.ly);
    }

    return { list, footer, custCount: custIdx.size };
  }, [rows, company, metric, cyFy, lyFy]);

  const toggleBeat = (b: string) =>
    setOpenBeats((p) => {
      const n = new Set(p);
      n.has(b) ? n.delete(b) : n.add(b);
      return n;
    });

  const toggleCust = (k: string) =>
    setOpenCust((p) => {
      const n = new Set(p);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  function exportCsv() {
    if (!model) return;
    const src = csvBeat === 'all' ? model.list : model.list.filter((b) => b.beat === csvBeat);
    const out: Record<string, unknown>[] = [];

    for (const b of src) {
      const push = (label: string, customer: string, jc: Record<number, Cell>, total: Cell) => {
        const o: Record<string, unknown> = { Beat: label, Customer: customer };
        for (const n of JCS) {
          o[`JC${n} CY`] = Math.round(jc[n]?.cy[metric] ?? 0);
          o[`JC${n} LY`] = Math.round(jc[n]?.ly[metric] ?? 0);
        }
        o[`Total ${cyFy}`] = Math.round(total.cy[metric]);
        o[`Total ${lyFy}`] = Math.round(total.ly[metric]);
        o['Change %'] = pct(total.cy[metric], total.ly[metric])?.toFixed(1) ?? '';
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

  const fmt = (n: number) => (n === 0 ? '—' : metric === 'kg' ? num(n) : inr(n));
  const colSpan = 1 + JCS.length * 2 + 3;

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
              const isOpen = openBeats.has(b.beat);
              return (
                <Fragment key={b.beat}>
                  <tr className="border-t border-gray-100 hover:bg-teal-50/30">
                    <td className="sticky left-0 z-10 whitespace-nowrap border-r border-gray-200 bg-white px-3 py-2">
                      <button
                        onClick={() => toggleBeat(b.beat)}
                        className="text-left font-medium text-gray-900 hover:text-teal-800"
                      >
                        <span className="mr-1 inline-block w-3 text-gray-400">
                          {isOpen ? '▾' : '▸'}
                        </span>
                        {b.beat}
                      </button>
                      <span className="ml-2 text-[10px] text-gray-400">
                        {b.customers.length} cust
                      </span>
                    </td>
                    {JCS.map((n) => (
                      <Pair key={n} cell={b.jc[n]} metric={metric} fmt={fmt} bold />
                    ))}
                    <TotalCells cell={b.total} metric={metric} fmt={fmt} />
                  </tr>

                  {isOpen && (
                    <tr className="bg-teal-50/40">
                      <td colSpan={colSpan} className="px-3 py-1.5">
                        <button
                          onClick={() => onOpenBeat(b.beat)}
                          className="text-[11px] font-medium text-teal-800 hover:underline"
                        >
                          Open {b.beat} in Beat Detail →
                        </button>
                      </td>
                    </tr>
                  )}

                  {isOpen &&
                    b.customers.map((c) => {
                      const key = `${b.beat}||${c.name}`;
                      const cOpen = openCust.has(key);
                      return (
                        <Fragment key={key}>
                          <tr className="border-t border-gray-50 bg-gray-50/40">
                            <td className="sticky left-0 z-10 whitespace-nowrap border-r border-gray-200 bg-gray-50/95 py-1.5 pl-6 pr-3">
                              <button
                                onClick={() => toggleCust(key)}
                                className="text-left text-gray-800 hover:text-teal-800"
                              >
                                <span className="mr-1 inline-block w-3 text-gray-400">
                                  {cOpen ? '▾' : '▸'}
                                </span>
                                {c.name}
                              </button>
                              <span className="ml-2 text-[10px] uppercase text-gray-400">
                                {c.company}
                              </span>
                            </td>
                            {JCS.map((n) => (
                              <Pair key={n} cell={c.jc[n]} metric={metric} fmt={fmt} />
                            ))}
                            <TotalCells cell={c.total} metric={metric} fmt={fmt} />
                          </tr>

                          {cOpen && (
                            <tr className="border-t border-gray-50 bg-white">
                              <td colSpan={colSpan} className="px-3 py-3">
                                <CustomerDetail cust={c} cyFy={cyFy} lyFy={lyFy} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
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
                <Pair key={n} cell={model.footer.jc[n]} metric={metric} fmt={fmt} bold />
              ))}
              <TotalCells cell={model.footer.total} metric={metric} fmt={fmt} />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="px-1 text-[11px] text-gray-400">
        Tap a beat to list its customers, then a customer for volume, value, invoices and
        realisation. Amber marks a cycle running behind last year.
      </p>
    </section>
  );
}

function CustomerDetail({
  cust,
  cyFy,
  lyFy,
}: {
  cust: CustNode;
  cyFy: string;
  lyFy: string;
}) {
  const cy = cust.total.cy;
  const ly = cust.total.ly;

  const active = JCS.filter((n) => (cust.jc[n]?.cy.kg ?? 0) > 0);
  const best = active
    .map((n) => ({ n, kg: cust.jc[n]!.cy.kg }))
    .sort((a, b) => b.kg - a.kg)[0];

  const items: { label: string; cy: string; ly: string; delta: number | null }[] = [
    { label: 'Volume (kg)', cy: num(cy.kg), ly: num(ly.kg), delta: pct(cy.kg, ly.kg) },
    { label: 'Value', cy: inr(cy.amount), ly: inr(ly.amount), delta: pct(cy.amount, ly.amount) },
    {
      label: 'Invoices',
      cy: num(cy.invoices),
      ly: num(ly.invoices),
      delta: pct(cy.invoices, ly.invoices),
    },
    {
      label: 'Realisation',
      cy: '₹' + rate(cy).toFixed(1) + '/kg',
      ly: '₹' + rate(ly).toFixed(1) + '/kg',
      delta: pct(rate(cy), rate(ly)),
    },
    {
      label: 'Avg per invoice',
      cy: cy.invoices ? num(cy.kg / cy.invoices) + ' kg' : '—',
      ly: ly.invoices ? num(ly.kg / ly.invoices) + ' kg' : '—',
      delta: pct(cy.invoices ? cy.kg / cy.invoices : 0, ly.invoices ? ly.kg / ly.invoices : 0),
    },
  ];

  return (
    <div className="space-y-2 rounded-md border border-teal-100 bg-teal-50/30 p-3">
      <p className="text-xs font-semibold text-gray-900">
        {cust.name}
        <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-gray-500">
          {cust.company}
        </span>
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((it) => (
          <div key={it.label} className="rounded-md border border-gray-200 bg-white px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">{it.label}</p>
            <p className="text-sm font-semibold tabular-nums text-gray-900">{it.cy}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-gray-500">
              {it.delta == null ? (
                <span className="text-gray-400">—</span>
              ) : (
                <span
                  className={
                    it.delta >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-600'
                  }
                >
                  {fmtPct(it.delta)}
                </span>
              )}
              <span>
                {lyFy}: {it.ly}
              </span>
            </p>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-gray-500">
        Billed in {active.length} of 13 cycles this year
        {best ? ` · strongest JC${best.n} at ${num(best.kg)} kg` : ''} · FY {cyFy}
      </p>
    </div>
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
  metric,
  fmt,
  bold,
}: {
  cell: Cell | undefined;
  metric: Metric;
  fmt: (n: number) => string;
  bold?: boolean;
}) {
  const cy = cell?.cy[metric] ?? 0;
  const ly = cell?.ly[metric] ?? 0;
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

function TotalCells({
  cell,
  metric,
  fmt,
}: {
  cell: Cell;
  metric: Metric;
  fmt: (n: number) => string;
}) {
  const p = pct(cell.cy[metric], cell.ly[metric]);
  return (
    <>
      <td className="whitespace-nowrap border-l border-gray-200 px-2 py-1.5 text-right font-semibold tabular-nums text-gray-900">
        {fmt(cell.cy[metric])}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-gray-500">
        {fmt(cell.ly[metric])}
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
