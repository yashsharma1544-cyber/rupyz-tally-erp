/**
 * Sales monitor PDF documents.
 *
 * Three report types — same data shape, different emphasis:
 *   MorningBriefingPDF  — beat, SC count, target, focus customer lists
 *   MiddayReportPDF     — progress toward calls/kg targets
 *   EveningReportPDF    — totals + statistics
 *
 * Server-rendered via @react-pdf/renderer (Node runtime only — won't work
 * on Edge). Composed of small primitives so the same building blocks reuse
 * across the three documents.
 */

import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { SalesmanDayStatus, FocusCustomer } from "@/lib/sales-monitor/format";

// Accent palette — matches the admin UI's deep-teal + paper tokens.
const COLORS = {
  accent:     "#0d5b58",
  ink:        "#0b0b0a",
  inkMuted:   "#5a5a55",
  inkSubtle:  "#9a958c",
  paperLine:  "#e6e0d4",
  paperSoft:  "#f3eee5",
  amber:      "#a76900",
  accentSoft: "#e0eeed",
};

const styles = StyleSheet.create({
  page: {
    padding: 30,
    paddingBottom: 50,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: COLORS.ink,
    backgroundColor: "#ffffff",
  },

  header: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.accent,
    paddingBottom: 8,
    marginBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  headerLeft: {},
  headerRight: { alignItems: "flex-end" },
  companyName: { fontSize: 16, fontFamily: "Helvetica-Bold", color: COLORS.accent },
  companyTag: { fontSize: 7, color: COLORS.inkSubtle, marginTop: 3, letterSpacing: 1 },
  reportTitle: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  reportDate: { fontSize: 8, color: COLORS.inkMuted, marginTop: 2 },

  salesmanBlock: { marginBottom: 14 },
  salesmanName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  salesmanMeta: { fontSize: 9, color: COLORS.inkMuted, marginTop: 3 },

  statRow: { flexDirection: "row", marginBottom: 14 },
  statBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.paperLine,
    borderRadius: 3,
    padding: 8,
    marginRight: 6,
  },
  statBoxLast: { marginRight: 0 },
  statLabel: {
    fontSize: 7,
    color: COLORS.inkSubtle,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  statValue: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  statSub: { fontSize: 7, color: COLORS.inkSubtle, marginTop: 2 },

  // Progress bars
  progressBlock: { marginBottom: 10 },
  progressLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  progressLabel: { fontSize: 9, color: COLORS.inkMuted },
  progressPct: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  progressTrack: {
    height: 5,
    backgroundColor: COLORS.paperSoft,
    borderRadius: 2,
  },
  progressFill: { height: 5, backgroundColor: COLORS.accent, borderRadius: 2 },

  // Sections + lists
  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 3 },
  sectionSubtitle: { fontSize: 8, color: COLORS.inkSubtle, marginBottom: 6 },

  custRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.paperLine,
  },
  custLeft: { flex: 3 },
  custName: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  custMeta: { fontSize: 8, color: COLORS.inkMuted, marginTop: 1 },
  custBadge: {
    flex: 1,
    fontSize: 8,
    color: COLORS.amber,
    textAlign: "right",
    paddingTop: 2,
  },

  emptyText: {
    fontSize: 9,
    color: COLORS.inkSubtle,
    textAlign: "center",
    padding: 12,
    fontStyle: "italic",
  },

  summaryBox: {
    borderWidth: 1,
    borderColor: COLORS.paperLine,
    borderRadius: 3,
    padding: 10,
    marginBottom: 8,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  summaryRowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.paperLine,
  },
  summaryLabel: { fontSize: 9 },
  summaryValue: { fontSize: 9, fontFamily: "Helvetica-Bold" },
  summaryAmber: { fontSize: 9, color: COLORS.amber },
  summaryAmberBold: { fontSize: 9, fontFamily: "Helvetica-Bold", color: COLORS.amber },

  footer: {
    position: "absolute",
    bottom: 20,
    left: 30,
    right: 30,
    paddingTop: 4,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.paperLine,
    fontSize: 7,
    color: COLORS.inkSubtle,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

// ----- Helpers ------------------------------------------------------------

function formatKgPdf(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return Number.isInteger(v)
    ? v.toLocaleString("en-IN")
    : v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function pctNum(n: number | null | undefined, d: number | null | undefined): number | null {
  if (n == null || d == null || d <= 0) return null;
  return Math.round((Number(n) / Number(d)) * 100);
}

// ----- Shared building blocks --------------------------------------------

function Header({ title, dateStr }: { title: string; dateStr: string }) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.headerLeft}>
        <Text style={styles.companyName}>SUSHIL AGENCIES</Text>
        <Text style={styles.companyTag}>SALES MONITOR · DAILY REPORT</Text>
      </View>
      <View style={styles.headerRight}>
        <Text style={styles.reportTitle}>{title}</Text>
        <Text style={styles.reportDate}>{dateStr}</Text>
      </View>
    </View>
  );
}

