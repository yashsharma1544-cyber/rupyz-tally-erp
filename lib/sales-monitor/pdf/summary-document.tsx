/**
 * Daily summary PDF — one row per salesman with aggregated totals at the
 * bottom. Three variants based on report type:
 *   morning  → Beat, SC, Target columns (no done numbers yet)
 *   midday   → All columns
 *   evening  → All columns (end-of-day final)
 */

/* eslint-disable react/no-unknown-property */
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { SalesmanSummaryRow } from "../format";

const TEAL = "#0d5b58";
const PAPER = "#faf7f2";
const SUBTLE = "#666";
const MUTED = "#999";
const LINE = "#ddd";

const styles = StyleSheet.create({
  page: {
    backgroundColor: PAPER,
    padding: 30,
    fontSize: 9,
    fontFamily: "Helvetica",
  },
  header: { marginBottom: 14, borderBottomWidth: 2, borderBottomColor: TEAL, paddingBottom: 8 },
  brand: { fontSize: 16, fontWeight: "bold", color: TEAL },
  subtitle: { fontSize: 10, color: SUBTLE, marginTop: 3 },
  // Stats strip
  stats: { flexDirection: "row", gap: 10, marginBottom: 14 },
  statCard: { flexGrow: 1, padding: 8, backgroundColor: "#ffffff", borderWidth: 1, borderColor: LINE, borderRadius: 4 },
  statLabel: { fontSize: 7, textTransform: "uppercase", color: MUTED, marginBottom: 2 },
  statValue: { fontSize: 13, fontWeight: "bold", color: "#000" },
  statSub: { fontSize: 7, color: MUTED, marginTop: 1 },
  // Table
  table: { borderWidth: 1, borderColor: LINE, backgroundColor: "#ffffff", borderRadius: 3 },
  headerRow: {
    flexDirection: "row",
    backgroundColor: "#f0ede5",
    borderBottomWidth: 1,
    borderBottomColor: "#ccc",
    paddingTop: 6, paddingBottom: 6, paddingHorizontal: 8,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#f0ede5",
    paddingTop: 6, paddingBottom: 6, paddingHorizontal: 8,
  },
  totalRow: {
    flexDirection: "row",
    backgroundColor: "#f7f5ef",
    paddingTop: 7, paddingBottom: 7, paddingHorizontal: 8,
    borderTopWidth: 2, borderTopColor: TEAL,
  },
  th: { fontSize: 7, textTransform: "uppercase", fontWeight: "bold", color: SUBTLE },
  td: { fontSize: 9, color: "#000" },
  cellName: { width: 95 },
  cellBeat: { flexGrow: 1, flexShrink: 1 },
  cellNum: { width: 55, textAlign: "right" },
  cellNumWide: { width: 75, textAlign: "right" },
  muted: { color: MUTED },
  bold: { fontWeight: "bold" },
  footer: {
    position: "absolute",
    bottom: 20, left: 30, right: 30,
    textAlign: "center",
    fontSize: 7,
    color: MUTED,
  },
});

type ReportType = "morning" | "midday" | "evening";

type Props = {
  reportType: ReportType;
  date: string;
  rows: SalesmanSummaryRow[];
};

