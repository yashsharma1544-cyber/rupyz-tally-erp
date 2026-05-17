"use client";

import { useState, useRef, useEffect } from "react";
import {
  Wrench, Loader2, Check, AlertCircle, ChevronDown, X,
} from "lucide-react";
import {
  testCoordinatorReminder,
  testAllAdminSummaries,
  type TestResult,
} from "./test-actions";

type Resolved = { label: string; ok: boolean; message: string } | null;

/**
 * Dropdown menu in the Sales Monitor header for admin-side cron tests.
 * Sends real WhatsApp messages — labeled clearly in the UI.
 */
export function AdminTestMenu() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Resolved>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Outside-click to close
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Auto-dismiss the result toast after 12s
  useEffect(() => {
    if (!resolved) return;
    const t = setTimeout(() => setResolved(null), 12000);
    return () => clearTimeout(t);
  }, [resolved]);

  async function run(
    key: string,
    label: string,
    fn: () => Promise<TestResult>,
    confirmText?: string,
  ) {
    if (confirmText && !confirm(confirmText)) return;
    setOpen(false);
    setRunning(key);
    setResolved(null);
    try {
      const res = await fn();
      setResolved({
        label,
        ok: res.ok,
        message: res.summary || res.error || (res.ok ? "Done." : "Failed."),
      });
    } catch (e) {
      setResolved({
        label,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={running !== null}
        className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-paper-line rounded hover:bg-paper-subtle disabled:opacity-50 transition-colors"
        title="Admin test triggers"
      >
        {running !== null ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Wrench size={14} />
        )}
        Test
        <ChevronDown size={11} className="text-ink-subtle" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-80 z-20 bg-paper-card border border-paper-line rounded-md shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-paper-line bg-paper-subtle/50">
            <p className="text-2xs uppercase tracking-wide text-ink-muted font-medium">
              Admin tests
            </p>
            <p className="text-2xs text-ink-subtle mt-0.5 leading-snug">
              Sends real WhatsApp messages. Use sparingly.
            </p>
          </div>
          <button
            onClick={() =>
              run("coordinator", "Coordinator reminder", testCoordinatorReminder)
            }
            className="w-full text-left px-3 py-2.5 text-xs hover:bg-paper-subtle border-b border-paper-line/60 transition-colors"
          >
            <div className="font-medium">Send coordinator reminder</div>
            <div className="text-2xs text-ink-subtle mt-0.5">
              1 message → beat coordinator (Radhe)
            </div>
          </button>
          <button
            onClick={() =>
              run(
                "all-summaries",
                "All admin summaries",
                testAllAdminSummaries,
                "This sends 3 daily-summary messages (morning + mid-day + evening) to every admin right now. With 2 admins that's 6 WhatsApp messages. Proceed?",
              )
            }
            className="w-full text-left px-3 py-2.5 text-xs hover:bg-paper-subtle transition-colors"
          >
            <div className="font-medium">Send all admin summaries</div>
            <div className="text-2xs text-ink-subtle mt-0.5">
              3 PDFs (morning + mid-day + evening) → each admin
            </div>
          </button>
        </div>
      )}

      {resolved && (
        <div
          className={`absolute right-0 mt-1 w-96 z-30 rounded-md p-3 border shadow-lg ${
            resolved.ok
              ? "bg-accent/5 border-accent/40"
              : "bg-danger/5 border-danger/40"
          }`}
        >
          <div className="flex items-start gap-2">
            {resolved.ok ? (
              <Check size={14} className="text-accent shrink-0 mt-0.5" />
            ) : (
              <AlertCircle size={14} className="text-danger shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold">{resolved.label}</div>
              <pre className="text-2xs text-ink-muted mt-1 whitespace-pre-wrap break-words font-sans">
                {resolved.message}
              </pre>
            </div>
            <button
              onClick={() => setResolved(null)}
              className="text-ink-subtle hover:text-ink shrink-0 -mr-1 -mt-1 p-1"
              title="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
