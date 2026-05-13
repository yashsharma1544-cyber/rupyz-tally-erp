"use client";

import { useState, useEffect } from "react";
import { Sparkles, RefreshCw, AlertCircle } from "lucide-react";
import { BulletNarrative } from "./bullet-narrative";

interface NarrativeSectionProps {
  /** API endpoint, e.g. /api/ai/narrative/customer/abc123 */
  endpoint: string;
  /** Title shown in the card */
  title?: string;
  /** Auto-load on mount. Default true. Set false to make user click "Generate". */
  autoLoad?: boolean;
}

export function NarrativeSection({
  endpoint,
  title = "AI insights",
  autoLoad = true,
}: NarrativeSectionProps) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to generate");
        setNarrative(null);
      } else {
        setNarrative(data.narrative);
        setCached(data.cached);
        setGeneratedAt(data.generatedAt);
      }
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (autoLoad) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  return (
    <div className="bg-paper-card border border-paper-line rounded-md">
      <div className="px-3 py-2.5 border-b border-paper-line flex items-center justify-between gap-2">
        <h3 className="font-semibold text-sm inline-flex items-center gap-1.5">
          <Sparkles size={13} className="text-accent" />
          {title}
        </h3>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 text-2xs text-ink-muted hover:text-ink disabled:opacity-50"
          aria-label="Regenerate"
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          {loading ? "..." : "Refresh"}
        </button>
      </div>
      <div className="p-3">
        {loading && !narrative && (
          <div className="text-xs text-ink-muted italic">Reading the data...</div>
        )}
        {error && (
          <div className="bg-danger-soft text-danger text-xs rounded px-2.5 py-2 flex items-start gap-2">
            <AlertCircle size={11} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {narrative && <BulletNarrative text={narrative} />}
        {narrative && mounted && generatedAt && (
          <p className="text-2xs text-ink-subtle mt-2.5">
            {cached ? "Cached" : "Just now"} · {new Date(generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
        {!loading && !narrative && !error && !autoLoad && (
          <button
            type="button"
            onClick={load}
            className="text-xs text-accent hover:underline"
          >
            Generate AI insight
          </button>
        )}
      </div>
    </div>
  );
}
