'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { downloadCsv } from '../../shared';
import { loadSales, companyOf, beatOf, pct, fmtPct, type SaleRow } from '../../use-sales-data';

type Vals = { kg: number; amount: number; invoices: number };
type Cell = { cy: Vals; ly: Vals };

const JCS = Array.from({ length: 13 }, (_, i) => i + 1);
const zero = (): Vals => ({ kg: 0, amount: 0, invoices: 0 });
const blank = (): Cell => ({ cy: zero(), ly: zero() });

const num = (n: number) => Math.round(n).toLocaleString('en-IN');
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const rate = (v: Vals) => (v.kg ? v.amount / v.kg : 0);

function priorLabel(fy: string): string {
  const m = fy.match(/^(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${String(Number(m[1]) - 1).padStart(2, '0')}-${String(Number(m[2]) - 1).padStart(2, '0')}`;
}

export default function CustomerPage() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const name = decodeURIComponent(params.name);

  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const model = useMemo(() => {
    if (!rows || !cyFy) return null;

    const mine = rows.filter(
      (r) => r.party_name === name && (r.fy_label === cyFy || r.fy_label === lyFy)
    );
    if (!mine.length) return null;

    const jc: Record<number, Cell> = {};
    const total = blank();
    const beats = new Set<string>();
    const companies = new Set<string>();

    const add = (v: Vals, r: SaleRow) => {
      v.kg += r.kg;
      v.amount += r.amount;
      v.invoices += r.invoices;
    };

    for (const r of mine) {
      const side: keyof Cell = r.fy_label === cyFy ? 'cy' : 'ly';
      add((jc[r.jc_number] ??= blank())[side], r);
      add(total[side], r);
      beats.add(beatOf(r.beat));
      companies.add(companyOf(r.company_name));
    }

    const billed = JCS.filter((n) => (jc[n]?.cy.kg ?? 0) > 0);
    const currentJc = Math.max(0, ...rows.filter((r) => r.fy_label === cyFy).map((r) => r.jc_number));

    return {
      jc,
      total,
      beats: Array.from(beats),
      companies: Array.from(companies),
      billed,
      currentJc,
    };
  }, [rows, name, cyFy, lyFy]);

  function exportCsv() {
    if (!model) return;
    const out = JCS.map((n) => ({
      JC: n,
      [`Kg ${cyFy}`]: Math.round(model.jc[n]?.cy.kg ?? 0),
      [`Kg ${lyFy}`]: Math.round(model.jc[n]?.ly.kg ?? 0),
      [`Value ${cyFy}`]: Math.round(model.jc[n]?.cy.amount ?? 0),
      [`Value ${lyFy}`]: Math.round(model.jc[n]?.ly.amount ?? 0),
      [`Invoices ${cyFy}`]: model.jc[n]?.cy.invoices ?? 0,
    }));
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadCsv(out, `customer_${slug}.csv`);
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
        <Link href="/sales?tab=customers" className="text-sm font-medium text-teal-800 hover:underline">
          Sales home
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{name}</h1>
          <p className="text-xs text-gray-500">
            {model
              ? `${model.beats.join(', ')} · ${model.companies.join(', ')} · FY ${cyFy} vs FY ${lyFy}`
              : `FY ${cyFy}`}
          </p>
        </div>
        {model && (
          <button
            onClick={exportCsv}
            className="ml-auto rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            CSV
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-medium text-red-800">Could not load sales</p>
          <p className="mt-1 break-words font-mono text-[11px] text-red-700">{error}</p>
        </div>
      )}

      {!rows && !error && <p className="text-sm text-gray-500">Loading…</p>}

      {rows && !model && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">
            No billing found for this customer in {cyFy} or {lyFy}.
          </p>
          <Link href="/sales" className="mt-2 inline-block text-sm text-teal-800 hover:underline">
            Back to Sales
          </Link>
        </div>
      )}

      {model && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <Kpi
              label="Volume"
              value={num(model.total.cy.kg) + ' kg'}
              note={`${lyFy}: ${num(model.total.ly.kg)} kg`}
              delta={pct(model.total.cy.kg, model.total.ly.kg)}
            />
            <Kpi
              label="Value"
              value={inr(model.total.cy.amount)}
              note={`${lyFy}: ${inr(model.total.ly.amount)}`}
              delta={pct(model.total.cy.amount, model.total.ly.amount)}
            />
            <Kpi
              label="Invoices"
              value={num(model.total.cy.invoices)}
              note={`${lyFy}: ${num(model.total.ly.invoices)}`}
              delta={pct(model.total.cy.invoices, model.total.ly.invoices)}
            />
            <Kpi
              label="Realisation"
              value={'₹' + rate(model.total.cy).toFixed(1) + '/kg'}
              note={`${lyFy}: ₹${rate(model.total.ly).toFixed(1)}/kg`}
              delta={pct(rate(model.total.cy), rate(model.total.ly))}
            />
            <Kpi
              label="Avg per invoice"
              value={
                model.total.cy.invoices
                  ? num(model.total.cy.kg / model.total.cy.invoices) + ' kg'
                  : '—'
              }
              note={
                model.total.ly.invoices
                  ? `${lyFy}: ${num(model.total.ly.kg / model.total.ly.invoices)} kg`
                  : ''
              }
              delta={pct(
                model.total.cy.invoices ? model.total.cy.kg / model.total.cy.invoices : 0,
                model.total.ly.invoices ? model.total.ly.kg / model.total.ly.invoices : 0
              )}
            />
          </div>

          <p className="text-xs text-gray-500">
            Billed in {model.billed.length} of {model.currentJc} cycles so far this year.
          </p>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  <th className="px-3 py-2 text-xs font-medium text-gray-600">Cycle</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                    Kg {cyFy}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                    Kg {lyFy}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Δ</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                    Value {cyFy}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                    Invoices
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">
                    ₹/kg
                  </th>
                </tr>
              </thead>
              <tbody>
                {JCS.map((n) => {
                  const c = model.jc[n];
                  const cy = c?.cy ?? zero();
                  const ly = c?.ly ?? zero();
                  const behind = ly.kg > 0 && cy.kg < ly.kg;
                  return (
                    <tr key={n} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium text-gray-900">JC{n}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                        {cy.kg ? num(cy.kg) : '—'}
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums text-gray-500 ${
                          behind ? 'bg-amber-50' : ''
                        }`}
                      >
                        {ly.kg ? num(ly.kg) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <Delta value={pct(cy.kg, ly.kg)} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                        {cy.amount ? inr(cy.amount) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                        {cy.invoices || '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                        {cy.kg ? '₹' + rate(cy).toFixed(1) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr className="border-t-2 border-gray-300 font-semibold">
                  <td className="px-3 py-2 text-gray-900">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                    {num(model.total.cy.kg)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {num(model.total.ly.kg)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <Delta value={pct(model.total.cy.kg, model.total.ly.kg)} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                    {inr(model.total.cy.amount)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                    {model.total.cy.invoices}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                    ₹{rate(model.total.cy).toFixed(1)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            {model.beats.map((b) => (
              <Link
                key={b}
                href={`/sales/beat/${encodeURIComponent(b)}`}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-teal-800 hover:bg-teal-50"
              >
                View beat: {b} →
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
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
