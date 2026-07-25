'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { salesRpc, fmtKg } from '../../shared';
import { exportXlsx, stamp, type XlsxColumn } from '../../export-xlsx';
import CycleReportButton from '../../cycle-report';
import {
  loadSales,
  companyOf,
  beatOf,
  pct,
  fmtPct,
  type SaleRow,
} from '../../use-sales-data';

type Metric = 'kg' | 'amount';
type View = 'all' | 'weekly';
type Cell = { cy: number; ly: number };

type WeeklyResp = {
  beat: string;
  jc_start: string;
  jc_end: string;
  latest_jc: number;
  current_jc: number;
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

const JCS = Array.from({ length: 13 }, (_, i) => i + 1);
const blank = (): Cell => ({ cy: 0, ly: 0 });

function priorLabel(fy: string): string {
  const m = fy.match(/^(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${String(Number(m[1]) - 1).padStart(2, '0')}-${String(Number(m[2]) - 1).padStart(2, '0')}`;
}

export default function BeatPage() {
  const params = useParams<{ beat: string }>();
  const router = useRouter();
  const beat = decodeURIComponent(params.beat);

  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('all');
  const [metric, setMetric] = useState<Metric>('kg');

  const [weekly, setWeekly] = useState<WeeklyResp | null>(null);
  const [weeklyErr, setWeeklyErr] = useState<string | null>(null);
  const [jcPick, setJcPick] = useState<number | null>(null);

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

  const liveJc = useMemo(() => {
    if (!rows || !cyFy) return 0;
    const live = rows.filter((r) => r.fy_label === cyFy).map((r) => r.jc_number);
    return live.length ? Math.max(...live) : 0;
  }, [rows, cyFy]);

  useEffect(() => {
    if (view !== 'weekly') return;
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

  const model = useMemo(() => {
    if (!rows || !cyFy) return null;

    const mine = rows.filter(
      (r) => beatOf(r.beat) === beat && (r.fy_label === cyFy || r.fy_label === lyFy)
    );

    const custs = new Map<
      string,
      { name: string; company: string; jc: Record<number, Cell>; total: Cell }
    >();

    for (const r of mine) {
      const side: keyof Cell = r.fy_label === cyFy ? 'cy' : 'ly';
      let c = custs.get(r.party_name);
      if (!c) {
        c = { name: r.party_name, company: companyOf(r.company_name), jc: {}, total: blank() };
        custs.set(r.party_name, c);
      }
      (c.jc[r.jc_number] ??= blank())[side] += r[metric];
      c.total[side] += r[metric];
    }

    const list = Array.from(custs.values()).sort((a, b) => b.total.cy - a.total.cy);

    const footer: { jc: Record<number, Cell>; total: Cell } = { jc: {}, total: blank() };
    for (const c of list) {
      for (const n of JCS) {
        const cell = c.jc[n];
        if (!cell) continue;
        (footer.jc[n] ??= blank()).cy += cell.cy;
        footer.jc[n].ly += cell.ly;
      }
      footer.total.cy += c.total.cy;
      footer.total.ly += c.total.ly;
    }

    return { list, footer };
  }, [rows, beat, cyFy, lyFy, metric]);

  const fmt = (n: number) =>
    n === 0
      ? '—'
      : metric === 'kg'
      ? Math.round(n).toLocaleString('en-IN')
      : '₹' + Math.round(n).toLocaleString('en-IN');

  async function exportAll() {
    if (!model) return;
    const money = metric === 'amount';

    const columns: XlsxColumn[] = [
      { key: 'name', header: 'Customer', width: 34 },
      { key: 'company', header: 'Company', width: 18 },
    ];
    for (const n of JCS) {
      columns.push({ key: `jc${n}cy`, header: `JC${n} CY`, type: money ? 'money' : 'number' });
      columns.push({ key: `jc${n}ly`, header: `JC${n} LY`, type: money ? 'money' : 'number' });
    }
    columns.push(
      { key: 'totCy', header: `Total ${cyFy}`, type: money ? 'money' : 'number', width: 16 },
      { key: 'totLy', header: `Total ${lyFy}`, type: money ? 'money' : 'number', width: 16 },
      { key: 'chg', header: 'Change %', type: 'percent' },
      { key: 'flag', header: 'Status', width: 12 }
    );

    const rows = model.list.map((c) => {
      const o: Record<string, unknown> = { name: c.name, company: c.company };
      for (const n of JCS) {
        o[`jc${n}cy`] = Math.round(c.jc[n]?.cy ?? 0);
        o[`jc${n}ly`] = Math.round(c.jc[n]?.ly ?? 0);
      }
      o.totCy = Math.round(c.total.cy);
      o.totLy = Math.round(c.total.ly);
      o.chg = pct(c.total.cy, c.total.ly);
      o.flag =
        c.total.ly > 0 && c.total.cy === 0
          ? 'STOPPED'
          : c.total.cy > 0 && c.total.ly === 0
          ? 'NEW'
          : '';
      return o;
    });

    const totals: Record<string, unknown> = { name: 'Beat total', company: '' };
    for (const n of JCS) {
      totals[`jc${n}cy`] = Math.round(model.footer.jc[n]?.cy ?? 0);
      totals[`jc${n}ly`] = Math.round(model.footer.jc[n]?.ly ?? 0);
    }
    totals.totCy = Math.round(model.footer.total.cy);
    totals.totLy = Math.round(model.footer.total.ly);
    totals.chg = pct(model.footer.total.cy, model.footer.total.ly);
    totals.flag = '';

    await exportXlsx({
      filename: `Beat_${beat.replace(/[^A-Za-z0-9]+/g, '_')}_AllJCs_${money ? 'Value' : 'Kg'}_${stamp()}`,
      sheetName: 'All JCs',
      title: `${beat} · all cycles`,
      subtitle: `FY ${cyFy} vs FY ${lyFy} · ${model.list.length} customers · ${
        money ? 'value in ₹' : 'volume in kg'
      }${liveJc ? ` · JC${liveJc} in progress` : ''}`,
      columns,
      rows,
      totals,
      highlightHeaders: liveJc ? [`JC${liveJc} CY`, `JC${liveJc} LY`] : [],
    });
  }

  async function exportWeekly() {
    if (!weekly) return;
    const wk = (i: number) => weekly.week_starts[i]?.slice(5) ?? `W${i + 1}`;

    const columns: XlsxColumn[] = [
      { key: 'name', header: 'Customer', width: 34 },
      { key: 'company', header: 'Company', width: 18 },
      { key: 'w1', header: `W1 ${wk(0)}`, type: 'number' },
      { key: 'w2', header: `W2 ${wk(1)}`, type: 'number' },
      { key: 'w3', header: `W3 ${wk(2)}`, type: 'number' },
      { key: 'w4', header: `W4 ${wk(3)}`, type: 'number' },
      { key: 'total', header: 'Total kg', type: 'number', width: 14 },
    ];

    const rows = weekly.customers.map((c) => ({
      name: c.party_name,
      company: c.company ?? '',
      w1: Math.round(c.w1_kg),
      w2: Math.round(c.w2_kg),
      w3: Math.round(c.w3_kg),
      w4: Math.round(c.w4_kg),
      total: Math.round(c.total_kg),
    }));

    await exportXlsx({
      filename: `Beat_${beat.replace(/[^A-Za-z0-9]+/g, '_')}_JC${jcPick ?? weekly.current_jc}_Weekly_${stamp()}`,
      sheetName: `JC${jcPick ?? weekly.current_jc} weekly`,
      title: `${beat} · JC${jcPick ?? weekly.current_jc} week by week`,
      subtitle: `${weekly.jc_start} to ${weekly.jc_end} · ${weekly.customers.length} customers · ${Math.round(
        weekly.totals.total_kg
      ).toLocaleString('en-IN')} kg`,
      columns,
      rows,
      totals: {
        name: 'Beat total',
        company: '',
        w1: Math.round(weekly.totals.w1_kg),
        w2: Math.round(weekly.totals.w2_kg),
        w3: Math.round(weekly.totals.w3_kg),
        w4: Math.round(weekly.totals.w4_kg),
        total: Math.round(weekly.totals.total_kg),
      },
    });
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          ← Back
        </button>
        <Link
          href="/sales?tab=beat-matrix"
          className="text-sm font-medium text-teal-800 hover:underline"
        >
          Sales home
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{beat}</h1>
          <p className="text-xs text-gray-500">
            {model ? `${model.list.length} customers · ` : ''}FY {cyFy} vs FY {lyFy}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
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

          {view === 'all' && (
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
          )}

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
            className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            Excel
          </button>
        </div>
      </div>

      <CycleReportButton beat={beat} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-medium text-red-800">Could not load sales</p>
          <p className="mt-1 break-words font-mono text-[11px] text-red-700">{error}</p>
        </div>
      )}

      {!rows && !error && <p className="text-sm text-gray-500">Loading…</p>}

      {view === 'all' && model && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="text-sm">
            <thead>
              <tr>
                <th
                  rowSpan={2}
                  className="sticky left-0 z-20 border-b border-r border-gray-200 bg-gray-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600"
                >
                  Customer
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
              {model.list.map((c) => (
                <tr key={c.name} className="border-t border-gray-100 hover:bg-teal-50/30">
                  <td className="sticky left-0 z-10 whitespace-nowrap border-r border-gray-200 bg-white px-3 py-2">
                    <Link
                      href={`/sales/customer/${encodeURIComponent(c.name)}`}
                      className="font-medium text-gray-900 hover:text-teal-800 hover:underline"
                    >
                      {c.name}
                    </Link>
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                      {c.company}
                    </span>
                  </td>
                  {JCS.map((n) => (
                    <Pair key={n} cell={c.jc[n]} fmt={fmt} live={n === liveJc} />
                  ))}
                  <TotalCells cell={c.total} fmt={fmt} />
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                <td className="sticky left-0 z-10 border-r border-gray-200 bg-gray-50 px-3 py-2 text-gray-900">
                  Beat total
                </td>
                {JCS.map((n) => (
                  <Pair key={n} cell={model.footer.jc[n]} fmt={fmt} bold live={n === liveJc} />
                ))}
                <TotalCells cell={model.footer.total} fmt={fmt} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {view === 'weekly' && (
        <>
          {weeklyErr && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-medium text-red-800">Weekly view failed</p>
              <p className="mt-1 break-words font-mono text-[11px] text-red-700">{weeklyErr}</p>
            </div>
          )}
          {!weekly && !weeklyErr && <p className="text-sm text-gray-500">Loading weekly split…</p>}
          {weekly && (
            <>
              <p className="text-xs text-gray-500">
                JC{jcPick ?? weekly.current_jc} · {weekly.jc_start} to {weekly.jc_end} ·{' '}
                {fmtKg(weekly.totals.total_kg)} kg
              </p>
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left">
                      <th className="px-3 py-2 text-xs font-medium text-gray-600">
                        {weekly.customers.length} customers
                      </th>
                      {[0, 1, 2, 3].map((i) => (
                        <th
                          key={i}
                          className="px-3 py-2 text-right text-xs font-medium text-gray-600"
                        >
                          W{i + 1}
                          <span className="block text-[10px] font-normal text-gray-400">
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
                      <tr key={c.party_name} className="border-t border-gray-100 hover:bg-teal-50/40">
                        <td className="whitespace-nowrap px-3 py-2">
                          <Link
                            href={`/sales/customer/${encodeURIComponent(c.party_name)}`}
                            className="font-medium text-gray-900 hover:text-teal-800 hover:underline"
                          >
                            {c.party_name}
                          </Link>
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
    </div>
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
        } ${bold ? 'font-semibold text-gray-900' : 'text-gray-800'}`}
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
