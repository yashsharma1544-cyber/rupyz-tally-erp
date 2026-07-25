'use client';

import { useEffect, useMemo, useState } from 'react';
import { fmtKg, fmtINR, downloadCsv } from './shared';
import {
  loadSales,
  fyInfo,
  companyOf,
  beatOf,
  pct,
  fmtPct,
  type SaleRow,
} from './use-sales-data';

type Metric = 'kg' | 'amount';

export default function BeatMatrixTab({
  onOpenBeat,
}: {
  onOpenBeat: (beat: string) => void;
}) {
  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState('all');
  const [metric, setMetric] = useState<Metric>('kg');
  const [csvBeat, setCsvBeat] = useState('all');

  useEffect(() => {
    loadSales()
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  const info = useMemo(() => (rows ? fyInfo(rows) : null), [rows]);

  const matrix = useMemo(() => {
    if (!rows || !info) return null;
    const { currentFy, priorFy, currentJc } = info;

    const scoped =
      company === 'all'
        ? rows
        : rows.filter((r) => companyOf(r.company_name) === company);

    const jcs = Array.from({ length: currentJc }, (_, i) => i + 1);
    const map = new Map<string, { jc: Record<number, number>; total: number; ly: number }>();

    for (const r of scoped) {
      const b = beatOf(r.beat);
      const e = map.get(b) ?? { jc: {}, total: 0, ly: 0 };
      const v = r[metric];
      if (r.fy_label === currentFy) {
        e.jc[r.jc_number] = (e.jc[r.jc_number] ?? 0) + v;
        e.total += v;
      } else if (r.fy_label === priorFy && r.jc_number <= currentJc) {
        e.ly += v;
      }
      map.set(b, e);
    }

    const list = Array.from(map, ([beat, v]) => ({ beat, ...v })).sort(
      (a, b) => b.total - a.total
    );

    const footer = {
      jc: Object.fromEntries(
        jcs.map((n) => [n, list.reduce((s, r) => s + (r.jc[n] ?? 0), 0)])
      ) as Record<number, number>,
      total: list.reduce((s, r) => s + r.total, 0),
      ly: list.reduce((s, r) => s + r.ly, 0),
    };

    return { jcs, list, footer };
  }, [rows, info, company, metric]);

  function exportCsv() {
    if (!matrix || !info) return;
    const src =
      csvBeat === 'all' ? matrix.list : matrix.list.filter((r) => r.beat === csvBeat);

    const out = src.map((r) => {
      const o: Record<string, unknown> = { Beat: r.beat };
      for (const n of matrix.jcs) o[`JC${n}`] = Math.round(r.jc[n] ?? 0);
      o[`Total ${info.currentFy}`] = Math.round(r.total);
      o[`Same cycles ${info.priorFy ?? 'LY'}`] = Math.round(r.ly);
      o['Change %'] = pct(r.total, r.ly)?.toFixed(1) ?? '';
      return o;
    });

    const slug = csvBeat === 'all' ? 'all' : csvBeat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadCsv(out, `beat_matrix_${metric}_${slug}_${stamp}.csv`);
  }

  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="text-xs font-medium text-red-800">Could not load the matrix</p>
        <p className="mt-1 break-words font-mono text-[11px] text-red-700">{error}</p>
      </div>
    );

  if (!rows || !info || !matrix)
    return <p className="p-4 text-sm text-gray-500">Loading beat matrix…</p>;

  const fmt = metric === 'kg' ? fmtKg : fmtINR;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
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

        <div className="flex overflow-hidden rounded-md border border-gray-300">
          {(['kg', 'amount'] as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-3 py-1.5 text-sm ${
                metric === m ? 'bg-teal-700 text-white' : 'bg-white text-gray-600'
              }`}
            >
              {m === 'kg' ? 'Kg' : 'Value'}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={csvBeat}
            onChange={(e) => setCsvBeat(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="all">All beats</option>
            {matrix.list.map((r) => (
              <option key={r.beat} value={r.beat}>
                {r.beat}
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
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
                Beat
              </th>
              {matrix.jcs.map((n) => (
                <th
                  key={n}
                  className="px-3 py-2 text-right text-xs font-medium text-gray-600"
                >
                  JC{n}
                </th>
              ))}
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                {info.currentFy}
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                {info.priorFy ?? 'LY'}
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Change</th>
            </tr>
          </thead>
          <tbody>
            {matrix.list.map((r) => (
              <tr key={r.beat} className="border-t border-gray-100 hover:bg-teal-50/40">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2">
                  <button
                    onClick={() => onOpenBeat(r.beat)}
                    className="font-medium text-teal-800 hover:underline"
                  >
                    {r.beat}
                  </button>
                </td>
                {matrix.jcs.map((n) => (
                  <td key={n} className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {r.jc[n] ? fmt(r.jc[n]) : '—'}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                  {fmt(r.total)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                  {fmt(r.ly)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <Delta value={pct(r.total, r.ly)} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr className="border-t border-gray-200 font-semibold">
              <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-gray-900">Total</td>
              {matrix.jcs.map((n) => (
                <td key={n} className="px-3 py-2 text-right tabular-nums text-gray-900">
                  {fmt(matrix.footer.jc[n])}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                {fmt(matrix.footer.total)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                {fmt(matrix.footer.ly)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                <Delta value={pct(matrix.footer.total, matrix.footer.ly)} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="px-1 text-[11px] text-gray-400">
        Tap any beat name to open its detail. Last-year column covers JC1–JC{info.currentJc}
        only, matching the cycles elapsed this year.
      </p>
    </section>
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
