'use client';

import { useEffect, useState } from 'react';
import { salesQuery } from './shared';
import { Probe } from './overview-tab';

export default function CustomersTab() {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    salesQuery({ rpc: 'customers_jc_kg' })
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-dashed border-indigo-300 bg-indigo-50/40 p-4">
        <p className="text-sm font-medium text-indigo-900">Customers explorer</p>
        <p className="mt-1 text-xs text-indigo-700">
          Placeholder for JC1–JC4 columns, LY / YTD Avg targets, filters and CSV.
        </p>
      </div>

      <Probe label="customers_jc_kg" rows={rows} error={error} />
    </section>
  );
}
