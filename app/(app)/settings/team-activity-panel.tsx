"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runTeamActivitySyncNow } from "./team-activity-action";

export function TeamActivitySyncPanel({ lastSyncAt }: { lastSyncAt: string | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; totalUpserted: number; days: number; at: number }
    | { kind: "err"; msg: string }
    | null
  >(null);

  const lastSyncLabel = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "never";
  const minsAgo = lastSyncAt
    ? Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / 60000)
    : null;
  const healthClass =
    minsAgo == null ? "text-ink-subtle"
      : minsAgo > 45 ? "text-danger"
        : minsAgo > 20 ? "text-warn"
          : "text-ok";

  async function run() {
    setBusy(true);
    setResult(null);
    const res = await runTeamActivitySyncNow();
    setBusy(false);
    if (res.ok) {
      setResult({ kind: "ok", totalUpserted: res.totalUpserted, days: res.days, at: Date.now() });
      startTransition(() => router.refresh());
    } else {
      setResult({ kind: "err", msg: res.error });
    }
  }

  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold text-sm">Team-activity sync</div>
          <div className="text-2xs text-ink-muted">
            Pulls Rupyz MIS data (SC / TC / PC / NC per salesman) every 15 minutes.
          </div>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="h-9 px-4 rounded bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
        >
          {busy ? "Running…" : "Run sync now"}
        </button>
      </div>

      <div className="text-sm">
        <span className="text-ink-muted">Last run:</span>{" "}
        <span className={`font-medium tabular ${healthClass}`}>
          {lastSyncLabel}
          {minsAgo != null && ` (${minsAgo} min ago)`}
        </span>
      </div>

      {result?.kind === "ok" && (
        <div className="text-sm text-ok bg-ok-soft/30 border border-ok/30 rounded px-3 py-2">
          ✓ Synced {result.days} day{result.days === 1 ? "" : "s"} · {result.totalUpserted} row{result.totalUpserted === 1 ? "" : "s"} upserted
        </div>
      )}
      {result?.kind === "err" && (
        <div className="text-sm text-danger bg-danger-soft/30 border border-danger/30 rounded px-3 py-2">
          ✗ {result.msg}
        </div>
      )}
    </div>
  );
}
