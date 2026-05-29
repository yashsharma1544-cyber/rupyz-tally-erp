"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { runTeamActivitySyncNow } from "@/app/(app)/settings/team-activity-action";

export function LastUpdated({ lastSyncAt }: { lastSyncAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function refresh() {
    setBusy(true);
    setFlash(null);
    const res = await runTeamActivitySyncNow();
    setBusy(false);
    if (res.ok) {
      setFlash({ kind: "ok", msg: `Synced (${res.totalUpserted} rows)` });
      startTransition(() => router.refresh());
      setTimeout(() => setFlash(null), 3000);
    } else {
      setFlash({ kind: "err", msg: res.error });
      setTimeout(() => setFlash(null), 5000);
    }
  }

  const date = lastSyncAt ? new Date(lastSyncAt) : null;
  const minsAgo = date ? Math.floor((Date.now() - date.getTime()) / 60000) : null;
  const colour =
    minsAgo == null ? "text-ink-subtle"
      : minsAgo > 45 ? "text-danger"
        : minsAgo > 20 ? "text-warn"
          : "text-ok";
  const dotBg =
    minsAgo == null ? "bg-ink-subtle"
      : minsAgo > 45 ? "bg-danger"
        : minsAgo > 20 ? "bg-warn"
          : "bg-ok";
  const fullStamp = date
    ? date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "never";
  const relative =
    minsAgo == null ? "never"
      : minsAgo < 1 ? "just now"
        : minsAgo < 60 ? `${minsAgo} min ago`
          : minsAgo < 60 * 24 ? `${Math.floor(minsAgo / 60)} h ago`
            : `${Math.floor(minsAgo / (60 * 24))} d ago`;

  return (
    <span className="ml-auto inline-flex items-center gap-2 text-2xs text-ink-subtle">
      <span title={`Synced ${fullStamp}`} className="inline-flex items-center">
        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${dotBg}`}></span>
        Last updated <span className={`${colour} font-medium ml-1`}>{relative}</span>
      </span>
      <button
        onClick={refresh}
        disabled={busy}
        title="Pull the latest team activity from Rupyz"
        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-paper-line bg-paper-card text-ink-muted hover:text-accent hover:bg-paper-subtle disabled:opacity-50"
      >
        <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
        {busy ? "Syncing…" : "Refresh"}
      </button>
      {flash && (
        <span className={flash.kind === "ok" ? "text-ok" : "text-danger"}>{flash.msg}</span>
      )}
    </span>
  );
}
