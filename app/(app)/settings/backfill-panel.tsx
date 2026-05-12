"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  History, Play, RotateCcw, Settings, CheckCircle2, XCircle, Clock, Pause, AlertTriangle,
} from "lucide-react";
import { triggerBackfill, resetBackfill, setBackfillConfig } from "./backfill-actions";
import { toast } from "sonner";

export interface BackfillState {
  id: number;
  status: "idle" | "running" | "paused" | "completed" | "failed";
  last_completed_page: number;
  max_pages: number;
  cutoff_date: string | null;
  total_orders_processed: number;
  total_orders_inserted: number;
  total_orders_updated: number;
  total_orders_skipped: number;
  last_page_orders_count: number | null;
  last_page_oldest_at: string | null;
  started_at: string | null;
  last_run_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

const StatusBadge = ({ status }: { status: BackfillState["status"] }) => {
  const variants = {
    idle:      { color: "text-ink-muted",  Icon: Clock,         label: "Idle" },
    running:   { color: "text-accent",      Icon: Play,          label: "Running" },
    paused:    { color: "text-warn",        Icon: Pause,         label: "Paused" },
    completed: { color: "text-ok",          Icon: CheckCircle2,  label: "Completed" },
    failed:    { color: "text-danger",      Icon: XCircle,       label: "Failed" },
  };
  const v = variants[status] ?? variants.idle;
  const Icon = v.Icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${v.color}`}>
      <Icon size={12}/> {v.label}
    </span>
  );
};

export function BackfillPanel({ state }: { state: BackfillState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showConfig, setShowConfig] = useState(false);
  const [cutoffDate, setCutoffDate] = useState(state.cutoff_date?.slice(0, 10) ?? "");
  const [maxPages, setMaxPages] = useState(state.max_pages);
  // Hydration guard: only render locale-dependent date strings after mount,
  // so server and client agree on the initial HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  function handleStart() {
    startTransition(async () => {
      const res = await triggerBackfill();
      if (!res.ok) {
        toast.error(`Backfill failed: ${res.error}`);
      } else {
        const r = res.result;
        if (r.finalStatus === "completed") {
          toast.success(`Backfill complete! ${r.counters.inserted} new + ${r.counters.updated} updated this run.`);
        } else if (r.finalStatus === "paused") {
          toast.success(`Paused at page ${r.resumeAt} — ${r.counters.inserted} new this run. Click Resume to continue.`);
        } else if (r.finalStatus === "failed") {
          toast.error(`Backfill failed: ${r.error}`);
        } else {
          toast.success(`Backfill: ${r.finalStatus}`);
        }
      }
      router.refresh();
    });
  }

  function handleReset() {
    if (!confirm("Reset will clear all backfill progress. Already-imported orders will NOT be deleted. Continue?")) return;
    startTransition(async () => {
      const res = await resetBackfill();
      if (!res.ok) toast.error(`Reset failed: ${res.error}`);
      else toast.success("Backfill state reset");
      router.refresh();
    });
  }

  function handleSaveConfig() {
    startTransition(async () => {
      const res = await setBackfillConfig({
        cutoff_date: cutoffDate ? new Date(cutoffDate).toISOString() : null,
        max_pages: maxPages,
      });
      if (!res.ok) toast.error(`Save failed: ${res.error}`);
      else {
        toast.success("Config saved");
        setShowConfig(false);
      }
      router.refresh();
    });
  }

  const buttonLabel =
    state.status === "completed" ? "Start over"
    : state.status === "paused"  ? "Resume"
    : state.status === "running" ? "Running…"
    : state.status === "failed"  ? "Retry"
    : "Start backfill";

  const canRun = state.status !== "running" && state.status !== "completed";

  return (
    <div className="bg-paper-card border border-paper-line rounded-md">
      <div className="px-4 py-3 border-b border-paper-line flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold inline-flex items-center gap-1.5">
            <History size={14} className="text-accent"/>
            Historical backfill
          </h3>
          <p className="text-xs text-ink-muted mt-0.5">
            One-time pull of older orders from Rupyz. Resumes across timeouts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canRun && state.status !== "completed" && (
            <button
              type="button"
              onClick={handleStart}
              disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-accent text-white hover:opacity-90 disabled:opacity-50"
            >
              <Play size={11}/> {buttonLabel}
            </button>
          )}
          {state.status === "completed" && (
            <button
              type="button"
              onClick={handleReset}
              disabled={pending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-paper-line text-ink-muted hover:bg-paper-subtle disabled:opacity-50"
            >
              <RotateCcw size={11}/> Reset and start over
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowConfig(!showConfig)}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-ink-muted hover:text-ink"
          >
            <Settings size={11}/>
          </button>
        </div>
      </div>

      {/* Config panel */}
      {showConfig && (
        <div className="px-4 py-3 border-b border-paper-line bg-paper-subtle/40 space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
              <label className="text-2xs uppercase tracking-wide text-ink-muted block mb-1">
                Cutoff date (stop when orders are older than this)
              </label>
              <input
                type="date"
                value={cutoffDate}
                onChange={e => setCutoffDate(e.target.value)}
                className="text-xs border border-paper-line rounded px-2 py-1 bg-paper-card focus:outline-none focus:border-accent w-full"
              />
              <p className="text-2xs text-ink-subtle mt-1">
                Leave blank to backfill ALL available history
              </p>
            </div>
            <div>
              <label className="text-2xs uppercase tracking-wide text-ink-muted block mb-1">
                Max pages (safety cap)
              </label>
              <input
                type="number"
                value={maxPages}
                onChange={e => setMaxPages(parseInt(e.target.value) || 1000)}
                className="text-xs border border-paper-line rounded px-2 py-1 bg-paper-card focus:outline-none focus:border-accent w-full tabular"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveConfig}
              disabled={pending}
              className="px-3 py-1 text-xs font-medium rounded bg-ink text-paper hover:opacity-90 disabled:opacity-50"
            >
              Save config
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={pending}
              className="px-3 py-1 text-xs font-medium rounded border border-paper-line text-danger hover:bg-danger-soft disabled:opacity-50"
            >
              Reset state
            </button>
          </div>
        </div>
      )}

      <div className="p-4 grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-2xs uppercase tracking-wide text-ink-subtle">Status</div>
          <div className="mt-1"><StatusBadge status={state.status}/></div>
        </div>
        <div>
          <div className="text-2xs uppercase tracking-wide text-ink-subtle">Last completed page</div>
          <div className="tabular font-semibold mt-0.5">{state.last_completed_page}</div>
        </div>
        <div>
          <div className="text-2xs uppercase tracking-wide text-ink-subtle">Orders processed</div>
          <div className="tabular font-semibold mt-0.5">{state.total_orders_processed}</div>
          <div className="text-2xs text-ink-subtle">
            {state.total_orders_inserted} new · {state.total_orders_updated} updated
          </div>
        </div>
        <div>
          <div className="text-2xs uppercase tracking-wide text-ink-subtle">Oldest seen</div>
          <div className="tabular text-xs mt-0.5">
            {mounted && state.last_page_oldest_at
              ? new Date(state.last_page_oldest_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
              : "—"}
          </div>
        </div>
      </div>

      {state.cutoff_date && (
        <div className="px-4 pb-3 text-xs text-ink-muted">
          Cutoff: stop at orders older than {mounted ? new Date(state.cutoff_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "…"}
        </div>
      )}

      {state.error_message && (
        <div className="px-4 pb-3">
          <div className="bg-danger-soft text-danger text-xs rounded px-3 py-2 flex items-start gap-2">
            <AlertTriangle size={12} className="shrink-0 mt-0.5"/>
            <span>{state.error_message}</span>
          </div>
        </div>
      )}

      {state.status === "paused" && (
        <div className="px-4 pb-3 text-xs text-ink-muted">
          Paused after {state.last_completed_page} pages — click Resume to continue.
        </div>
      )}

      {mounted && state.last_run_at && (
        <div className="px-4 pb-3 text-2xs text-ink-subtle tabular">
          Last run: {new Date(state.last_run_at).toLocaleString("en-IN")}
          {state.finished_at && <> · Finished: {new Date(state.finished_at).toLocaleString("en-IN")}</>}
        </div>
      )}
    </div>
  );
}
