"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertCircle, Sparkles } from "lucide-react";
import { BulletNarrative } from "./bullet-narrative";

export function BriefingCard() {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/briefing", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed");
        setBriefing(null);
      } else {
        setBriefing(data.briefing);
        setCached(data.cached);
        setAsOfDate(data.asOfDate);
      }
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="bg-paper-card border border-paper-line rounded-md">
      <div className="px-3 py-2.5 border-b border-paper-line flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm inline-flex items-center gap-1.5">
            <Sparkles size={13} className="text-accent" />
            Today&apos;s briefing
          </h3>
          {mounted && asOfDate && (
            <p className="text-2xs text-ink-subtle mt-0.5">
              {new Date(asOfDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
              {cached && " · cached"}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 text-2xs text-ink-muted hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          {loading ? "..." : "Refresh"}
        </button>
      </div>
      <div className="p-3">
        {loading && !briefing && (
          <div className="text-xs text-ink-muted italic">Pulling yesterday&apos;s numbers...</div>
        )}
        {error && (
          <div className="bg-danger-soft text-danger text-xs rounded px-2.5 py-2 flex items-start gap-2">
            <AlertCircle size={11} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {briefing && <BulletNarrative text={briefing} />}
      </div>
    </div>
  );
}
