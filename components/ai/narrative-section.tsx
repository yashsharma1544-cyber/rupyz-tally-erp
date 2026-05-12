"use client";

import { useState, useEffect } from "react";
import { Sparkles, RefreshCw, AlertCircle } from "lucide-react";

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
      <div className="px-4 py-3 border-b border-paper-line flex items-center justify-between gap-2">
        <h3 className="font-semibold inline-flex items-center gap-1.5">
          <Sparkles size={14} className="text-accent" />
          {title}
        </h3>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 text-2xs text-ink-muted hover:text-ink disabled:opacity-50"
          aria-label="Regenerate"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          {loading ? "Generating…" : "Regenerate"}
        </button>
      </div>
      <div className="p-4">
        {loading && !narrative && (
          <div className="text-sm text-ink-muted italic">Reading the data...</div>
        )}
        {error && (
          <div className="bg-danger-soft text-danger text-xs rounded px-3 py-2 flex items-start gap-2">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {narrative && (
          <div className="space-y-2">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{narrative}</p>
            {mounted && generatedAt && (
              <p className="text-2xs text-ink-subtle">
                {cached ? "From cache" : "Just generated"} · {new Date(generatedAt).toLocaleString("en-IN")}
              </p>
            )}
          </div>
        )}
        {!loading && !narrative && !error && !autoLoad && (
          <button
            type="button"
            onClick={load}
            className="text-sm text-accent hover:underline"
          >
            Generate AI insight
          </button>
        )}
      </div>
    </div>
  );
}