function fmtKg(n: number | null | undefined): string {
  if (n == null) return "—";
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "0";
  return Number.isInteger(v)
    ? v.toLocaleString("en-IN")
    : v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function reportTitle(type: ReportType): string {
  if (type === "morning") return "Morning Briefing";
  if (type === "midday") return "Mid-day Update";
  return "Evening Final";
}

function dateLabel(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

export function SummaryDocument({ reportType, date, rows }: Props): React.ReactElement {
  // Aggregates
  const totalSC = rows.reduce((s, r) => s + r.sc, 0);
  const totalCalls = rows.reduce((s, r) => s + r.calls_done, 0);
  const totalTarget = rows.reduce((s, r) => s + Number(r.target_kg || 0), 0);
  const totalKg = rows.reduce((s, r) => s + Number(r.kg_done || 0), 0);
  const beatsCovered = rows.filter((r) => r.beat_id).length;

  const callsPct =
    totalSC > 0 ? Math.round((totalCalls / totalSC) * 100) : null;
  const kgPct =
    totalTarget > 0 ? Math.round((totalKg / totalTarget) * 100) : null;

  const showProgress = reportType !== "morning";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.brand}>Sushil Agencies — Daily Summary</Text>
          <Text style={styles.subtitle}>
            {reportTitle(reportType)} · {dateLabel(date)}
          </Text>
        </View>

        {/* Top stats */}
        <View style={styles.stats}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Salesmen</Text>
            <Text style={styles.statValue}>{rows.length}</Text>
            <Text style={styles.statSub}>{beatsCovered} with beat today</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Target</Text>
            <Text style={styles.statValue}>{fmtKg(totalTarget)} kg</Text>
            <Text style={styles.statSub}>across all salesmen</Text>
          </View>
          {showProgress ? (
            <>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Calls done</Text>
                <Text style={styles.statValue}>
                  {totalCalls}
                  {totalSC > 0 ? ` / ${totalSC}` : ""}
                </Text>
                <Text style={styles.statSub}>
                  {callsPct !== null ? `${callsPct}% of SC` : "no SC set"}
                </Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Kg sold</Text>
                <Text style={styles.statValue}>{fmtKg(totalKg)} kg</Text>
                <Text style={styles.statSub}>
                  {kgPct !== null ? `${kgPct}% of target` : "no target"}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>SC total</Text>
              <Text style={styles.statValue}>{totalSC}</Text>
              <Text style={styles.statSub}>scheduled calls today</Text>
            </View>
          )}
        </View>

        {/* Table */}
        <View style={styles.table}>
          {/* Header row */}
          <View style={styles.headerRow}>
            <Text style={[styles.th, styles.cellName]}>Salesman</Text>
            <Text style={[styles.th, styles.cellBeat]}>Beat</Text>
            <Text style={[styles.th, styles.cellNum]}>SC</Text>
            <Text style={[styles.th, styles.cellNumWide]}>Target (kg)</Text>
            {showProgress && (
              <>
                <Text style={[styles.th, styles.cellNum]}>Calls</Text>
                <Text style={[styles.th, styles.cellNumWide]}>Kg done</Text>
              </>
            )}
          </View>

          {/* Data rows */}
          {rows.length === 0 ? (
            <View style={styles.row}>
              <Text style={[styles.td, styles.muted]}>
                No active salesmen.
              </Text>
            </View>
          ) : (
            rows.map((r) => (
              <View key={r.salesman_id} style={styles.row}>
                <Text style={[styles.td, styles.cellName]}>
                  {r.salesman_name}
                </Text>
<Text
  style={[
    styles.td,
    styles.cellBeat,
    !r.beat_id ? styles.muted : {},
  ]}
>
  {r.beat_name || "— off —"}
</Text>
                <Text style={[styles.td, styles.cellNum]}>{r.sc || ""}</Text>
                <Text style={[styles.td, styles.cellNumWide]}>
                  {r.target_kg != null ? fmtKg(r.target_kg) : "—"}
                </Text>
                {showProgress && (
                  <>
                    <Text style={[styles.td, styles.cellNum]}>
                      {r.calls_done}
                    </Text>
                    <Text style={[styles.td, styles.cellNumWide]}>
                      {fmtKg(r.kg_done)}
                    </Text>
                  </>
                )}
              </View>
            ))
          )}

          {/* Totals row */}
          {rows.length > 0 && (
            <View style={styles.totalRow}>
              <Text style={[styles.td, styles.bold, styles.cellName]}>Totals</Text>
              <Text style={[styles.td, styles.cellBeat, styles.muted]}>
                {beatsCovered} beat{beatsCovered === 1 ? "" : "s"} covered
              </Text>
              <Text style={[styles.td, styles.bold, styles.cellNum]}>
                {totalSC}
              </Text>
              <Text style={[styles.td, styles.bold, styles.cellNumWide]}>
                {fmtKg(totalTarget)}
              </Text>
              {showProgress && (
                <>
                  <Text style={[styles.td, styles.bold, styles.cellNum]}>
                    {totalCalls}
                  </Text>
                  <Text style={[styles.td, styles.bold, styles.cellNumWide]}>
                    {fmtKg(totalKg)}
                  </Text>
                </>
              )}
            </View>
          )}
        </View>

        <Text style={styles.footer}>
          Sushil Agencies · Jalna · Generated {new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
        </Text>
      </Page>
    </Document>
  );
}
