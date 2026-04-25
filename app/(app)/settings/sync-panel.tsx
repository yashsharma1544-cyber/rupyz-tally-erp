"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { triggerSync } from "./actions";
import type { RupyzSyncLog } from "@/lib/types";
import { toast } from "sonner";

type SessionInfo = { org_id: number; username: string; expires_at: string; last_refreshed_at: string } | null;

export function SyncPanel({ session, logs }: { session: SessionInfo; logs: RupyzSyncLog[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showRaw, setShowRaw] = useState<string | null>(null);

  function handleSync() {
    startTransition(async () => {
      const res = await triggerSync();
      if (res.error) toast.error(`Sync failed: ${res.error}`);
      else toast.success(`Sync complete: ${res.summary}`);
      router.refresh();
    });
  }

  const expiringSoon = session && new Date(session.expires_at).getTime() - Date.now() < 7 * 86400 * 1000;

  return (
    <div className="bg-paper-card border border-paper-line rounded-md">
      <div className="px-4 py-3 border-b border-paper-line flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Rupyz sync</h3>
          <p className="text-xs text-ink-muted mt-0.5">Pulls orders from app.rupyz.com every 15 minutes</p>
        </div>
        <Button onClick={handleSync} disabled={pending || !session}>
          <RefreshCw size={13} className={pending ? "animate-spin" : ""} />
          {pending ? "Syncing…" : "Run sync now"}
        </Button>
      </div>

      <div className="p-4 grid grid-cols-3 gap-3 text-sm">
        {!session ? (
          <div className="col-span-3 bg-warn-soft text-warn px-3 py-2 rounded text-xs flex items-center gap-2">
            <AlertTriangle size={14} />
            <span>No session — run <code className="font-mono bg-paper-card/60 px-1">sql/05_seed_rupyz_session.sql</code> in Supabase first.</span>
          </div>
        ) : (
          <>
            <div>
              <div className="text-2xs uppercase tracking-wide text-ink-subtle">Org</div>
              <div className="tabular mt-0.5">{session.org_id}</div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-wide text-ink-subtle">Logged in as</div>
              <div className="tabular text-xs mt-0.5">{session.username}</div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-wide text-ink-subtle">Token expires</div>
              <div className={`tabular text-xs mt-0.5 ${expiringSoon ? "text-warn" : ""}`}>
                {new Date(session.expires_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                {expiringSoon && " ⚠"}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Log table */}
      <div className="border-t border-paper-line">
        <div className="px-4 py-2 border-b border-paper-line bg-paper-subtle/40">
          <h4 className="text-2xs uppercase tracking-wide text-ink-muted font-medium">Recent syncs</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-2xs uppercase tracking-wide text-ink-subtle">
              <tr className="text-left">
                <th className="px-4 py-1.5 font-medium">Started</th>
                <th className="px-3 py-1.5 font-medium">Status</th>
                <th className="px-3 py-1.5 font-medium text-right">Pages</th>
                <th className="px-3 py-1.5 font-medium text-right">Inserted</th>
                <th className="px-3 py-1.5 font-medium text-right">Updated</th>
                <th className="px-3 py-1.5 font-medium text-right">Skipped</th>
                <th className="px-3 py-1.5 font-medium">Trigger</th>
                <th className="px-3 py-1.5 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {logs.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-ink-muted">No sync history yet.</td></tr>
              ) : logs.map((l) => (
                <tr key={l.id} className="hover:bg-paper-subtle/40">
                  <td className="px-4 py-1.5 tabular text-ink-muted">{new Date(l.started_at).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-1.5">
                    {l.status === "success" && <span className="inline-flex items-center gap-1 text-ok"><CheckCircle2 size={11}/> success</span>}
                    {l.status === "running" && <span className="inline-flex items-center gap-1 text-ink-muted"><Clock size={11}/> running</span>}
                    {l.status === "failed"  && <span className="inline-flex items-center gap-1 text-danger"><XCircle size={11}/> failed</span>}
                    {l.status === "partial" && <span className="inline-flex items-center gap-1 text-warn"><AlertTriangle size={11}/> partial</span>}
                  </td>
                  <td className="px-3 py-1.5 tabular text-right">{l.pages_fetched}</td>
                  <td className="px-3 py-1.5 tabular text-right">{l.orders_inserted > 0 ? <strong>{l.orders_inserted}</strong> : 0}</td>
                  <td className="px-3 py-1.5 tabular text-right">{l.orders_updated}</td>
                  <td className="px-3 py-1.5 tabular text-right text-ink-muted">{l.orders_skipped}</td>
                  <td className="px-3 py-1.5 text-ink-muted">{l.trigger ?? "—"}</td>
                  <td className="px-3 py-1.5 text-ink-muted text-2xs">
                    {l.token_refreshed && <Badge variant="accent" className="mr-1">refreshed</Badge>}
                    {l.error_message ? (
                      <button onClick={() => setShowRaw(showRaw === l.id ? null : l.id)} className="text-danger hover:underline truncate max-w-[200px] inline-block align-middle">
                        {showRaw === l.id ? l.error_message : l.error_message.slice(0, 40) + (l.error_message.length > 40 ? "…" : "")}
                      </button>
                    ) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
