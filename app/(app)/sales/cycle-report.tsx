'use client';

import { useState } from 'react';
import { salesRpc } from './shared';
import { exportXlsx, stamp, type XlsxColumn } from './export-xlsx';
import { loadSales, companyOf, beatOf, pct, type SaleRow } from './use-sales-data';

type Level = 'customer' | 'beat';

type WeeklyResp = {
  beat: string;
  jc_start: string;
  jc_end: string;
  current_jc: number;
  week_starts: string[];
  totals: { w1_kg: number; w2_kg: number; w3_kg: number; w4_kg: number; total_kg: number };
  customers: {
    party_name: string;
    company: string | null;
    w1_kg: number;
    w2_kg: number;
    w3_kg: number;
    w4_kg: number;
    total_kg: number;
  }[];
};

type Row = {
  name: string;
  beat: string;
  company: string;
  priorCy: number;
  priorLy: number;
  curCy: number;
  curLy: number;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
};

/** "SUSHIL AGENCIES" and "Sushil" both reduce to "sushil". */
function firstWord(s: string): string {
  return (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] ?? '';
}

function priorLabel(fy: string): string {
  const m = fy.match(/^(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${String(Number(m[1]) - 1).padStart(2, '0')}-${String(Number(m[2]) - 1).padStart(2, '0')}`;
}

export default function CycleReportButton({ beat }: { beat?: string | null }) {
  // Scoped to one beat: always list its customers, no level choice.
  const [levelState, setLevel] = useState<Level>('customer');
  const level: Level = beat ? 'customer' : levelState;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const rows: SaleRow[] = await loadSales();

      const fys = Array.from(new Set(rows.map((r) => r.fy_label))).sort();
      const cyFy = fys[fys.length - 1] ?? '';
      const lyFy = priorLabel(cyFy);
      const currentJc = Math.max(
        0,
        ...rows.filter((r) => r.fy_label === cyFy).map((r) => r.jc_number)
      );
      if (!currentJc) throw new Error('No cycles found for the current year.');

      const beats = beat
        ? [beat]
        : Array.from(new Set(rows.map((r) => beatOf(r.beat)))).sort();

      // Weekly split of the live cycle, one call per beat.
      const weeklies = await Promise.all(
        beats.map((b) =>
          salesRpc<WeeklyResp>('beat_current_jc_weekly', { p_beat: b, p_jc: currentJc })
            .then((w) => ({ beat: b, w }))
            .catch(() => ({ beat: b, w: null as WeeklyResp | null }))
        )
      );

      const okWeeks = weeklies.filter((x) => x.w) as { beat: string; w: WeeklyResp }[];
      const weekStarts = okWeeks[0]?.w.week_starts ?? [];
      const jcStart = okWeeks[0]?.w.jc_start ?? '';
      const jcEnd = okWeeks[0]?.w.jc_end ?? '';
      const missing = weeklies.length - okWeeks.length;

      // key -> row, plus a party-name index for the weekly merge
      const map = new Map<string, Row>();
      const byParty = new Map<string, Row[]>();
      const keyOf = (beat: string, party: string, co: string) =>
        level === 'beat' ? beat : `${co}||${party}`;

      for (const r of rows) {
        if (r.fy_label !== cyFy && r.fy_label !== lyFy) continue;
        if (r.jc_number > currentJc) continue;

        const rowBeat = beatOf(r.beat);
        if (beat && rowBeat !== beat) continue;
        const co = companyOf(r.company_name);
        const k = keyOf(rowBeat, r.party_name, co);

        let row = map.get(k);
        if (!row) {
          row = {
            name: level === 'beat' ? rowBeat : r.party_name,
            beat: rowBeat,
            company: co,
            priorCy: 0,
            priorLy: 0,
            curCy: 0,
            curLy: 0,
            w1: 0,
            w2: 0,
            w3: 0,
            w4: 0,
          };
          map.set(k, row);
          const bucket = byParty.get(r.party_name);
          if (bucket) bucket.push(row);
          else byParty.set(r.party_name, [row]);
        }

        const isCurrent = r.jc_number === currentJc;
        if (r.fy_label === cyFy) {
          if (isCurrent) row.curCy += r.kg;
          else row.priorCy += r.kg;
        } else {
          if (isCurrent) row.curLy += r.kg;
          else row.priorLy += r.kg;
        }
      }

      // Fold weekly kg in
      for (const { beat: wBeat, w } of okWeeks) {
        if (level === 'beat') {
          const row = map.get(wBeat);
          if (row) {
            row.w1 += w.totals.w1_kg;
            row.w2 += w.totals.w2_kg;
            row.w3 += w.totals.w3_kg;
            row.w4 += w.totals.w4_kg;
          }
          continue;
        }
        for (const c of w.customers) {
          // The RPC says "Sushil"; the view says "SUSHIL AGENCIES".
          // Match on party name, then disambiguate on the first word of the company.
          const cands = byParty.get(c.party_name);
          if (!cands || cands.length === 0) continue;

          let row = cands[0];
          if (cands.length > 1 && c.company) {
            const want = firstWord(c.company);
            row = cands.find((x) => firstWord(x.company) === want) ?? cands[0];
          }
          row.w1 += c.w1_kg;
          row.w2 += c.w2_kg;
          row.w3 += c.w3_kg;
          row.w4 += c.w4_kg;
        }
      }

      const list = Array.from(map.values()).sort(
        (a, b) => b.priorCy + b.curCy - (a.priorCy + a.curCy)
      );

      const prevLabel = currentJc > 1 ? `JC1–JC${currentJc - 1}` : 'JC1';
      const wk = (i: number) => weekStarts[i]?.slice(5) ?? `W${i + 1}`;

      const columns: XlsxColumn[] = [
        { key: 'name', header: level === 'beat' ? 'Beat' : 'Customer', width: 34 },
        ...(level === 'customer'
          ? ([
              { key: 'beat', header: 'Beat', width: 26 },
              { key: 'company', header: 'Company', width: 16 },
            ] as XlsxColumn[])
          : []),
        { key: 'priorCy', header: `${prevLabel} ${cyFy}`, type: 'number', width: 15 },
        { key: 'priorLy', header: `${prevLabel} ${lyFy}`, type: 'number', width: 15 },
        { key: 'priorChg', header: `${prevLabel} change %`, type: 'percent', width: 15 },
        { key: 'curCy', header: `JC${currentJc} ${cyFy}`, type: 'number', width: 14 },
        { key: 'curLy', header: `JC${currentJc} ${lyFy}`, type: 'number', width: 14 },
        { key: 'curChg', header: `JC${currentJc} change %`, type: 'percent', width: 14 },
        { key: 'w1', header: `W1 ${wk(0)}`, type: 'number' },
        { key: 'w2', header: `W2 ${wk(1)}`, type: 'number' },
        { key: 'w3', header: `W3 ${wk(2)}`, type: 'number' },
        { key: 'w4', header: `W4 ${wk(3)}`, type: 'number' },
      ];

      const out = list.map((r) => ({
        name: r.name,
        beat: r.beat,
        company: r.company,
        priorCy: Math.round(r.priorCy),
        priorLy: Math.round(r.priorLy),
        priorChg: pct(r.priorCy, r.priorLy),
        curCy: Math.round(r.curCy),
        curLy: Math.round(r.curLy),
        curChg: pct(r.curCy, r.curLy),
        w1: Math.round(r.w1),
        w2: Math.round(r.w2),
        w3: Math.round(r.w3),
        w4: Math.round(r.w4),
      }));

      const sum = (k: keyof Row) => list.reduce((s, r) => s + (r[k] as number), 0);
      const totals = {
        name: level === 'beat' ? 'All beats' : 'All customers',
        beat: '',
        company: '',
        priorCy: Math.round(sum('priorCy')),
        priorLy: Math.round(sum('priorLy')),
        priorChg: pct(sum('priorCy'), sum('priorLy')),
        curCy: Math.round(sum('curCy')),
        curLy: Math.round(sum('curLy')),
        curChg: pct(sum('curCy'), sum('curLy')),
        w1: Math.round(sum('w1')),
        w2: Math.round(sum('w2')),
        w3: Math.round(sum('w3')),
        w4: Math.round(sum('w4')),
      };

      const scope = beat ?? (level === 'beat' ? 'Beats' : 'Customers');
      await exportXlsx({
        filename: `Cycle_Report_${scope.replace(/[^A-Za-z0-9]+/g, '_')}_JC${currentJc}_${stamp()}`,
        sheetName: `JC${currentJc} report`,
        title: beat
          ? `${beat} · ${prevLabel} then JC${currentJc}`
          : `Cycle report · ${prevLabel} then JC${currentJc}`,
        subtitle: `FY ${cyFy} vs FY ${lyFy} · JC${currentJc} runs ${jcStart} to ${jcEnd} · ${
          out.length
        } ${level === 'beat' ? 'beats' : 'customers'} · kg${
          missing ? ` · weekly split unavailable for ${missing} beat(s)` : ''
        }`,
        columns,
        rows: out,
        totals,
        highlightHeaders: [`JC${currentJc} ${cyFy}`, `JC${currentJc} ${lyFy}`],
      });

      setNote(`${out.length} rows exported`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!beat && (
      <div className="flex overflow-hidden rounded-md border border-gray-300">
        {(['customer', 'beat'] as Level[]).map((l) => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className={`px-3 py-1.5 text-sm ${
              level === l ? 'bg-teal-700 text-white' : 'bg-white text-gray-600'
            }`}
          >
            {l === 'customer' ? 'By customer' : 'By beat'}
          </button>
        ))}
      </div>
      )}
      <button
        onClick={run}
        disabled={busy}
        className="rounded-md border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-50"
      >
        {busy ? 'Building…' : 'Cycle report'}
      </button>
      {note && <span className="text-[11px] text-gray-500">{note}</span>}
    </div>
  );
}
