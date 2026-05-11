"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, FileUp, Download, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { importTallyExcel, type ImportResult } from "./actions";

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "₹0";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DataImportClient() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string>("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      toast.error("Please choose an Excel file");
      return;
    }
    setResult(null);
    startTransition(async () => {
      const res = await importTallyExcel(fd);
      setResult(res);
      if (!res.ok) toast.error(res.error ?? "Import failed");
      else toast.success(`Parsed ${res.stats?.vouchersParsed ?? 0} vouchers`);
    });
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <Link href="/dashboard" className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3">
          <ArrowLeft size={11}/> Dashboard
        </Link>

        <h1 className="text-xl font-semibold leading-tight mb-1 inline-flex items-center gap-2">
          <FileUp size={18} className="text-accent"/> Tally backfill
        </h1>
        <p className="text-sm text-ink-muted mb-5">
          Upload a Tally Day Book Excel export for one company &amp; voucher type.
          The server parses, matches parties &amp; items, then returns a SQL file
          you review and run in Supabase.
        </p>

        {/* Instructions */}
        <div className="bg-paper-card border border-paper-line rounded-md p-4 mb-5 text-sm">
          <h2 className="font-semibold mb-2">How it works</h2>
          <ol className="list-decimal pl-5 space-y-1 text-ink-muted">
            <li>Export Day Book from Tally Prime for one (company, voucher type).</li>
            <li>Upload the .xlsx file below, tag it with the company &amp; voucher type.</li>
            <li>Review the customer/product matches and download the SQL.</li>
            <li>Open the SQL in Supabase SQL editor → review → Run.</li>
            <li>Repeat for each voucher type per company.</li>
          </ol>
          <p className="text-2xs text-ink-subtle mt-2">
            File size limit: ~4 MB. If your Tally export is larger, split by date range.
          </p>
        </div>

        {/* Upload form */}
        <form onSubmit={handleSubmit} className="bg-paper-card border border-paper-line rounded-md p-4 mb-5 space-y-4">
          <div>
            <Label className="text-xs">Company *</Label>
            <Input
              name="company"
              required
              placeholder="e.g. Anjali Agency"
              disabled={pending}
              className="mt-1"
            />
            <p className="text-2xs text-ink-muted mt-1">
              Free text — just to label the import in the SQL audit comment.
            </p>
          </div>
          <div>
            <Label className="text-xs">Voucher type *</Label>
            <Input
              name="voucher_type"
              required
              placeholder="e.g. GST INTERCITY SALES"
              disabled={pending}
              className="mt-1"
            />
            <p className="text-2xs text-ink-muted mt-1">
              Whatever Tally calls this voucher type.
            </p>
          </div>
          <div>
            <Label className="text-xs">Tally Day Book Excel *</Label>
            <input
              type="file"
              name="file"
              accept=".xlsx,.xls"
              required
              disabled={pending}
              onChange={e => setFileName(e.target.files?.[0]?.name ?? "")}
              className="block w-full mt-1 text-sm text-ink-muted file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:text-xs file:font-medium file:bg-accent file:text-white file:cursor-pointer file:hover:bg-accent/90"
            />
            {fileName && (
              <p className="text-2xs text-ink-muted mt-1">Selected: <span className="font-mono">{fileName}</span></p>
            )}
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Parsing…" : "Upload &amp; parse"}
            </Button>
          </div>
        </form>

        {/* Result */}
        {result && !result.ok && (
          <div className="bg-danger-soft border border-danger/30 rounded-md p-4 flex items-start gap-2">
            <AlertCircle size={16} className="text-danger shrink-0 mt-0.5"/>
            <div>
              <p className="font-semibold text-sm text-danger">Import failed</p>
              <p className="text-sm text-ink-muted mt-0.5">{result.error}</p>
            </div>
          </div>
        )}

        {result && result.ok && result.stats && (
          <div className="space-y-4">
            <div className="bg-ok-soft border border-ok/30 rounded-md p-4">
              <div className="flex items-baseline gap-2 mb-2">
                <CheckCircle2 size={16} className="text-ok"/>
                <h2 className="font-semibold text-sm">Parsed successfully</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                <Stat label="Vouchers parsed"   value={result.stats.vouchersParsed.toLocaleString("en-IN")} />
                <Stat label="Line items"        value={result.stats.itemsParsed.toLocaleString("en-IN")} />
                <Stat label="Total amount"      value={formatINR(result.stats.totalAmount)} />
                <Stat label="Date range"        value={`${result.stats.earliestDate} → ${result.stats.latestDate}`} />
                <Stat label="Skipped non-product rows" value={result.stats.skippedNonProduct.toLocaleString("en-IN")} />
              </div>
            </div>

            {/* Customer matching */}
            <div className="bg-paper-card border border-paper-line rounded-md p-4">
              <h3 className="font-semibold text-sm mb-2">Customer matching</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Stat label="Unique parties"      value={result.stats.uniqueParties} />
                <Stat label="Auto-matched (≥95%)" value={result.stats.partiesAutoMatched} highlight="ok"/>
                <Stat label="Review (80-95%)"     value={result.stats.partiesReview} highlight={result.stats.partiesReview > 0 ? "warn" : undefined}/>
                <Stat label="New historical"      value={result.stats.partiesNewHistorical} highlight="accent"/>
              </div>
              <p className="text-2xs text-ink-muted mt-2">
                &quot;Review&quot; rows have 80-95% similarity — open the CSV and confirm
                they aren&apos;t wrong matches.
              </p>
            </div>

            {/* Product matching */}
            <div className="bg-paper-card border border-paper-line rounded-md p-4">
              <h3 className="font-semibold text-sm mb-2">Product matching</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Stat label="Unique items"       value={result.stats.uniqueProducts} />
                <Stat label="Matched"            value={result.stats.productsMatched} highlight="ok"/>
                <Stat label="Unmatched"          value={result.stats.productsUnmatched} highlight={result.stats.productsUnmatched > 0 ? "warn" : undefined}/>
                <Stat label="Lines without kg"   value={result.stats.unmatchedItemLines} />
              </div>
              <p className="text-2xs text-ink-muted mt-2">
                Unmatched items will be imported but kg will be NULL on those lines (they won&apos;t count toward kg analytics).
              </p>
            </div>

            {/* SQL planned */}
            <div className="bg-paper-card border border-paper-line rounded-md p-4">
              <h3 className="font-semibold text-sm mb-2">SQL planned</h3>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Stat label="Orders to insert"   value={result.stats.plannedOrders.toLocaleString("en-IN")} />
                <Stat label="Items to insert"    value={result.stats.plannedItems.toLocaleString("en-IN")} />
                <Stat label="New customers"      value={result.stats.plannedNewCustomers} />
              </div>
            </div>

            {/* Downloads */}
            <div className="bg-accent-soft border border-accent/30 rounded-md p-4">
              <h3 className="font-semibold text-sm mb-3">Download files</h3>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => downloadBlob(result.summaryTxt ?? "", "import_summary.txt", "text/plain")}
                >
                  <Download size={13}/> Summary (.txt)
                </Button>
                <Button
                  variant="outline"
                  onClick={() => downloadBlob(result.customersCsv ?? "", "customer_matches.csv", "text/csv")}
                >
                  <Download size={13}/> Customer matches (.csv)
                </Button>
                <Button
                  variant="outline"
                  onClick={() => downloadBlob(result.productsCsv ?? "", "product_matches.csv", "text/csv")}
                >
                  <Download size={13}/> Product matches (.csv)
                </Button>
                <Button
                  onClick={() => downloadBlob(result.sql ?? "", "tally_backfill.sql", "text/plain")}
                >
                  <Download size={13}/> SQL to run (.sql)
                </Button>
              </div>
              <p className="text-2xs text-ink-muted mt-3">
                Recommended order: 1) review summary, 2) skim customer + product CSVs, 3) open SQL in Supabase SQL editor and Run.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label, value, highlight,
}: {
  label: string;
  value: string | number;
  highlight?: "ok" | "warn" | "accent";
}) {
  const color = highlight === "ok" ? "text-ok"
    : highlight === "warn" ? "text-warn"
    : highlight === "accent" ? "text-accent"
    : "text-ink";
  return (
    <div>
      <div className="text-2xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`font-bold tabular truncate ${color}`}>{value}</div>
    </div>
  );
}
