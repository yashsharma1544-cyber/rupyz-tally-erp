"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus, MapPin, Sparkles, RefreshCw, AlertCircle } from "lucide-react";

interface BeatSummary {
  beat_id: string;
  beat_name: string;
  customer_count: number;
  active_30d_count: number;
  sleeping_count: number;
  this_30d_kg: number;
  prev_30d_kg: number;
  growth_pct: number | null;
}

function formatKg(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: n >= 100 ? 0 : 1 })} kg`;
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-2xs text-ink-subtle">
        <Minus size={9}/> no baseline
      </span>
    );
  }
  if (Math.abs(pct) < 1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-2xs text-ink-muted">
        <Minus size={9}/> flat
      </span>
    );
  }
  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-2xs text-ok font-semibold tabular">
        <ArrowUpRight size={10}/> +{pct.toFixed(0)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-2xs text-danger font-semibold tabular">
      <ArrowDownRight size={10}/> {pct.toFixed(0)}%
    </span>
  );
}

interface Props {
  beats: BeatSummary[];
  isAdmin: boolean;
}

export function BeatsTableClient({ beats, isAdmin }: Props) {
  const [lines, setLines] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/ai/insights-beat-lines", { method: "POST" })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (!d.ok) {
          setError(d.error || "Failed to load");
          return;
        }
        setLines(d.lines ?? {});
      })
      .catch(e => { if (!cancelled) setError(e?.message ?? "Network error"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin]);

  return (
    <>
      {isAdmin && (
        <div className="mb-2 flex justify-end">
          {error ? (
            <span className="inline-flex items-center gap-1 text-2xs text-danger">
              <AlertCircle size={10}/> AI insights failed
            </span>
          ) : loading ? (
            <span className="inline-flex items-center gap-1 text-2xs text-ink-subtle">
              <RefreshCw size={10} className="animate-spin"/> AI loading...
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-2xs text-accent">
              <Sparkles size={10}/> AI insights
            </span>
          )}
        </div>
      )}
      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${isAdmin ? "min-w-[920px]" : ""}`}>
            <thead className="bg-paper-subtle/50 border-b border-paper-line">
              <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-medium">Beat</th>
                <th className="px-3 py-2 font-medium text-right">Last 30d (kg)</th>
                <th className="px-3 py-2 font-medium text-right">vs prev</th>
                <th className="px-3 py-2 font-medium text-right">Customers</th>
                <th className="px-3 py-2 font-medium text-right">Active</th>
                <th className="px-3 py-2 font-medium text-right">Sleeping</th>
                {isAdmin && <th className="px-3 py-2 font-medium min-w-[280px]">AI insight</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {beats.map(b => (
                <tr key={b.beat_id} className="hover:bg-paper-subtle/40">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/insights/beats/${b.beat_id}`}
                      className="font-medium text-accent hover:underline inline-flex items-center gap-1"
                    >
                      <MapPin size={11}/> {b.beat_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular font-semibold">{formatKg(Number(b.this_30d_kg))}</td>
                  <td className="px-3 py-2.5 text-right"><GrowthBadge pct={b.growth_pct}/></td>
                  <td className="px-3 py-2.5 text-right tabular text-ink-muted">{Number(b.customer_count)}</td>
                  <td className="px-3 py-2.5 text-right tabular text-ok">{Number(b.active_30d_count)}</td>
                  <td className="px-3 py-2.5 text-right tabular">
                    {Number(b.sleeping_count) > 0 ? (
                      <span className="text-warn font-semibold">{Number(b.sleeping_count)}</span>
                    ) : (
                      <span className="text-ink-subtle">0</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2.5 text-xs text-ink leading-relaxed">
                      {lines[b.beat_id] ?? <span className="text-ink-subtle">—</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
