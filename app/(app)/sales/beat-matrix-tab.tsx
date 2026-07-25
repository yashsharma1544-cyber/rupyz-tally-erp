'use client';

import { useEffect, useState } from 'react';
import { salesQuery } from './shared';
import { Probe } from './overview-tab';

export default function BeatMatrixTab({
  onOpenBeat,
}: {
  onOpenBeat: (beat: string) => void;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    salesQuery({ rpc: 'customers_list' })
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-dashed border-indigo-300 bg-indigo-50/40 p-4">
        <p className="text-sm font-medium text-indigo-900">Beat Matrix</p>
        <p className="mt-1 text-xs text-indigo-700">
          Placeholder for the beat × JC grid and per-beat CSV.
        </p>
        <button
          onClick={() => onOpenBeat('(sample beat)')}
          className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white"
        >
          Test drill-down to Beat Detail
        </button>
      </div>

      <Probe label="customers_list" rows={rows} error={error} />
    </section>
  );
}
