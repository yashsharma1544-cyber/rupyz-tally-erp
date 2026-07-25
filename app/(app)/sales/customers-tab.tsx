'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { salesRpc, fmtKg, fmtINR, downloadCsv } from './shared';

type ListRow = {
  party_name: string;
  beat: string | null;
  company: string | null;
  ytd_kg: number | null;
  ytd_amount: number | null;
  prior_kg: number | null;
  prior_amount: number | null;
};

type ListResp = {
  beats: string[];
  customers: ListRow[];
  current_fy: string;
  prior_fy: string;
};

type JcResp = {
  customers: { party_name: string; jc_kg: Record<string, number> }[];
  current_jc: number;
};

type Row = ListRow & { jc: Record<number, number>; lyAvg: number; ytdAvg: number };

const JC_PER_FY = 13;
type SortKey = 'name' | 'ytd' | 'lyAvg' | 'ytdAvg' | number;

export default function CustomersTab() {
  const [list, setList] = useState<ListResp | null>(null);
  const [jc, setJc] = useState<JcResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [beat, setBeat] = useState('all');
  const [company, setCompany] = useState('all');
  const [minKg, setMinKg] = useState('');
  const [maxKg, setMaxKg] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('ytd');
  const [asc, setAsc] = useState(false);

  useEffect(() => {
    Promise.all([salesRpc<ListResp>('customers_list'), salesRpc<JcResp>('customers_jc_kg')])
      .then(([l, j]) => {
        setList(l);
        setJc(j);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const currentJc = jc?.current_jc ?? 0;
  const jcCols = useMemo(
    () => Array.from({ length: currentJc }, (_, i) => i + 1),
    [currentJc]
  );

  const rows: Row[] = useMemo(() => {
    if (!list || !jc) return [];
    const byName = new Map(jc.customers.map((c) => [c.party_name, c.jc_kg]));

    return list.customers.map((c) => {
      const raw = byName.get(c.party_name) ?? {};
      const jcMap: Record<number, number> = {};
      for (const n of jcCols) jcMap[n] = Number(raw[String(n)] ?? 0);
      return {
        ...c,
        jc: jcMap,
        lyAvg: (c.prior_kg ?? 0) / JC_PER_FY,
        ytdAvg: currentJc ? (c.ytd_kg ?? 0) / currentJc : 0,
      };
    });
  }, [list, jc, jcCols, currentJc]);

  const companies = useMemo(
    () => Array.from(new Set(rows.map((r) => r.company).filter(Boolean))) as string[],
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const lo = minKg === '' ? null : Number(minKg);
    const hi = maxKg === '' ? null : Number(maxKg);

    const out = rows.filter((r) => {
      if (q && !r.party_name.toLowerCase().includes(q)) return false;
      if (beat !== 'all' && (r.beat ?? '(unassigned)') !== beat) return false;
      if (company !== 'all' && r.company !== company) return false;
      const k = r.ytd_kg ?? 0;
      if (lo != null && k < lo) return false;
      if (hi != null && k > hi) return false;
      return true;
    });

    const val = (r: Row): string | number => {
      if (sortKey === 'name') return r.party_name.toLowerCase();
      if (sortKey === 'ytd') return r.ytd_kg ?? 0;
      if (sortKey === 'lyAvg') return r.lyAvg;
      if (sortKey === 'ytdAvg') return r.ytdAvg;
      return r.jc[sortKey] ?? 0;
    };

    return out.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (typeof x === 'string' || typeof y === 'string')
        return asc
          ? String(x).localeCompare(String(y))
          : String(y).localeCompare(String(x));
      return asc ? x - y : y - x;
    });
  }, [rows, search, beat, company, minKg, maxKg, sortKey, asc]);

  const totals = useMemo(
    () => ({
      customers: filtered.length,
      ytdKg: filtered.reduce((s, r) => s + (r.ytd_kg ?? 0), 0),
      priorKg: filtered.reduce((s, r) => s + (r.prior_kg ?? 0), 0),
      ytdAmount: filtered.reduce((s, r) => s + (r.ytd_amount ?? 0), 0),
    }),
    [filtered]
  );

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function sortBy(k: SortKey) {
    if (k === sortKey) setAsc(!asc);
    else {
      setSortKey(k);
      setAsc(k === 'name');
    }
  }

  function exportCsv() {
    const out = filtered.map((r) => {
      const base: Record<string, unknown> = {
        Customer: r.party_name,
        Beat: r.beat ?? '(unassigned)',
        Company: r.company ?? '',
      };
      for (const n of jcCols) base[`JC${n}`] = Math.round(r.jc[n] ?? 0);
      base['YTD Kg'] = Math.round(r.ytd_kg ?? 0);
      base['YTD Amount'] = Math.round(r.ytd_amount ?? 0);
      base['LY Kg'] = Math.round(r.prior_kg ?? 0);
      base['LY Avg/JC'] = Math.round(r.lyAvg);
      base['YTD Avg/JC'] = Math.round(r.ytdAvg);
      return base;
    });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadCsv(out, `sales_customers_${stamp}.csv`);
  }

  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="text-xs font-medium text-red-800">Could not load customers</p>
        <p className="mt-1 break-words font-mono text-[11px] text-red-700">{error}</p>
      </div>
    );

  if (!list || !jc) return <p className="p-4 text-sm text-gray-500">Loading customers…</p>;

  const th =
    'px-3 py-2 text-xs font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:text-teal-800';
  const arrow = (k: SortKey) => (sortKey === k ? (asc ? ' \u2191' : ' \u2193') : '');

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer…"
          className="min-w-[180px] flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <select
          value={beat}
          onChange={(e) => setBeat(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="all">All beats</option>
          {list.beats.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
          <option value="(unassigned)">(unassigned)</option>
        </select>
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
        <div className="flex items-center gap-1">
          <input
            value={minKg}
            onChange={(e) => setMinKg(e.target.value)}
            placeholder="min kg"
            inputMode="numeric"
            className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <span className="text-gray-400">–</span>
          <input
            value={maxKg}
            onChange={(e) => setMaxKg(e.target.value)}
            placeholder="max kg"
            inputMode="numeric"
            className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={exportCsv}
          className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
        >
          CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Customers" value={totals.customers.toLocaleString('en-IN')} />
        <Stat label={`YTD Kg (${list.current_fy})`} value={fmtKg(totals.ytdKg)} />
        <Stat label={`LY Kg (${list.prior_fy})`} value={fmtKg(totals.priorKg)} />
        <Stat label="YTD Value" value={fmtINR(totals.ytdAmount)} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className={th} onClick={() => sortBy('name')}>
                Customer{arrow('name')}
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-xs font-medium text-gray-600">
                Beat
              </th>
              {jcCols.map((n) => (
                <th key={n} className={`${th} text-right`} onClick={() => sortBy(n)}>
                  JC{n}
                  {arrow(n)}
                </th>
              ))}
              <th className={`${th} text-right`} onClick={() => sortBy('ytd')}>
                YTD Kg{arrow('ytd')}
              </th>
              <th className={`${th} text-right`} onClick={() => sortBy('ytdAvg')}>
                YTD Avg/JC{arrow('ytdAvg')}
              </th>
              <th className={`${th} text-right`} onClick={() => sortBy('lyAvg')}>
                LY Avg/JC{arrow('lyAvg')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const behind = r.ytdAvg < r.lyAvg;
              const key = `${r.company}-${r.party_name}`;
              const isOpen = open.has(key);
              return (
                <Fragment key={key}>
                <tr className="border-t border-gray-100 hover:bg-teal-50/40">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                    <button
                      onClick={() => toggle(key)}
                      className="text-left hover:text-teal-800"
                    >
                      <span className="mr-1 inline-block w-3 text-gray-400">
                        {isOpen ? '\u25be' : '\u25b8'}
                      </span>
                      {r.party_name}
                    </button>
                    {r.company && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">
                        {r.company}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                    {r.beat ?? '(unassigned)'}
                  </td>
                  {jcCols.map((n) => (
                    <td key={n} className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {r.jc[n] ? fmtKg(r.jc[n]) : '—'}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                    {fmtKg(r.ytd_kg)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      behind ? 'text-red-600' : 'text-emerald-700'
                    }`}
                  >
                    {fmtKg(r.ytdAvg)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                    {fmtKg(r.lyAvg)}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-white">
                    <td colSpan={jcCols.length + 5} className="px-3 py-3">
                      <CustomerDetail row={r} jcCols={jcCols} currentJc={currentJc} priorFy={list.prior_fy} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={jcCols.length + 5}
                  className="px-3 py-8 text-center text-sm text-gray-500"
                >
                  No customers match these filters. Widen the kg range or clear the beat.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="px-1 text-[11px] text-gray-400">
        YTD Avg/JC = YTD kg ÷ {currentJc} elapsed cycles · LY Avg/JC = {list.prior_fy} kg ÷{' '}
        {JC_PER_FY}. Red means running below last year&apos;s pace.
      </p>
    </section>
  );
}

function CustomerDetail({
  row,
  jcCols,
  currentJc,
  priorFy,
}: {
  row: Row;
  jcCols: number[];
  currentJc: number;
  priorFy: string;
}) {
  const ytdKg = row.ytd_kg ?? 0;
  const ytdAmt = row.ytd_amount ?? 0;
  const lyKg = row.prior_kg ?? 0;
  const lyAmt = row.prior_amount ?? 0;

  const billed = jcCols.filter((n) => (row.jc[n] ?? 0) > 0);
  const best = billed
    .map((n) => ({ n, kg: row.jc[n] }))
    .sort((a, b) => b.kg - a.kg)[0];
  const gap = row.ytdAvg - row.lyAvg;
  const projected = row.ytdAvg * 13;

  const cards = [
    { label: 'YTD volume', value: fmtKg(ytdKg) + ' kg', note: `${priorFy}: ${fmtKg(lyKg)} kg` },
    { label: 'YTD value', value: fmtINR(ytdAmt), note: `${priorFy}: ${fmtINR(lyAmt)}` },
    {
      label: 'Realisation',
      value: ytdKg ? '\u20b9' + (ytdAmt / ytdKg).toFixed(1) + '/kg' : '\u2014',
      note: lyKg ? `${priorFy}: \u20b9${(lyAmt / lyKg).toFixed(1)}/kg` : '',
    },
    {
      label: 'Pace vs last year',
      value: (gap >= 0 ? '+' : '') + fmtKg(gap) + ' kg/JC',
      note: `${fmtKg(row.ytdAvg)} now vs ${fmtKg(row.lyAvg)}`,
    },
    {
      label: 'Full-year run rate',
      value: fmtKg(projected) + ' kg',
      note: `at the current ${currentJc}-cycle pace`,
    },
  ];

  return (
    <div className="space-y-2 rounded-md border border-teal-100 bg-teal-50/30 p-3">
      <p className="text-xs font-semibold text-gray-900">
        {row.party_name}
        <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-gray-500">
          {row.beat ?? '(unassigned)'} \u00b7 {row.company}
        </span>
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-md border border-gray-200 bg-white px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">{c.label}</p>
            <p className="text-sm font-semibold tabular-nums text-gray-900">{c.value}</p>
            {c.note && <p className="mt-0.5 text-[10px] text-gray-500">{c.note}</p>}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-gray-500">
        Billed in {billed.length} of {currentJc} cycles so far
        {best ? ` \u00b7 strongest JC${best.n} at ${fmtKg(best.kg)} kg` : ''}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-gray-900">{value}</p>
    </div>
  );
}
