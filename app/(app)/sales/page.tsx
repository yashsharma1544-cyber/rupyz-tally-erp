'use client';

import { Suspense, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import OverviewTab from './overview-tab';
import CustomersTab from './customers-tab';
import BeatMatrixTab from './beat-matrix-tab';
import JcCompareTab from './jc-compare-tab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'customers', label: 'Customers' },
  { id: 'beat-matrix', label: 'Beat Matrix' },
  { id: 'jc-compare', label: 'JC Compare' },
] as const;

type TabId = (typeof TABS)[number]['id'];
const IDS = TABS.map((t) => t.id) as readonly string[];

export default function SalesPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-gray-500">Loading…</div>}>
      <SalesTabs />
    </Suspense>
  );
}

function SalesTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const raw = params.get('tab') ?? 'overview';
  const tab: TabId = (IDS.includes(raw) ? raw : 'overview') as TabId;
  const beat = params.get('beat');

  // Tab and drill-down live in the URL so the browser back button
  // returns to exactly where you were.
  const go = useCallback(
    (next: TabId, nextBeat?: string | null) => {
      const q = new URLSearchParams(params.toString());
      q.set('tab', next);
      if (nextBeat) q.set('beat', nextBeat);
      else q.delete('beat');
      router.push(`${pathname}?${q.toString()}`);
    },
    [params, pathname, router]
  );

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Sales</h1>
        <p className="text-xs text-gray-500">Tally Dashboard data · read-only</p>
      </header>

      <nav className="-mx-4 flex gap-1 overflow-x-auto border-b border-gray-200 px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-teal-700 text-teal-800'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'customers' && <CustomersTab />}
      {tab === 'beat-matrix' && <BeatMatrixTab />}
      {tab === 'jc-compare' && (
        <JcCompareTab beat={beat} onBeatChange={(b) => go('jc-compare', b)} />
      )}
    </div>
  );
}
