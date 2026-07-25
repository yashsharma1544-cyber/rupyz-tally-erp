'use client';

import { useEffect, useState } from 'react';
import { salesQuery } from './shared';
import { Probe } from './overview-tab';

export default function BeatDetailTab({
  beat,
  onChangeBeat,
}: {
  beat: string | null;
  onChangeBeat: (beat: string | null) => void;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    salesQuery({ rpc: 'beat_current_jc_weekly' })
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!beat)
    return (
      <div className="rounded-lg border border-gray-200 p-6 text-center">
        <p className="text-sm text-gray-600">Pick a beat from the Beat Matrix to see its detail.</p>
      </div>
    );

  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-dashed border-indigo-300 bg-indigo-50/40 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-indigo-900">{beat}</p>
            <p className="mt-1 text-xs text-indigo-700">
              Placeholder for All JCs / Weekly views and the JC selector.
            </p>
          </div>
          <button
            onClick={() => onChangeBeat(null)}
            className="shrink-0 rounded-md border border-indigo-300 px-2 py-1 text-xs text-indigo-700"
          >
            Clear
          </button>
        </div>
      </div>

      <Probe label="beat_current_jc_weekly" rows={rows} error={error} />
    </section>
  );
}
