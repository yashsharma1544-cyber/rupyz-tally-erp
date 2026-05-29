"use client";

import { useState } from "react";
import { Download } from "lucide-react";

export type ReportChild = {
  name: string;
  target: number;
  ach: number;
  avg: number;
  extra?: string;
};

export type DownloadPdfProps = {
  scope: "area" | "beat" | "customer";
  scopeName: string;
  parentChain?: string[];
  periodLabel: string;
  totals: { target: number; achievement: number; avg: number };
  children?: ReportChild[];
  filenameSlug: string;
};

function fmtKg(n: number): string {
  return (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}
function pctOf(a: number, t: number): number | null {
  return t > 0 ? (a / t) * 100 : null;
}

export function DownloadPdfButton(props: DownloadPdfProps) {
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const [jsPDFModule, autoTableModule] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { jsPDF } = jsPDFModule as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const autoTable = (autoTableModule as any).default ?? (autoTableModule as any);

      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();

      // Theme
      const ACCENT: [number, number, number] = [15, 76, 67];
      const HEAD_BG: [number, number, number] = [241, 245, 243];
      const HEAD_TX: [number, number, number] = [40, 70, 60];
      const BODY_TX: [number, number, number] = [40, 40, 40];
      const ALT_BG: [number, number, number] = [251, 251, 248];
      const MUTED: [number, number, number] = [120, 120, 120];

      const scopeLabel = props.scope[0].toUpperCase() + props.scope.slice(1);
      const pctStr = pctOf(props.totals.achievement, props.totals.target)?.toFixed(1) ?? "—";
      const stamp = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
      const parents = props.parentChain ?? [];

      // Brand accent bar
      doc.setFillColor(...ACCENT);
      doc.rect(0, 0, pageW, 8, "F");

      // Hero header
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(25, 25, 25);
      doc.text("Sushil Agencies", pageW / 2, 52, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(...MUTED);
      doc.text("Sales Report", pageW / 2, 70, { align: "center" });

      // Scope pill
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      const pillText = `${scopeLabel}: ${props.scopeName}`;
      const pillW = doc.getTextWidth(pillText) + 28;
      const pillX = (pageW - pillW) / 2;
      doc.setFillColor(...HEAD_BG);
      doc.roundedRect(pillX, 84, pillW, 22, 11, 11, "F");
      doc.setTextColor(...HEAD_TX);
      doc.text(pillText, pageW / 2, 99, { align: "center" });

      let lineY = 122;
      if (parents.length > 0) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...MUTED);
        doc.text(`In ${parents.join(" / ")}`, pageW / 2, lineY, { align: "center" });
        lineY += 14;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(95, 95, 95);
      doc.text(props.periodLabel, pageW / 2, lineY, { align: "center" });
      lineY += 12;

      doc.setDrawColor(225, 225, 225);
      doc.setLineWidth(0.5);
      doc.line(pageW * 0.30, lineY, pageW * 0.70, lineY);

      // Key Metrics (centered 4-col stat card)
      const metricsW = 620;
      const metricsLeft = (pageW - metricsW) / 2;
      autoTable(doc, {
        startY: lineY + 16,
        head: [["Target", "Achievement", "Ach %", "Avg / JC"]],
        body: [[
          `${fmtKg(props.totals.target)} kg`,
          `${fmtKg(props.totals.achievement)} kg`,
          `${pctStr}%`,
          `${fmtKg(props.totals.avg)} kg`,
        ]],
        theme: "plain",
        tableWidth: metricsW,
        margin: { left: metricsLeft, right: metricsLeft },
        styles: { fontSize: 10, font: "helvetica", halign: "center", cellPadding: { top: 10, right: 10, bottom: 10, left: 10 }, lineWidth: 0 },
        headStyles: { fillColor: HEAD_BG, textColor: HEAD_TX, fontStyle: "bold", fontSize: 9, halign: "center" },
        bodyStyles: { fillColor: [255, 255, 255], textColor: BODY_TX, fontStyle: "bold", fontSize: 13 },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let cursorY = ((doc as any).lastAutoTable?.finalY ?? 200) + 28;

      // Child table if applicable
      if (props.children && props.children.length > 0) {
        const childLabel = props.scope === "area" ? "Beats" : props.scope === "beat" ? "Customers" : "Items";
        const title = `${childLabel} in this ${scopeLabel}`;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(25, 25, 25);
        doc.text(title, 50, cursorY);
        doc.setDrawColor(...ACCENT);
        doc.setLineWidth(1.5);
        doc.line(50, cursorY + 5, 50 + doc.getTextWidth(title), cursorY + 5);
        cursorY += 16;

        const hasExtra = props.children.some((c) => c.extra);
        const headers = hasExtra
          ? [childLabel.slice(0, -1), "Target (kg)", "Achievement (kg)", "Ach %", "Avg / JC (kg)", "Last Order"]
          : [childLabel.slice(0, -1), "Target (kg)", "Achievement (kg)", "Ach %", "Avg / JC (kg)"];
        const body = props.children.map((c) => {
          const p = pctOf(c.ach, c.target);
          const row: (string | number)[] = [c.name, fmtKg(c.target), fmtKg(c.ach), p != null ? p.toFixed(1) + "%" : "—", fmtKg(c.avg)];
          if (hasExtra) row.push(c.extra ?? "—");
          return row;
        });
        const cols: Record<number, { halign: "left" | "right" }> = {};
        for (let i = 1; i < headers.length; i++) {
          if (i === headers.length - 1 && hasExtra) cols[i] = { halign: "right" };
          else cols[i] = { halign: "right" };
        }
        autoTable(doc, {
          startY: cursorY,
          head: [headers],
          body,
          theme: "plain",
          styles: { fontSize: 9.5, font: "helvetica", cellPadding: { top: 8, right: 12, bottom: 8, left: 12 }, textColor: BODY_TX, valign: "middle" },
          headStyles: { fillColor: HEAD_BG, textColor: HEAD_TX, fontStyle: "bold", fontSize: 9.5, cellPadding: { top: 10, right: 12, bottom: 10, left: 12 } },
          alternateRowStyles: { fillColor: ALT_BG },
          columnStyles: cols,
          margin: { left: 50, right: 50, top: 50 },
        });
      }

      // Footer on every page
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totalPages = (doc as any).getNumberOfPages?.() ?? 1;
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(`Generated ${stamp}`, 50, pageH - 22);
        doc.text(`Page ${i} of ${totalPages}`, pageW - 50, pageH - 22, { align: "right" });
      }

      doc.save(`sales-report-${props.filenameSlug}.pdf`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={generate}
      disabled={busy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-paper-line bg-paper-card text-sm hover:bg-paper-subtle disabled:opacity-50"
    >
      <Download size={14} />
      {busy ? "Generating…" : "Download PDF"}
    </button>
  );
}