function SalesmanBlock({ status }: { status: SalesmanDayStatus }) {
  const metaParts = [
    status.beat_name ? `Beat: ${status.beat_name}${status.beat_city ? ` · ${status.beat_city}` : ""}` : "No beat assigned",
    status.salesman_phone || null,
  ].filter(Boolean) as string[];
  return (
    <View style={styles.salesmanBlock}>
      <Text style={styles.salesmanName}>{status.salesman_name}</Text>
      <Text style={styles.salesmanMeta}>{metaParts.join("   ·   ")}</Text>
    </View>
  );
}

function Footer({ generatedAt }: { generatedAt: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>Generated {generatedAt} IST · Internal report — Sushil Agencies</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function ProgressBar({
  label,
  value,
  total,
  pct,
}: {
  label: string;
  value: string;
  total: string;
  pct: number | null;
}) {
  const p = Math.min(100, Math.max(0, pct ?? 0));
  return (
    <View style={styles.progressBlock}>
      <View style={styles.progressLabelRow}>
        <Text style={styles.progressLabel}>{label} — {value} of {total}</Text>
        <Text style={styles.progressPct}>{pct ?? 0}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${p}%` }]} />
      </View>
    </View>
  );
}

function CustomerListSection({
  title,
  subtitle,
  customers,
  emptyText,
  showDays,
}: {
  title: string;
  subtitle: string;
  customers: FocusCustomer[];
  emptyText: string;
  showDays?: boolean;
}) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{title} · {customers.length}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      {customers.length === 0 ? (
        <Text style={styles.emptyText}>{emptyText}</Text>
      ) : (
        customers.map((c) => (
          <View key={c.id} style={styles.custRow} wrap={false}>
            <View style={styles.custLeft}>
              <Text style={styles.custName}>{c.name}</Text>
              <Text style={styles.custMeta}>
                {[c.mobile, c.city].filter(Boolean).join("  ·  ") || "—"}
              </Text>
            </View>
            {showDays && (
              <Text style={styles.custBadge}>
                {c.days_since_last_order != null
                  ? `${c.days_since_last_order} days ago`
                  : "Never ordered"}
              </Text>
            )}
          </View>
        ))
      )}
    </View>
  );
}

// ----- Document 1: Morning Briefing ---------------------------------------

export function MorningBriefingPDF({
  status,
  generatedAt,
}: {
  status: SalesmanDayStatus;
  generatedAt: string;
}) {
  return (
    <Document
      title={`Morning Briefing — ${status.salesman_name} — ${status.date}`}
      author="Sushil Agencies"
    >
      <Page size="A4" style={styles.page}>
        <Header title="Morning Briefing" dateStr={status.date} />
        <SalesmanBlock status={status} />

        {!status.has_assignment ? (
          <Text style={styles.emptyText}>
            No beat is assigned for today. Please contact the admin.
          </Text>
        ) : (
          <>
            <View style={styles.statRow}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Scheduled Calls</Text>
                <Text style={styles.statValue}>{status.sc}</Text>
                <Text style={styles.statSub}>customers in beat</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Target</Text>
                <Text style={styles.statValue}>
                  {status.target_kg != null ? `${formatKgPdf(status.target_kg)} kg` : "Not set"}
                </Text>
                {status.target_kg != null && <Text style={styles.statSub}>for the day</Text>}
              </View>
              <View style={[styles.statBox, styles.statBoxLast]}>
                <Text style={styles.statLabel}>Beat</Text>
                <Text style={styles.statValue}>{status.beat_name || "—"}</Text>
                <Text style={styles.statSub}>{status.beat_city || ""}</Text>
              </View>
            </View>

            <CustomerListSection
              title="Focus — no order on last beat visit"
              subtitle={
                status.last_beat_date
                  ? `Customers who didn't order on the previous visit to this beat (${status.last_beat_date})`
                  : "First visit to this beat — no prior visit to compare"
              }
              customers={status.focus_no_order_last_visit}
              emptyText={
                status.last_beat_date
                  ? "All customers ordered on the previous visit. Nothing to chase."
                  : "First-time visit to this beat."
              }
            />

            <CustomerListSection
              title="Focus — no order in 15+ days"
              subtitle="Customers in this beat with no order from anyone for 15 or more days"
              customers={status.focus_no_order_in_15_days}
              emptyText="No customers match this filter. All accounts are recently active."
              showDays
            />
          </>
        )}

        <Footer generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}

// ----- Document 2: Mid-day Report -----------------------------------------

