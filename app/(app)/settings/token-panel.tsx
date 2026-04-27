"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Key, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { updateRupyzToken } from "./actions";
import { toast } from "sonner";

type SessionInfo = { org_id: number; username: string; expires_at: string; last_refreshed_at: string } | null;

export function TokenPanel({ session }: { session: SessionInfo }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [pending, startTransition] = useTransition();
  const [showHelp, setShowHelp] = useState(false);

  // Token health
  const expiresAt = session ? new Date(session.expires_at).getTime() : 0;
  const now = Date.now();
  const minsLeft = Math.floor((expiresAt - now) / 60000);
  const expired = minsLeft <= 0;
  const expiringSoon = !expired && minsLeft < 60;

  function handleUpdate() {
    if (!token.trim()) { toast.error("Paste a token first"); return; }
    startTransition(async () => {
      const res = await updateRupyzToken(token);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Token updated — Rupyz sync should work again");
        setToken("");
        router.refresh();
      }
    });
  }

  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-4">
      <div className="flex items-center gap-2 mb-3">
        <Key size={14} className="text-ink-muted" />
        <h3 className="font-semibold flex-1">Rupyz token</h3>
        {expired ? (
          <Badge variant="danger">Expired</Badge>
        ) : expiringSoon ? (
          <Badge variant="warn">Expires soon</Badge>
        ) : session ? (
          <Badge variant="ok">Active</Badge>
        ) : null}
      </div>

      {session && (
        <div className="text-xs text-ink-muted mb-3">
          {expired ? (
            <span className="text-danger font-medium">
              Token expired {Math.abs(minsLeft)} min ago. Sync will fail until you update it below.
            </span>
          ) : (
            <>
              Last updated {new Date(session.last_refreshed_at).toLocaleString("en-IN", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
              })}
              {" · "}
              expires in {minsLeft >= 60 ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m` : `${minsLeft}m`}
            </>
          )}
        </div>
      )}

      {/* How-to (collapsible) */}
      <button
        onClick={() => setShowHelp(!showHelp)}
        className="text-xs text-accent inline-flex items-center gap-1 mb-2 hover:underline"
      >
        How do I get a token?
        {showHelp ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
      </button>

      {showHelp && (
        <div className="bg-paper-subtle/60 border border-paper-line rounded p-3 text-xs space-y-1.5 mb-3 text-ink">
          <ol className="list-decimal list-inside space-y-1">
            <li>Open <a href="https://app.rupyz.com" target="_blank" rel="noopener" className="text-accent hover:underline">app.rupyz.com</a> in a new tab and log in.</li>
            <li>Press <kbd className="font-mono bg-paper-card px-1 border border-paper-line rounded">F12</kbd> to open DevTools.</li>
            <li>Click the <strong>Application</strong> tab at the top of DevTools (you may need to expand the &raquo; menu).</li>
            <li>In the left sidebar, expand <strong>Local Storage</strong> &rarr; click <strong>https://app.rupyz.com</strong>.</li>
            <li>Find the row whose key looks like <code className="font-mono bg-paper-card px-1 border border-paper-line rounded">authToken</code> or <code className="font-mono bg-paper-card px-1 border border-paper-line rounded">accessToken</code>.</li>
            <li>Double-click the value (a long string starting with <code className="font-mono">eyJ...</code>) and copy it.</li>
            <li>Paste it into the box below and click Update.</li>
          </ol>
          <div className="border-t border-paper-line pt-2 mt-2 text-ink-muted">
            <strong className="text-ink">Trouble finding it?</strong> Try the <strong>Network</strong> tab instead: click any request to <code className="font-mono">rupyz.com</code>, look at <strong>Headers</strong>, and copy the value after <code className="font-mono">Authorization: Bearer</code>.
          </div>
        </div>
      )}

      <Textarea
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Paste the access token here (starts with eyJ...)"
        rows={4}
        className="font-mono text-2xs"
      />

      <div className="flex items-center justify-between mt-2 gap-2">
        <span className="text-2xs text-ink-subtle">
          {token.length > 0 && `${token.length} chars`}
        </span>
        <Button onClick={handleUpdate} disabled={pending || !token.trim()}>
          <CheckCircle2 size={11}/> {pending ? "Validating…" : "Update token"}
        </Button>
      </div>

      {expired && (
        <div className="mt-3 bg-warn-soft border border-warn/30 rounded p-2.5 text-xs flex items-start gap-1.5 text-warn">
          <AlertTriangle size={12} className="shrink-0 mt-0.5"/>
          <span>
            Until you update the token, automatic sync will fail every 15 minutes. Take 30 seconds to refresh it now.
          </span>
        </div>
      )}
    </div>
  );
}
