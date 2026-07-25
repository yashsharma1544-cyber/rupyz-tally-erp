'use client';

export type SalesQuery = {
  rpc?: string;
  args?: Record<string, unknown>;
  view?: string;
  select?: string;
  filters?: { col: string; op: string; val: unknown }[];
  order?: { col: string; asc?: boolean };
  limit?: number;
};

export async function salesQuery<T = Record<string, unknown>>(
  q: SalesQuery
): Promise<T[]> {
  const res = await fetch('/api/sales/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(q),
    cache: 'no-store',
  });

  const json = await res.json().catch(() => ({ error: 'Response was not JSON.' }));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`);
  return (json.data ?? []) as T[];
}

export const fmtKg = (n: number | null | undefined) =>
  n == null ? '—' : Math.round(n).toLocaleString('en-IN');

export const fmtINR = (n: number | null | undefined) =>
  n == null ? '—' : '₹' + Math.round(n).toLocaleString('en-IN');

export function downloadCsv(
  rows: Record<string, unknown>[],
  filename: string,
  headers?: string[]
) {
  if (!rows.length) return;
  const cols = headers ?? Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
