"use client";

import { useState, useTransition } from "react";
import { Upload, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { importOutstandingCSV, clearAllOutstanding } from "./outstanding-actions";

export function OutstandingPanel({ totalRows, totalAmount }: { totalRows: number; totalAmount: number }) {
  const [csv, setCsv] = useState("");
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<string | null>(null);

  function handleImport() {
    if (!csv.trim()) { toast.error("Paste CSV content first"); return; }
    startTransition(async () => {
      const res = await importOutstandingCSV(csv);
      if (res.error) toast.error(res.error);
      else {
        const s = res.stats;
        if (!s) return;
        toast.success(`${s.matched} customers updated`);
        setLastResult(
          `Imported ${s.rowsParsed} rows · matched ${s.matched} · unmatched ${s.unmatched}` +
          (s.unmatchedSamples.length ? ` (e.g. ${s.unmatchedSamples.slice(0, 3).join(", ")})` : "")
        );
        setCsv("");
      }
    });
  }

  function handleClear() {
    if (!confirm("Clear all customer outstanding amounts? This can't be undone.")) return;
    startTransition(async () => {
      const res = await clearAllOutstanding();
      if (res.error) toast.error(res.error);
      else { toast.success("Cleared all outstanding"); setLastResult(null); }
    });
  }

  return (
    <div className="bg-paper-card border border-paper-line rounded-md p-4">
      <h3 className="font-semibold">Customer outstanding (Tally CSV import)</h3>
      <p className="text-sm text-ink-muted mt-1 mb-3">
        Used by VAN mobile app to show "old outstanding" per customer until Phase 5 Tally bridge is live.
        Re-import any time to refresh — replaces existing values.
      </p>

      <div className="bg-paper-subtle/40 border border-paper-line rounded p-2.5 mb-3 text-xs">
        <div className="flex justify-between"><span>Customers with outstanding</span><span className="tabular font-medium">{totalRows.toLocaleString("en-IN")}</span></div>
        <div className="flex justify-between"><span>Total outstanding</span><span className="tabular font-medium">₹{totalAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span></div>
      </div>

      <Label className="block mb-1.5">Paste CSV (mobile,amount or rupyz_code,amount)</Label>
      <Textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={`mobile,amount\n9028901902,2300\n918788613149,5600\n...`}
        rows={6}
        className="font-mono text-xs mb-3"
      />

      <div className="flex gap-2">
        <Button onClick={handleImport} disabled={pending || !csv.trim()}>
          <Upload size={11}/> {pending ? "Importing…" : "Import"}
        </Button>
        {totalRows > 0 && (
          <Button variant="outline" onClick={handleClear} disabled={pending}>
            <Trash2 size={11}/> Clear all
          </Button>
        )}
      </div>

      {lastResult && (
        <div className="mt-3 text-xs text-ink-muted bg-paper-subtle/60 rounded p-2 flex items-start gap-1.5">
          <AlertCircle size={11} className="shrink-0 mt-0.5"/> {lastResult}
        </div>
      )}
    </div>
  );
}
