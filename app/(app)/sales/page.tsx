'use client';

import { useState } from 'react';
import OverviewTab from './overview-tab';
import CustomersTab from './customers-tab';
import BeatMatrixTab from './beat-matrix-tab';
import BeatDetailTab from './beat-detail-tab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'customers', label: 'Customers' },
  { id: 'beat-matrix', label: 'Beat Matrix' },
  { id: 'beat-detail', label: 'Beat Detail' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function SalesPage() {
  const [tab, setTab] = useState<TabId>('overview');
  const [beat, setBeat] = useState<string | null>(null);

  function openBeat(name: string) {
    setBeat(name);
    setTab('beat-detail');
  }

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
            onClick={() => setTab(t.id)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'customers' && <CustomersTab />}
      {tab === 'beat-matrix' && <BeatMatrixTab onOpenBeat={openBeat} />}
      {tab === 'beat-detail' && <BeatDetailTab beat={beat} onChangeBeat={setBeat} />}
    </div>
  );
}
