'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { exportXlsx, stamp, type XlsxColumn } from './export-xlsx';
import { loadSales, companyOf, beatOf, pct, fmtPct, type SaleRow } from './use-sales-data';

type Level = 'beat' | 'customer';
type Metric = 'kg' | 'amount';
type Node = {
  key: string;
  name: string;
  beat: string;
  company: string;
  cyKg: number;
  lyKg: number;
  cyAmt: number;
  lyAmt: number;
  cyInv: number;
  lyInv: number;
};

function priorLabel(fy: string): string {
  const m = fy.match(/^(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${String(Number(m[1]) - 1).padStart(2, '0')}-${String(Number(m[2]) - 1).padStart(2, '0')}`;
}

const num = (n: number) => Math.round(n).toLocaleString('en-IN');
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const signed = (n: number) => (n >= 0 ? '+' : '') + num(n);

export default function JcCompareTab({
  beat,
  onBeatChange,
}: {
  beat: string | null;
  onBeatChange: (beat: string | null) => void;
}) {
  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState('all');
  const [level, setLevel] = useState<Level>('beat');
  const [metric, setMetric] = useState<Metric>('kg');
  const [order, setOrder] = useState<'decline' | 'growth'>('decline');
  const drillBeat = beat;
  const setDrillBeat = onBeatChange;
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadSales()
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  const fys = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => r.fy_label))).sort();
  }, [rows]);

  const cyFy = fys[fys.length - 1] ?? '';
  const lyFy = priorLabel(cyFy);

  const currentJc = useMemo(() => {
    if (!rows || !cyFy) return 0;
    const live = rows.filter((r) => r.fy_label === cyFy).map((r) => r.jc_number);
    return live.length ? Math.max(...live) : 0;
  }, [rows, cyFy]);

  const companies = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => companyOf(r.company_name))))
      .filter(Boolean)
      .sort();
  }, [rows]);

  // Drilling into a beat forces the customer view.
  const view: Level = drillBeat ? 'customer' : level;

  const model = useMemo(() => {
    if (!rows || !cyFy || !currentJc) return null;

    // Like-for-like: both years cut to JC1..currentJc
    const scoped = rows.filter((r) => {
      if (company !== 'all' && companyOf(r.company_name) !== company) return false;
      if (drillBeat && beatOf(r.beat) !== drillBeat) return false;
      if (r.jc_number > currentJc) return false;
      return r.fy_label === cyFy || r.fy_label === lyFy;
    });

    const map = new Map<string, Node>();

    for (const r of scoped) {
      const beat = beatOf(r.beat);
      const co = companyOf(r.company_name);
      const key = view === 'beat' ? beat : `${co}||${r.party_name}`;
      const name = view === 'beat' ? beat : r.party_name;

      let n = map.get(key);
      if (!n) {
        n = {
          key,
          name,
          beat,
          company: co,
          cyKg: 0,
          lyKg: 0,
          cyAmt: 0,
          lyAmt: 0,
          cyInv: 0,
          lyInv: 0,
        };
        map.set(key, n);
      }
      if (r.fy_label === cyFy) {
        n.cyKg += r.kg;
        n.cyAmt += r.amount;
        n.cyInv += r.invoices;
      } else {
        n.lyKg += r.kg;
        n.lyAmt += r.amount;
        n.lyInv += r.invoices;
      }
    }

    const list = Array.from(map.values());

    const totals = list.reduce(
      (a, n) => ({
        cyKg: a.cyKg + n.cyKg,
        lyKg: a.lyKg + n.lyKg,
        cyAmt: a.cyAmt + n.cyAmt,
        lyAmt: a.lyAmt + n.lyAmt,
        cyInv: a.cyInv + n.cyInv,
        lyInv: a.lyInv + n.lyInv,
        cyCust: a.cyCust + (n.cyKg > 0 ? 1 : 0),
        lyCust: a.lyCust + (n.lyKg > 0 ? 1 : 0),
        lost: a.lost + (n.lyKg > 0 && n.cyKg === 0 ? 1 : 0),
        gained: a.gained + (n.cyKg > 0 && n.lyKg === 0 ? 1 : 0),
      }),
      {
        cyKg: 0,
        lyKg: 0,
        cyAmt: 0,
        lyAmt: 0,
        cyInv: 0,
        lyInv: 0,
        cyCust: 0,
        lyCust: 0,
        lost: 0,
        gained: 0,
      }
    );

    return { list, totals };
  }, [rows, company, view, drillBeat, cyFy, lyFy, currentJc]);

  const filtered = useMemo(() => {
    if (!model) return [];
    const q = search.trim().toLowerCase();
    const out = model.list.filter((n) => !q || n.name.toLowerCase().includes(q));
    const delta = (n: Node) =>
      metric === 'kg' ? n.cyKg - n.lyKg : n.cyAmt - n.lyAmt;
    return out.sort((a, b) =>
      order === 'decline' ? delta(a) - delta(b) : delta(b) - delta(a)
    );
  }, [model, search, order, metric]);

  async function exportCsv() {
    if (!model) return;
    const isBeat = view === 'beat';

    const columns: XlsxColumn[] = [
      { key: 'name', header: isBeat ? 'Beat' : 'Customer', width: 32 },
      ...(isBeat
        ? []
        : ([
            { key: 'beat', header: 'Beat', width: 26 },
            { key: 'company', header: 'Company', width: 18 },
          ] as XlsxColumn[])),
      { key: 'cyKg', header: `Kg ${cyFy}`, type: 'number' },
      { key: 'lyKg', header: `Kg ${lyFy}`, type: 'number' },
      { key: 'dKg', header: 'Kg change', type: 'number' },
      { key: 'dPct', header: 'Change %', type: 'percent' },
      { key: 'cyAmt', header: `Value ${cyFy}`, type: 'money', width: 16 },
      { key: 'lyAmt', header: `Value ${lyFy}`, type: 'money', width: 16 },
      { key: 'cyInv', header: `Invoices ${cyFy}`, type: 'int' },
      { key: 'lyInv', header: `Invoices ${lyFy}`, type: 'int' },
      { key: 'rate', header: '₹/kg now', type: 'money' },
      { key: 'flag', header: 'Status', width: 12 },
    ];

    const rows = filtered.map((n) => ({
      name: n.name,
      beat: n.beat,
      company: n.company,
      cyKg: Math.round(n.cyKg),
      lyKg: Math.round(n.lyKg),
      dKg: Math.round(n.cyKg - n.lyKg),
      dPct: pct(n.cyKg, n.lyKg),
      cyAmt: Math.round(n.cyAmt),
      lyAmt: Math.round(n.lyAmt),
      cyInv: n.cyInv,
      lyInv: n.lyInv,
      rate: n.cyKg ? Math.round(n.cyAmt / n.cyKg) : null,
      flag: n.lyKg > 0 && n.cyKg === 0 ? 'STOPPED' : n.cyKg > 0 && n.lyKg === 0 ? 'NEW' : '',
    }));

    const totals = {
      name: 'Total',
      beat: '',
      company: '',
      cyKg: Math.round(t.cyKg),
      lyKg: Math.round(t.lyKg),
      dKg: Math.round(t.cyKg - t.lyKg),
      dPct: pct(t.cyKg, t.lyKg),
      cyAmt: Math.round(t.cyAmt),
      lyAmt: Math.round(t.lyAmt),
      cyInv: t.cyInv,
      lyInv: t.lyInv,
      rate: t.cyKg ? Math.round(t.cyAmt / t.cyKg) : null,
      flag: '',
    };

    const scope = drillBeat ? drillBeat : isBeat ? 'all beats' : 'all customers';
    await exportXlsx({
      filename: `JC_Compare_${(drillBeat ?? view).replace(/[^A-Za-z0-9]+/g, '_')}_JC${currentJc}_${stamp()}`,
      sheetName: `Through JC${currentJc}`,
      title: `JC Compare · through JC${currentJc}`,
      subtitle: `FY ${cyFy} JC1–JC${currentJc} vs FY ${lyFy} same cycles · ${scope} · ${
        company === 'all' ? 'both companies' : company
      } · ${rows.length} rows`,
      columns,
      rows,
      totals,
    });
  }

  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="text-xs font-medium text-red-800">Could not load sales</p>
        <p className="mt-1 break-words font-mono text-[11px] text-red-700">{error}</p>
      </div>
    );

  if (!rows || !model) return <p className="p-4 text-sm text-gray-500">Loading comparison…</p>;

  const t = model.totals;
  const kgDelta = t.cyKg - t.lyKg;
  const rate = (kg: number, amt: number) => (kg ? amt / kg : 0);
  const fmt = metric === 'kg' ? num : inr;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Through JC{currentJc} · like for like
          </h2>
          <p className="text-xs text-gray-500">
            FY {cyFy} JC1–JC{currentJc} against the same cycles of FY {lyFy}
          </p>
          {drillBeat && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setDrillBeat(null)}
                className="inline-flex items-center gap-1.5 rounded-md border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800 hover:bg-teal-100"
              >
                ← Back to all beats
              </button>
              <span className="text-sm font-semibold text-gray-900">{drillBeat}</span>
              <Link
                href={`/sales/beat/${encodeURIComponent(drillBeat)}`}
                className="text-xs text-gray-500 hover:text-teal-800 hover:underline"
              >
                open full beat page ↗
              </Link>
            </div>
          )}
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
            {(['beat', 'customer'] as Level[]).map((l) => (
              <button
                key={l}
                onClick={() => {
                  setDrillBeat(null);
                  setLevel(l);
                }}
                className={`px-3 py-1.5 text-sm ${
                  view === l ? 'bg-teal-700 text-white' : 'bg-white text-gray-600'
                }`}
              >
                {l === 'beat' ? 'Beats' : 'Customers'}
              </button>
            ))}
          </div>

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

          <button
            onClick={exportCsv}
            className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            Excel
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Kpi
          label="Volume"
          value={num(t.cyKg) + ' kg'}
          note={`${num(t.lyKg)} kg in ${lyFy}`}
          delta={pct(t.cyKg, t.lyKg)}
        />
        <Kpi
          label="Value"
          value={inr(t.cyAmt)}
          note={`${inr(t.lyAmt)} in ${lyFy}`}
          delta={pct(t.cyAmt, t.lyAmt)}
        />
        <Kpi
          label="Realisation"
          value={'₹' + rate(t.cyKg, t.cyAmt).toFixed(1) + '/kg'}
          note={`₹${rate(t.lyKg, t.lyAmt).toFixed(1)}/kg in ${lyFy}`}
          delta={pct(rate(t.cyKg, t.cyAmt), rate(t.lyKg, t.lyAmt))}
        />
        <Kpi
          label="Invoices"
          value={num(t.cyInv)}
          note={`${num(t.lyInv)} in ${lyFy}`}
          delta={pct(t.cyInv, t.lyInv)}
        />
        <Kpi
          label={view === 'beat' ? 'Beats billing' : 'Customers billing'}
          value={num(t.cyCust)}
          note={`${t.lost} stopped · ${t.gained} new`}
          delta={pct(t.cyCust, t.lyCust)}
        />
      </div>

      <div
        className={`rounded-lg border p-3 ${
          kgDelta >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'
        }`}
      >
        <p className={`text-sm ${kgDelta >= 0 ? 'text-emerald-900' : 'text-red-900'}`}>
          <span className="font-semibold">{signed(kgDelta)} kg</span> against last year through
          JC{currentJc} ({fmtPct(pct(t.cyKg, t.lyKg))}), on{' '}
          <span className="font-semibold">{inr(Math.abs(t.cyAmt - t.lyAmt))}</span>{' '}
          {t.cyAmt - t.lyAmt >= 0 ? 'more' : 'less'} value.
        </p>
      </div>

      {/* Movers */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={view === 'beat' ? 'Search beat…' : 'Search customer…'}
          className="min-w-[200px] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <div className="flex overflow-hidden rounded-md border border-gray-300">
          <button
            onClick={() => setOrder('decline')}
            className={`px-3 py-1.5 text-sm ${
              order === 'decline' ? 'bg-red-600 text-white' : 'bg-white text-gray-600'
            }`}
          >
            Biggest declines
          </button>
          <button
            onClick={() => setOrder('growth')}
            className={`px-3 py-1.5 text-sm ${
              order === 'growth' ? 'bg-emerald-700 text-white' : 'bg-white text-gray-600'
            }`}
          >
            Biggest gains
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="px-3 py-2 text-xs font-medium text-gray-600">
                {view === 'beat' ? 'Beat' : 'Customer'}
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">{cyFy}</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">{lyFy}</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Change</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">%</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                ₹/kg now
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((n) => {
              const cy = metric === 'kg' ? n.cyKg : n.cyAmt;
              const ly = metric === 'kg' ? n.lyKg : n.lyAmt;
              const d = cy - ly;
              const stopped = n.lyKg > 0 && n.cyKg === 0;
              return (
                <tr key={n.key} className="border-t border-gray-100 hover:bg-teal-50/40">
                  <td className="whitespace-nowrap px-3 py-2">
                    {view === 'beat' ? (
                      <button
                        onClick={() => {
                          setDrillBeat(n.name);
                          setSearch('');
                        }}
                        className="text-left font-medium text-gray-900 hover:text-teal-800 hover:underline"
                      >
                        <span className="mr-1 text-gray-400">▸</span>
                        {n.name}
                      </button>
                    ) : (
                      <Link
                        href={`/sales/customer/${encodeURIComponent(n.name)}`}
                        className="font-medium text-gray-900 hover:text-teal-800 hover:underline"
                      >
                        {n.name}
                      </Link>
                    )}
                    {view === 'customer' && !drillBeat && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                        {n.beat}
                      </span>
                    )}
                    {stopped && (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                        stopped
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                    {cy ? fmt(cy) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                    {ly ? fmt(ly) : '—'}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-medium tabular-nums ${
                      d >= 0 ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    {metric === 'kg' ? signed(d) : (d >= 0 ? '+' : '−') + inr(Math.abs(d))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <Delta value={pct(cy, ly)} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {n.cyKg ? '₹' + (n.cyAmt / n.cyKg).toFixed(0) : '—'}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                  Nothing matches that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="px-1 text-[11px] text-gray-400">
        Both years are cut to JC1–JC{currentJc}, so the comparison is like for like. JC
        {currentJc} is still running, which drags the current year down until it closes.
        {view === 'beat' && ' Tap a beat to see its customers without leaving this comparison.'}
      </p>
    </section>
  );
}

function Kpi({
  label,
  value,
  note,
  delta,
}: {
  label: string;
  value: string;
  note: string;
  delta: number | null;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">{value}</p>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-gray-500">
        <Delta value={delta} />
        <span>{note}</span>
      </p>
    </div>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-400">—</span>;
  return (
    <span className={value >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-600'}>
      {fmtPct(value)}
    </span>
  );
}
