'use client';

import { useEffect, useState } from 'react';
import { salesQuery } from './shared';

export default function OverviewTab() {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    salesQuery({ view: 'sales_by_party_jc', limit: 5 })
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-dashed border-indigo-300 bg-indigo-50/40 p-4">
        <p className="text-sm font-medium text-indigo-900">Overview KPIs</p>
        <p className="mt-1 text-xs text-indigo-700">
          Placeholder. Real KPI cards land here next.
        </p>
      </div>

      <Probe label="sales_by_party_jc" rows={rows} error={error} />
    </section>
  );
}

export function Probe({
  label,
  rows,
  error,
}: {
  label: string;
  rows: Record<string, unknown>[] | null;
  error: string | null;
}) {
  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="text-xs font-medium text-red-800">{label} failed</p>
        <p className="mt-1 break-words font-mono text-[11px] text-red-700">{error}</p>
      </div>
    );

  if (!rows)
    return (
      <p className="px-1 text-xs text-gray-400">Checking {label}…</p>
    );

  const cols = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
      <p className="text-xs font-medium text-emerald-800">
        {label} connected · {rows.length} sample row{rows.length === 1 ? '' : 's'}
      </p>
      {cols.length > 0 && (
        <p className="mt-1 break-words font-mono text-[11px] text-emerald-700">
          {cols.join(' · ')}
        </p>
      )}
    </div>
  );
}