export function MiddayReportPDF({
  status,
  generatedAt,
}: {
  status: SalesmanDayStatus;
  generatedAt: string;
}) {
  const callsPct = pctNum(status.calls_done, status.sc);
  const kgPct = pctNum(status.kg_done, status.target_kg);
  const checkinTime = status.checked_in_at
    ? new Date(status.checked_in_at).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <Document
      title={`Mid-day Update — ${status.salesman_name} — ${status.date}`}
      author="Sushil Agencies"
    >
      <Page size="A4" style={styles.page}>
        <Header title="Mid-day Update · 1 PM" dateStr={status.date} />
        <SalesmanBlock status={status} />

        <View style={styles.statRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Calls Done</Text>
            <Text style={styles.statValue}>
              {status.calls_done}{status.sc > 0 ? ` / ${status.sc}` : ""}
            </Text>
            {callsPct !== null && <Text style={styles.statSub}>{callsPct}% of SC</Text>}
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Sales (kg)</Text>
            <Text style={styles.statValue}>
              {formatKgPdf(status.kg_done)}
              {status.target_kg != null && status.target_kg > 0
                ? ` / ${formatKgPdf(status.target_kg)}`
                : ""}
            </Text>
            {kgPct !== null && <Text style={styles.statSub}>{kgPct}% of target</Text>}
          </View>
          <View style={[styles.statBox, styles.statBoxLast]}>
            <Text style={styles.statLabel}>Check-in</Text>
            <Text style={styles.statValue}>{status.checked_in_at ? "Yes" : "Not yet"}</Text>
            {checkinTime && <Text style={styles.statSub}>at {checkinTime}</Text>}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Progress so far</Text>

        <ProgressBar
          label="Calls"
          value={String(status.calls_done)}
          total={`${status.sc} SC`}
          pct={callsPct}
        />

        {status.target_kg != null && status.target_kg > 0 && (
          <ProgressBar
            label="Kg sold"
            value={`${formatKgPdf(status.kg_done)} kg`}
            total={`${formatKgPdf(status.target_kg)} kg target`}
            pct={kgPct}
          />
        )}

        <Footer generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}

// ----- Document 3: Evening Final Report -----------------------------------

export function EveningReportPDF({
  status,
  generatedAt,
}: {
  status: SalesmanDayStatus;
  generatedAt: string;
}) {
  const callsPct = pctNum(status.calls_done, status.sc);
  const kgPct = pctNum(status.kg_done, status.target_kg);
  const zeroBilling = Math.max(0, status.sc - status.calls_done);
  const targetMet = status.target_kg != null && status.kg_done >= status.target_kg;

  return (
    <Document
      title={`End-of-Day Report — ${status.salesman_name} — ${status.date}`}
      author="Sushil Agencies"
    >
      <Page size="A4" style={styles.page}>
        <Header title="End-of-Day Report · 7:30 PM" dateStr={status.date} />
        <SalesmanBlock status={status} />

        <View style={styles.statRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total Calls</Text>
            <Text style={styles.statValue}>
              {status.calls_done}{status.sc > 0 ? ` / ${status.sc}` : ""}
            </Text>
            {callsPct !== null && <Text style={styles.statSub}>{callsPct}% of SC</Text>}
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total Sales</Text>
            <Text style={styles.statValue}>{formatKgPdf(status.kg_done)} kg</Text>
            {kgPct !== null && status.target_kg != null && (
              <Text style={styles.statSub}>
                {kgPct}% of {formatKgPdf(status.target_kg)} kg target
              </Text>
            )}
          </View>
          <View style={[styles.statBox, styles.statBoxLast]}>
            <Text style={styles.statLabel}>Zero-billing</Text>
            <Text style={styles.statValue}>{zeroBilling}</Text>
            <Text style={styles.statSub}>customers not ordered</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Day summary</Text>

        <View style={styles.summaryBox}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Customers in beat (SC):</Text>
            <Text style={styles.summaryValue}>{status.sc}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Customers who ordered:</Text>
            <Text style={styles.summaryValue}>{status.calls_done}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryAmber}>Zero-billing customers:</Text>
            <Text style={styles.summaryAmberBold}>{zeroBilling}</Text>
          </View>

          <View style={styles.summaryRowTop}>
            <Text style={styles.summaryLabel}>Sales (kg):</Text>
            <Text style={styles.summaryValue}>{formatKgPdf(status.kg_done)}</Text>
          </View>
          {status.target_kg != null && status.target_kg > 0 && (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Target:</Text>
                <Text style={styles.summaryLabel}>{formatKgPdf(status.target_kg)} kg</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Achievement:</Text>
                <Text
                  style={{
                    fontSize: 9,
                    fontFamily: "Helvetica-Bold",
                    color: targetMet ? COLORS.accent : COLORS.amber,
                  }}
                >
                  {kgPct ?? 0}% {targetMet ? "✓" : ""}
                </Text>
              </View>
            </>
          )}
        </View>

        {status.target_kg != null && status.target_kg > 0 && (
          <ProgressBar
            label="Kg sold"
            value={`${formatKgPdf(status.kg_done)} kg`}
            total={`${formatKgPdf(status.target_kg)} kg target`}
            pct={kgPct}
          />
        )}

        <Footer generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
