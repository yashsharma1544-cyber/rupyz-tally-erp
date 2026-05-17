/**
 * Daily summary PDF — per-salesman rows ONLY.
 * No top stats strip, no totals row. Strictly per-salesman data per request.
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
  th: { fontSize: 7, textTransform: "uppercase", fontWeight: "bold", color: SUBTLE },
  td: { fontSize: 9, color: "#000" },
  cellName: { width: 95 },
  cellBeat: { flexGrow: 1, flexShrink: 1 },
  cellNum: { width: 55, textAlign: "right" },
  cellNumWide: { width: 75, textAlign: "right" },
  muted: { color: MUTED },
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
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
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
  const showProgress = reportType !== "morning";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>Sushil Agencies — Daily Summary</Text>
          <Text style={styles.subtitle}>
            {reportTitle(reportType)} · {dateLabel(date)}
          </Text>
        </View>

        <View style={styles.table}>
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

          {rows.length === 0 ? (
            <View style={styles.row}>
              <Text style={[styles.td, styles.muted]}>No active salesmen.</Text>
            </View>
          ) : (
            rows.map((r) => (
              <View key={r.salesman_id} style={styles.row}>
                <Text style={[styles.td, styles.cellName]}>{r.salesman_name}</Text>
                <Text
                  style={[
                    styles.td,
                    styles.cellBeat,
                    !r.beat_id ? styles.muted : {},
                  ]}
                >
                  {r.beat_name || "— off —"}
                </Text>
                <Text style={[styles.td, styles.cellNum]}>
                  {r.beat_id ? String(r.sc) : ""}
                </Text>
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
        </View>

        <Text style={styles.footer}>
          Sushil Agencies · Jalna · Generated {new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
        </Text>
      </Page>
    </Document>
  );
}
