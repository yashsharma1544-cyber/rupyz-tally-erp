'use client';

import { useEffect, useMemo, useState } from 'react';
import { fmtKg, fmtINR } from './shared';
import {
  loadSales,
  fyInfo,
  companyOf,
  beatOf,
  pct,
  fmtPct,
  type SaleRow,
} from './use-sales-data';

export default function OverviewTab() {
  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState('all');

  useEffect(() => {
    loadSales()
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  const info = useMemo(() => (rows ? fyInfo(rows) : null), [rows]);

  const scoped = useMemo(() => {
    if (!rows) return [];
    return company === 'all'
      ? rows
      : rows.filter((r) => companyOf(r.company_name) === company);
  }, [rows, company]);

  const stats = useMemo(() => {
    if (!info || !scoped.length) return null;
    const { currentFy, priorFy, currentJc } = info;

    const cy = scoped.filter((r) => r.fy_label === currentFy);
    // Like-for-like: only the JCs that have elapsed this year.
    const lyToDate = scoped.filter(
      (r) => r.fy_label === priorFy && r.jc_number <= currentJc
    );
    const lyFull = scoped.filter((r) => r.fy_label === priorFy);

    const sum = (a: SaleRow[], k: 'kg' | 'amount' | 'invoices') =>
      a.reduce((s, r) => s + r[k], 0);

    const jcSeries = Array.from({ length: 13 }, (_, i) => {
      const n = i + 1;
      return {
        jc: n,
        cy: sum(cy.filter((r) => r.jc_number === n), 'kg'),
        ly: sum(lyFull.filter((r) => r.jc_number === n), 'kg'),
      };
    });

    const beatMap = new Map<string, { cy: number; ly: number }>();
    for (const r of scoped) {
      const b = beatOf(r.beat);
      const e = beatMap.get(b) ?? { cy: 0, ly: 0 };
      if (r.fy_label === currentFy) e.cy += r.kg;
      else if (r.fy_label === priorFy && r.jc_number <= currentJc) e.ly += r.kg;
      beatMap.set(b, e);
    }
    const beats = Array.from(beatMap, ([beat, v]) => ({ beat, ...v }))
      .sort((a, b) => b.cy - a.cy)
      .slice(0, 10);

    return {
      cyKg: sum(cy, 'kg'),
      cyAmount: sum(cy, 'amount'),
      cyInvoices: sum(cy, 'invoices'),
      lyKg: sum(lyToDate, 'kg'),
      lyAmount: sum(lyToDate, 'amount'),
      activeCustomers: new Set(cy.map((r) => r.party_name)).size,
      lyCustomers: new Set(lyToDate.map((r) => r.party_name)).size,
      jcSeries,
      beats,
      currentJc,
    };
  }, [scoped, info]);

  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="text-xs font-medium text-red-800">Could not load sales</p>
        <p className="mt-1 break-words font-mono text-[11px] text-red-700">{error}</p>
      </div>
    );

  if (!rows || !info || !stats)
    return <p className="p-4 text-sm text-gray-500">Loading sales…</p>;

  const { currentFy, priorFy } = info;
  const maxJcKg = Math.max(1, ...stats.jcSeries.flatMap((d) => [d.cy, d.ly]));
  const realisation = (kg: number, amt: number) => (kg ? amt / kg : 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="all">Both companies</option>
          {info.companies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500">
          FY {currentFy} · through JC{stats.currentJc}
          {priorFy && ` · compared with the same cycles of ${priorFy}`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi
          label="Volume"
          value={fmtKg(stats.cyKg) + ' kg'}
          sub={`${fmtKg(stats.lyKg)} kg last year`}
          delta={pct(stats.cyKg, stats.lyKg)}
        />
        <Kpi
          label="Value"
          value={fmtINR(stats.cyAmount)}
          sub={`${fmtINR(stats.lyAmount)} last year`}
          delta={pct(stats.cyAmount, stats.lyAmount)}
        />
        <Kpi
          label="Billing customers"
          value={stats.activeCustomers.toLocaleString('en-IN')}
          sub={`${stats.lyCustomers.toLocaleString('en-IN')} last year`}
          delta={pct(stats.activeCustomers, stats.lyCustomers)}
        />
        <Kpi
          label="Realisation"
          value={'₹' + realisation(stats.cyKg, stats.cyAmount).toFixed(1) + '/kg'}
          sub={`₹${realisation(stats.lyKg, stats.lyAmount).toFixed(1)}/kg last year`}
          delta={pct(
            realisation(stats.cyKg, stats.cyAmount),
            realisation(stats.lyKg, stats.lyAmount)
          )}
        />
      </div>

      {/* JC-by-JC volume */}
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <h2 className="text-sm font-semibold text-gray-900">Volume by journey cycle</h2>
        <p className="mt-0.5 text-[11px] text-gray-500">
          Teal is {currentFy}, grey is {priorFy ?? 'last year'}. Kg.
        </p>
        <div className="mt-3 space-y-1.5">
          {stats.jcSeries.map((d) => (
            <div key={d.jc} className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-[11px] text-gray-500">JC{d.jc}</span>
              <div className="flex-1 space-y-0.5">
                <div className="h-2.5 rounded-sm bg-gray-100">
                  <div
                    className="h-2.5 rounded-sm bg-teal-700"
                    style={{ width: `${(d.cy / maxJcKg) * 100}%` }}
                  />
                </div>
                <div className="h-1.5 rounded-sm bg-gray-100">
                  <div
                    className="h-1.5 rounded-sm bg-gray-400"
                    style={{ width: `${(d.ly / maxJcKg) * 100}%` }}
                  />
                </div>
              </div>
              <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-gray-700">
                {d.cy ? fmtKg(d.cy) : '—'}
              </span>
              <span className="w-16 shrink-0 text-right text-[11px] tabular-nums">
                <Delta value={pct(d.cy, d.ly)} muted={!d.cy} />
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top beats */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="px-3 py-2 text-xs font-medium text-gray-600">Top beats</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                {currentFy} kg
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                {priorFy ?? 'LY'} kg
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Change</th>
            </tr>
          </thead>
          <tbody>
            {stats.beats.map((b) => (
              <tr key={b.beat} className="border-t border-gray-100">
                <td className="whitespace-nowrap px-3 py-2 text-gray-900">{b.beat}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                  {fmtKg(b.cy)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                  {fmtKg(b.ly)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <Delta value={pct(b.cy, b.ly)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-1 text-[11px] text-gray-400">
        Last-year figures are cut to JC1–JC{stats.currentJc} so the comparison is like for like.
        The JC chart shows the full prior year for context.
      </p>
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  delta,
}: {
  label: string;
  value: string;
  sub: string;
  delta: number | null;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">{value}</p>
      <p className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
        <Delta value={delta} />
        <span>{sub}</span>
      </p>
    </div>
  );
}

function Delta({ value, muted }: { value: number | null; muted?: boolean }) {
  if (value == null || muted) return <span className="text-gray-400">—</span>;
  return (
    <span className={value >= 0 ? 'font-medium text-emerald-700' : 'font-medium text-red-600'}>
      {fmtPct(value)}
    </span>
  );
}
