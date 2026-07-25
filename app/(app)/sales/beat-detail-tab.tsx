'use client';

import { useEffect, useMemo, useState } from 'react';
import { salesRpc, fmtKg, downloadCsv } from './shared';
import {
  loadSales,
  fyInfo,
  companyOf,
  beatOf,
  pct,
  fmtPct,
  type SaleRow,
} from './use-sales-data';

type WeeklyResp = {
  beat: string;
  jc_start: string;
  jc_end: string;
  latest_jc: number;
  current_jc: number;
  current_fy: string;
  week_starts: string[];
  week_ends: string[];
  totals: { w1_kg: number; w2_kg: number; w3_kg: number; w4_kg: number; total_kg: number };
  customers: {
    party_name: string;
    company: string | null;
    w1_kg: number;
    w2_kg: number;
    w3_kg: number;
    w4_kg: number;
    total_kg: number;
  }[];
};

type View = 'all' | 'weekly';

export default function BeatDetailTab({
  beat,
  onChangeBeat,
}: {
  beat: string | null;
  onChangeBeat: (beat: string | null) => void;
}) {
  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('all');

  const [weekly, setWeekly] = useState<WeeklyResp | null>(null);
  const [weeklyErr, setWeeklyErr] = useState<string | null>(null);
  const [jcPick, setJcPick] = useState<number | null>(null);

  useEffect(() => {
    loadSales()
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  const info = useMemo(() => (rows ? fyInfo(rows) : null), [rows]);

  const beats = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => beatOf(r.beat)))).sort();
  }, [rows]);

  // Weekly view fetches per beat / per JC.
  useEffect(() => {
    if (view !== 'weekly' || !beat) return;
    setWeekly(null);
    setWeeklyErr(null);
    salesRpc<WeeklyResp>('beat_current_jc_weekly', {
      p_beat: beat,
      ...(jcPick ? { p_jc: jcPick } : {}),
    })
      .then((w) => {
        setWeekly(w);
        if (jcPick == null) setJcPick(w.current_jc);
      })
      .catch((e: Error) => setWeeklyErr(e.message));
  }, [view, beat, jcPick]);

  const allJcs = useMemo(() => {
    if (!rows || !info || !beat) return null;
    const { currentFy, priorFy, currentJc } = info;
    const jcs = Array.from({ length: currentJc }, (_, i) => i + 1);

    const mine = rows.filter((r) => beatOf(r.beat) === beat);
    const map = new Map<
      string,
      { company: string; jc: Record<number, number>; total: number; ly: number }
    >();

    for (const r of mine) {
      const key = r.party_name;
      const e =
        map.get(key) ?? { company: companyOf(r.company_name), jc: {}, total: 0, ly: 0 };
      if (r.fy_label === currentFy) {
        e.jc[r.jc_number] = (e.jc[r.jc_number] ?? 0) + r.kg;
        e.total += r.kg;
      } else if (r.fy_label === priorFy && r.jc_number <= currentJc) {
        e.ly += r.kg;
      }
      map.set(key, e);
    }

    const list = Array.from(map, ([party_name, v]) => ({ party_name, ...v })).sort(
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
  }, [rows, info, beat]);

  function exportAll() {
    if (!allJcs || !info || !beat) return;
    const out = allJcs.list.map((r) => {
      const o: Record<string, unknown> = { Customer: r.party_name, Company: r.company };
      for (const n of allJcs.jcs) o[`JC${n}`] = Math.round(r.jc[n] ?? 0);
      o[`Total ${info.currentFy}`] = Math.round(r.total);
      o[`Same cycles ${info.priorFy ?? 'LY'}`] = Math.round(r.ly);
      o['Change %'] = pct(r.total, r.ly)?.toFixed(1) ?? '';
      return o;
    });
    const slug = beat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(out, `beat_${slug}_all_jcs.csv`);
  }

  function exportWeekly() {
    if (!weekly) return;
    const out = weekly.customers.map((c) => ({
      Customer: c.party_name,
      Company: c.company ?? '',
      [`W1 ${weekly.week_starts[0] ?? ''}`]: Math.round(c.w1_kg),
      [`W2 ${weekly.week_starts[1] ?? ''}`]: Math.round(c.w2_kg),
      [`W3 ${weekly.week_starts[2] ?? ''}`]: Math.round(c.w3_kg),
      [`W4 ${weekly.week_starts[3] ?? ''}`]: Math.round(c.w4_kg),
      Total: Math.round(c.total_kg),
    }));
    const slug = weekly.beat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(out, `beat_${slug}_jc${jcPick ?? ''}_weekly.csv`);
  }

  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="text-xs font-medium text-red-800">Could not load beats</p>
        <p className="mt-1 break-words font-mono text-[11px] text-red-700">{error}</p>
      </div>
    );

  if (!rows || !info) return <p className="p-4 text-sm text-gray-500">Loading…</p>;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <select
          value={beat ?? ''}
          onChange={(e) => {
            onChangeBeat(e.target.value || null);
            setJcPick(null);
          }}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Choose a beat…</option>
          {beats.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <div className="flex overflow-hidden rounded-md border border-gray-300">
          {(['all', 'weekly'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm ${
                view === v ? 'bg-teal-700 text-white' : 'bg-white text-gray-600'
              }`}
            >
              {v === 'all' ? 'All JCs' : 'Weekly'}
            </button>
          ))}
        </div>

        {view === 'weekly' && weekly && (
          <select
            value={jcPick ?? weekly.current_jc}
            onChange={(e) => setJcPick(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            {Array.from({ length: weekly.latest_jc }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                JC{n}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={view === 'all' ? exportAll : exportWeekly}
          disabled={!beat}
          className="ml-auto rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:bg-gray-300"
        >
          CSV
        </button>
      </div>

      {!beat && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">
            Pick a beat above, or tap a beat name in the Beat Matrix.
          </p>
        </div>
      )}

      {beat && view === 'all' && allJcs && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-3 py-2 text-xs font-medium text-gray-600">
                  {beat} · {allJcs.list.length} customers
                </th>
                {allJcs.jcs.map((n) => (
                  <th key={n} className="px-3 py-2 text-right text-xs font-medium text-gray-600">
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
              {allJcs.list.map((r) => (
                <tr key={r.party_name} className="border-t border-gray-100 hover:bg-teal-50/40">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                    {r.party_name}
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                      {r.company}
                    </span>
                  </td>
                  {allJcs.jcs.map((n) => (
                    <td key={n} className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {r.jc[n] ? fmtKg(r.jc[n]) : '—'}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                    {fmtKg(r.total)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                    {fmtKg(r.ly)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <Delta value={pct(r.total, r.ly)} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr className="border-t border-gray-200 font-semibold">
                <td className="px-3 py-2 text-gray-900">Beat total</td>
                {allJcs.jcs.map((n) => (
                  <td key={n} className="px-3 py-2 text-right tabular-nums text-gray-900">
                    {fmtKg(allJcs.footer.jc[n])}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                  {fmtKg(allJcs.footer.total)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                  {fmtKg(allJcs.footer.ly)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <Delta value={pct(allJcs.footer.total, allJcs.footer.ly)} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {beat && view === 'weekly' && (
        <>
          {weeklyErr && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-medium text-red-800">Weekly view failed</p>
              <p className="mt-1 break-words font-mono text-[11px] text-red-700">{weeklyErr}</p>
            </div>
          )}
          {!weekly && !weeklyErr && (
            <p className="p-4 text-sm text-gray-500">Loading weekly split…</p>
          )}
          {weekly && (
            <>
              <p className="px-1 text-xs text-gray-500">
                JC{jcPick ?? weekly.current_jc} · {weekly.jc_start} to {weekly.jc_end} ·{' '}
                {fmtKg(weekly.totals.total_kg)} kg
              </p>
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left">
                      <th className="px-3 py-2 text-xs font-medium text-gray-600">
                        {weekly.beat} · {weekly.customers.length} customers
                      </th>
                      {[0, 1, 2, 3].map((i) => (
                        <th
                          key={i}
                          className="px-3 py-2 text-right text-xs font-medium text-gray-600"
                        >
                          W{i + 1}
                          <span className="block font-normal text-[10px] text-gray-400">
                            {weekly.week_starts[i]?.slice(5) ?? ''}
                          </span>
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekly.customers.map((c) => (
                      <tr
                        key={c.party_name}
                        className="border-t border-gray-100 hover:bg-teal-50/40"
                      >
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                          {c.party_name}
                          {c.company && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                              {c.company}
                            </span>
                          )}
                        </td>
                        {[c.w1_kg, c.w2_kg, c.w3_kg, c.w4_kg].map((v, i) => (
                          <td key={i} className="px-3 py-2 text-right tabular-nums text-gray-700">
                            {v ? fmtKg(v) : '—'}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                          {fmtKg(c.total_kg)}
                        </td>
                      </tr>
                    ))}
                    {weekly.customers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                          No billing in this cycle yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="bg-gray-50">
                    <tr className="border-t border-gray-200 font-semibold">
                      <td className="px-3 py-2 text-gray-900">Beat total</td>
                      {[
                        weekly.totals.w1_kg,
                        weekly.totals.w2_kg,
                        weekly.totals.w3_kg,
                        weekly.totals.w4_kg,
                      ].map((v, i) => (
                        <td key={i} className="px-3 py-2 text-right tabular-nums text-gray-900">
                          {fmtKg(v)}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                        {fmtKg(weekly.totals.total_kg)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </>
      )}
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
