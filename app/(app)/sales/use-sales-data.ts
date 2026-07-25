'use client';

import { salesQuery } from './shared';

export type SaleRow = {
  company_name: string;
  fy_label: string;
  jc_number: number;
  party_name: string;
  beat: string | null;
  invoices: number;
  kg: number;
  amount: number;
};

/** company_name arrives as "SUSHIL AGENCIES 26-27" — drop the FY suffix. */
export const companyOf = (s: string | null) =>
  (s ?? '').replace(/\s*\d{2}-\d{2}\s*$/, '').trim();

export const beatOf = (b: string | null) => b ?? '(unassigned)';

let cache: Promise<SaleRow[]> | null = null;

/** Loads the full view once per page session; tabs share the result. */
export function loadSales(): Promise<SaleRow[]> {
  if (!cache) {
    cache = salesQuery<SaleRow>({ view: 'sales_by_party_jc', limit: 20000 })
      .then((rows) =>
        rows.map((r) => ({
          ...r,
          jc_number: Number(r.jc_number),
          invoices: Number(r.invoices) || 0,
          kg: Number(r.kg) || 0,
          amount: Number(r.amount) || 0,
        }))
      )
      .catch((e) => {
        cache = null; // let a retry work
        throw e;
      });
  }
  return cache;
}

export type FyInfo = {
  currentFy: string;
  priorFy: string | null;
  currentJc: number;
  companies: string[];
};

export function fyInfo(rows: SaleRow[]): FyInfo {
  const fys = Array.from(new Set(rows.map((r) => r.fy_label))).sort();
  const currentFy = fys[fys.length - 1] ?? '';
  const priorFy = fys.length > 1 ? fys[fys.length - 2] : null;
  const cy = rows.filter((r) => r.fy_label === currentFy);
  const currentJc = cy.length ? Math.max(...cy.map((r) => r.jc_number)) : 0;
  const companies = Array.from(new Set(rows.map((r) => companyOf(r.company_name))))
    .filter(Boolean)
    .sort();
  return { currentFy, priorFy, currentJc, companies };
}

export const pct = (cy: number, ly: number) =>
  ly === 0 ? null : ((cy - ly) / ly) * 100;

export function fmtPct(p: number | null) {
  if (p == null) return '—';
  const s = p >= 0 ? '+' : '';
  return `${s}${p.toFixed(1)}%`;
}
