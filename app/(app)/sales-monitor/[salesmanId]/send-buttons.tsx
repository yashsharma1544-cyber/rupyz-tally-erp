"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, Check, X, AlertCircle } from "lucide-react";
import { sendReportNow, type SendActionResult } from "./send-actions";
import type { PdfReportType } from "@/lib/sales-monitor/pdf/render";

type Props = {
  salesmanId: string;
  date: string;
};

const REPORTS: { type: PdfReportType; label: string }[] = [
  { type: "morning", label: "Morning briefing" },
  { type: "midday",  label: "Mid-day report" },
  { type: "evening", label: "Evening report" },
];

export function SendButtons({ salesmanId, date }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, SendActionResult | null>>({});

  async function handleSend(type: PdfReportType) {
    const confirmMsg =
      type === "morning"
        ? `Send morning briefing on WhatsApp now? (Goes to the salesman only.)`
        : `Send ${type} report on WhatsApp now? (Goes to salesman + all active admins with phone numbers.)`;
    if (!confirm(confirmMsg)) return;

    setBusy((p) => ({ ...p, [type]: true }));
    setResults((p) => ({ ...p, [type]: null }));
    try {
      const res = await sendReportNow(salesmanId, date, type);
      setResults((p) => ({ ...p, [type]: res }));
      startTransition(() => router.refresh());
    } catch (e) {
      setResults((p) => ({
        ...p,
        [type]: { ok: false, error: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setBusy((p) => ({ ...p, [type]: false }));
    }
  }

  return (
    <div className="mb-5 border border-paper-line rounded bg-paper-card overflow-hidden">
      <div className="px-3 py-2 border-b border-paper-line bg-paper-subtle/40 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-ink-muted">Send WhatsApp now</div>
        <div className="text-2xs text-ink-subtle">
          PDFs uploaded to Storage, sent via WATi
        </div>
      </div>
      <div className="divide-y divide-paper-line">
        {REPORTS.map(({ type, label }) => {
          const res = results[type];
          const isBusy = busy[type];
          return (
            <div key={type} className="px-3 py-2.5 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{label}</div>
                {res && <ResultLine result={res} />}
              </div>
              <button
                onClick={() => handleSend(type)}
                disabled={isBusy}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {isBusy ? (
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
          );
        })}
      </div>
    </div>
  );
}

function ResultLine({ result }: { result: SendActionResult }) {
  if (!result.ok) {
    return (
      <div className="text-2xs text-danger mt-1 inline-flex items-start gap-1">
        <AlertCircle size={11} className="shrink-0 mt-0.5" />
        <span>{result.error}</span>
      </div>
    );
  }
  return (
    <div className="text-2xs text-ink-subtle mt-1 space-y-0.5">
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
