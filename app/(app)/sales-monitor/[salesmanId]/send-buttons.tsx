"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, Check, X, AlertCircle, FlaskConical } from "lucide-react";
import { sendReportNow, type SendActionResult } from "./send-actions";
import type { PdfReportType } from "@/lib/sales-monitor/pdf/render";

type Props = {
  salesmanId: string;
  date: string;
};

type Mode = "default" | "admin_only";

const REPORTS: { type: PdfReportType; label: string; defaultNote: string }[] = [
  { type: "morning", label: "Morning briefing", defaultNote: "→ salesman only" },
  { type: "midday",  label: "Mid-day report",   defaultNote: "→ salesman + admins" },
  { type: "evening", label: "Evening report",   defaultNote: "→ salesman + admins" },
];

export function SendButtons({ salesmanId, date }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, SendActionResult | null>>({});

  async function handleSend(type: PdfReportType, mode: Mode) {
    const confirmMsg =
      mode === "admin_only"
        ? `Test send the ${type} report to admin only? (Salesman won't receive anything.)`
        : type === "morning"
          ? `Send morning briefing on WhatsApp now? (Goes to the salesman only.)`
          : `Send ${type} report on WhatsApp now? (Goes to salesman + all active admins with phone numbers.)`;
    if (!confirm(confirmMsg)) return;

    const key = `${type}:${mode}`;
    setBusy((p) => ({ ...p, [key]: true }));
    setResults((p) => ({ ...p, [type]: null }));
    try {
      const res = await sendReportNow(salesmanId, date, type, mode);
      setResults((p) => ({ ...p, [type]: res }));
      startTransition(() => router.refresh());
    } catch (e) {
      setResults((p) => ({
        ...p,
        [type]: { ok: false, error: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setBusy((p) => ({ ...p, [key]: false }));
    }
  }

  return (
    <div className="mb-5 border border-paper-line rounded bg-paper-card overflow-hidden">
      <div className="px-3 py-2 border-b border-paper-line bg-paper-subtle/40 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-ink-muted">Send WhatsApp</div>
        <div className="text-2xs text-ink-subtle">
          PDFs uploaded to Storage, sent via WATi
        </div>
      </div>
      <div className="divide-y divide-paper-line">
        {REPORTS.map(({ type, label, defaultNote }) => {
          const res = results[type];
          const defaultBusy = busy[`${type}:default`];
          const adminBusy = busy[`${type}:admin_only`];
          return (
            <div key={type} className="px-3 py-2.5 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">
                  {label}{" "}
                  <span className="text-2xs text-ink-subtle font-normal">· {defaultNote}</span>
                </div>
                {res && <ResultLine result={res} />}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => handleSend(type, "admin_only")}
                  disabled={adminBusy || defaultBusy}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-paper-line rounded hover:bg-paper-subtle disabled:opacity-50 transition-colors whitespace-nowrap"
                  title="Test send — admin only, salesman skipped"
                >
                  {adminBusy ? (
                    <>
                      <Loader2 size={12} className="animate-spin" /> Testing…
                    </>
                  ) : (
                    <>
                      <FlaskConical size={12} className="text-ink-subtle" /> Test → admin
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleSend(type, "default")}
                  disabled={adminBusy || defaultBusy}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {defaultBusy ? (
                    <>
                      <Loader2 size={12} className="animate-spin" /> Sending…
                    </>
                  ) : (
                    <>
                      <Send size={12} /> Send now
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultLine({ result }: { result: SendActionResult }) {
  if (!result.recipients || result.recipients.length === 0) {
    return (
      <div className="text-2xs text-danger mt-1 inline-flex items-start gap-1">
        <AlertCircle size={11} className="shrink-0 mt-0.5" />
        <span>{result.error || "Send failed"}</span>
      </div>
    );
  }
  return (
    <div className="text-2xs text-ink-subtle mt-1 space-y-0.5">
      {result.mode === "admin_only" && (
        <div className="text-2xs text-amber-600 font-medium mb-0.5">Test send</div>
      )}
      {result.recipients.map((r, i) => (
        <div key={i} className="inline-flex items-center gap-1 mr-2">
          {r.ok ? (
            <Check size={11} className="text-accent" />
          ) : (
            <X size={11} className="text-danger" />
          )}
          <span className={r.ok ? "" : "text-danger"}>
            {r.role}: {r.name}
            {!r.ok && r.error ? ` — ${r.error}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
