"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Database, Eye, EyeOff, RefreshCw, CheckCircle2, AlertCircle, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getTallyAgentSecret, regenerateTallyAgentSecret } from "./actions";
import { toast } from "sonner";
import type { TallySyncLog } from "@/lib/types";

export function TallyPanel({ logs }: { logs: TallySyncLog[] }) {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [secretUpdatedAt, setSecretUpdatedAt] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    (async () => {
      const res = await getTallyAgentSecret();
      if ("secret" in res) {
        setSecret(res.secret);
        setSecretUpdatedAt(res.updated_at ?? null);
      }
    })();
  }, []);

  const lastSync = logs.find(l => l.status === "success");
  const lastFailed = logs.find(l => l.status === "failed");

  function handleRegenerate() {
    if (secret && !confirm("Regenerate the agent secret? Your existing agent will stop working until you update its config.ini with the new secret.")) {
      return;
    }
    startTransition(async () => {
      const res = await regenerateTallyAgentSecret();
      if (res.error) { toast.error(res.error); return; }
      toast.success("New secret generated. Update your agent's config.ini.");
      setSecret(res.secret ?? null);
      setSecretUpdatedAt(new Date().toISOString());
      setShowSecret(true);
      router.refresh();
    });
  }

  function handleCopy() {
    if (!secret) return;
    navigator.clipboard.writeText(secret).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Couldn't copy. Reveal and copy manually."),
    );
  }

  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-4">
      <div className="flex items-center gap-2 mb-3">
        <Database size={14} className="text-ink-muted" />
        <h3 className="font-semibold flex-1">Tally bridge</h3>
        {lastSync ? (
          <Badge variant="ok">Connected</Badge>
        ) : secret ? (
          <Badge variant="warn">Configured</Badge>
        ) : (
          <Badge variant="neutral">Not set up</Badge>
        )}
      </div>

      {!secret && (
        <div className="bg-warn-soft border border-warn/30 rounded p-3 text-xs text-warn mb-3 flex items-start gap-1.5">
          <AlertCircle size={12} className="shrink-0 mt-0.5"/>
          <div>
            <strong>Generate an agent secret to get started.</strong> The Python agent on your Tally machine uses this secret to push data into your app.
          </div>
        </div>
      )}

      {/* Last sync */}
      {lastSync && (
        <div className="bg-paper-subtle/50 border border-paper-line rounded p-2.5 text-xs mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-ink-muted">Last successful sync</span>
            <span className="text-2xs text-ink-subtle">{new Date(lastSync.started_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs">
            <span><span className="text-ink-muted">Outstanding:</span> <strong className="tabular">{lastSync.outstanding_synced}</strong></span>
            <span><span className="text-ink-muted">Matched:</span> <strong className="tabular text-ok">{lastSync.outstanding_matched}</strong></span>
            <span><span className="text-ink-muted">Unmatched:</span> <strong className="tabular text-warn">{lastSync.outstanding_unmatched}</strong></span>
          </div>
        </div>
      )}

      {/* Last failure (if more recent than last success) */}
      {lastFailed && (!lastSync || new Date(lastFailed.started_at) > new Date(lastSync.started_at)) && (
        <div className="bg-danger-soft border border-danger/30 rounded p-2.5 text-xs mb-3">
          <div className="flex items-center gap-1.5 text-danger mb-0.5">
            <AlertCircle size={11}/>
            <strong>Last sync failed</strong>
            <span className="text-2xs ml-auto text-ink-subtle">{new Date(lastFailed.started_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          {lastFailed.error_message && <div className="text-2xs text-ink-muted">{lastFailed.error_message}</div>}
        </div>
      )}

      {/* Secret */}
      <div className="mb-3">
        <label className="text-2xs uppercase tracking-wide text-ink-muted">Agent secret</label>
        <div className="flex items-center gap-1.5 mt-1">
          {secret ? (
            <>
              <code className="flex-1 font-mono text-2xs bg-paper-subtle border border-paper-line rounded px-2 py-1.5 truncate">
                {showSecret ? secret : "•".repeat(40)}
              </code>
              <button
                onClick={() => setShowSecret(!showSecret)}
                className="p-1.5 text-ink-muted hover:text-ink"
                aria-label={showSecret ? "Hide secret" : "Show secret"}
              >
                {showSecret ? <EyeOff size={12}/> : <Eye size={12}/>}
              </button>
              <button
                onClick={handleCopy}
                className="p-1.5 text-ink-muted hover:text-ink"
                aria-label="Copy secret"
              >
                <Copy size={12}/>
              </button>
            </>
          ) : (
            <span className="text-xs italic text-ink-subtle">Not generated yet</span>
          )}
          <Button size="sm" variant={secret ? "outline" : "default"} onClick={handleRegenerate} disabled={pending}>
            <RefreshCw size={11}/> {pending ? "…" : (secret ? "Regenerate" : "Generate")}
          </Button>
        </div>
        {secretUpdatedAt && (
          <p className="text-2xs text-ink-subtle mt-1">
            Generated {new Date(secretUpdatedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
          </p>
        )}
      </div>

      {/* Setup steps (collapsible) */}
      <details className="text-xs">
        <summary className="cursor-pointer text-accent hover:underline">How to set up the Tally agent</summary>
        <ol className="list-decimal list-inside space-y-1 mt-2 text-ink-muted">
          <li>On your Tally machine, ensure Tally Prime is running with HTTP server enabled (you&apos;ve already done this).</li>
          <li>Install Python 3.10+ from <a href="https://www.python.org/downloads/" target="_blank" rel="noopener" className="text-accent hover:underline">python.org</a> (one-time).</li>
          <li>Download the <code className="font-mono bg-paper-subtle px-1 rounded">tally-agent</code> folder from the project repo.</li>
          <li>Edit <code className="font-mono bg-paper-subtle px-1 rounded">config.ini</code>:
            <ul className="list-disc list-inside ml-4 mt-0.5">
              <li><code>tally_url = http://localhost:9000</code></li>
              <li><code>app_url = https://rupyz-tally-erp.vercel.app</code> (or your domain)</li>
              <li><code>agent_secret =</code> <em>(paste the secret above)</em></li>
            </ul>
          </li>
          <li>Run <code className="font-mono bg-paper-subtle px-1 rounded">pip install -r requirements.txt</code></li>
          <li>Run <code className="font-mono bg-paper-subtle px-1 rounded">python agent.py</code></li>
          <li>Visit <code className="font-mono bg-paper-subtle px-1 rounded">http://localhost:7531</code> in a browser on the Tally machine — click <strong>Sync now</strong>.</li>
          <li>Refresh this page; you should see &quot;Last successful sync&quot; appear above. <ExternalLink size={11} className="inline"/></li>
        </ol>
      </details>

      {/* Recent runs */}
      {logs.length > 0 && (
        <details className="text-xs mt-3">
          <summary className="cursor-pointer text-accent hover:underline">Recent sync runs ({logs.length})</summary>
          <div className="mt-2 max-h-60 overflow-y-auto border border-paper-line rounded">
            <table className="w-full text-2xs">
              <thead className="bg-paper-subtle text-ink-muted">
                <tr>
                  <th className="px-2 py-1 text-left">Started</th>
                  <th className="px-2 py-1 text-left">Status</th>
                  <th className="px-2 py-1 text-right">Synced</th>
                  <th className="px-2 py-1 text-right">Matched</th>
                  <th className="px-2 py-1 text-right">Unmatched</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 30).map(l => (
                  <tr key={l.id} className="border-t border-paper-line">
                    <td className="px-2 py-1 tabular">{new Date(l.started_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-2 py-1">
                      {l.status === "success" ? <Badge variant="ok">ok</Badge>
                        : l.status === "failed" ? <Badge variant="danger">failed</Badge>
                        : <Badge variant="warn">running</Badge>}
                    </td>
                    <td className="px-2 py-1 text-right tabular">{l.outstanding_synced}</td>
                    <td className="px-2 py-1 text-right tabular text-ok">{l.outstanding_matched}</td>
                    <td className="px-2 py-1 text-right tabular text-warn">{l.outstanding_unmatched}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Helper text */}
      <p className="text-2xs text-ink-subtle mt-3 flex items-center gap-1">
        <CheckCircle2 size={11}/>
        Manual sync only in chunk 1 — kick the agent from the Tally machine.
      </p>
    </div>
  );
}
