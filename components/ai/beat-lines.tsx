"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, AlertCircle } from "lucide-react";

interface BeatLinesProps {
  /** Render prop: gets the lines map and renders into the table */
  children: (state: {
    lines: Record<string, string>;
    loading: boolean;
    error: string | null;
  }) => React.ReactNode;
}

/**
 * Fetches AI one-liners for all beats and exposes them via render prop.
 * The parent table maps beat rows to their line by beatId.
 */
export function BeatLinesProvider({ children }: BeatLinesProps) {
  const [lines, setLines] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

  return <>{children({ lines, loading, error })}</>;
}

/**
 * Compact loading + error indicator shown above the table.
 */
export function BeatLinesHeader({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-danger">
        <AlertCircle size={10}/> AI insights failed
      </span>
    );
  }
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-ink-subtle">
        <RefreshCw size={10} className="animate-spin"/> AI loading...
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-accent">
      <Sparkles size={10}/> AI insights
    </span>
  );
}
