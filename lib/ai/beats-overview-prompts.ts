/**
 * Beats overview — one line per beat for the insights index page.
 *
 * Returns a JSON object: { [beatId]: "one-line insight" }
 * Each line is ~12-18 words, identifies the most important fact about
 * that beat. Single Claude call produces all lines at once (cheaper +
 * faster than N calls).
 */

import "server-only";

export interface BeatLineSummary {
  beatId: string;
  beatName: string;
  city: string | null;
  totalCustomers: number;
  activeCount: number;
  sleepingCount: number;
  this30dKg: number;
  prev30dKg: number;
  growthPct: number | null;
  topCustomer: { name: string; kg: number } | null;
  topBrand: { name: string; kg: number } | null;
  shrinkingCustomerCount: number;       // customers down >30% vs prior 30d
  topShrinker: { name: string; prevKg: number; recentKg: number } | null;
}

export const BEATS_OVERVIEW_SYSTEM = `
You are an analyst for Sushil Agencies, a tea wholesaler in Maharashtra, India.

Your task: for each beat in the input, output ONE short line (12-18 words) capturing the SINGLE most important fact about that beat — the thing the owner needs to know to decide where to focus today.

Priority for what to highlight (pick the strongest signal per beat):
1. Concentrated risk — one customer is most of the kg, or shrinking
2. High-value sleeping customer worth re-engaging (name them with kg)
3. Sharp growth or sharp decline vs previous period
4. Operational red flag — beat has zero activity, all customers sleeping, etc.
5. Standout positive (only if genuinely notable)

Output format: a valid JSON object mapping beatId to its line.
Example:
{
  "uuid-1": "Bazaar Line down 63% — top buyer Jaidev Swami dropped from 1,800 to 200 kg",
  "uuid-2": "D Raja stable but 4 sleeping high-value customers worth re-engaging",
  "uuid-3": "Mehkar is the only beat above baseline, driven by Pritesh Traders +1,200 kg"
}

Critical rules:
- Output ONLY the JSON object. No preamble, no markdown fences, no explanation.
- Each line MUST cite at least one specific number or customer/brand name.
- Each line MUST be 12-18 words. Be terse.
- All quantities in kg (never tonnes).
- Use exact Indian-formatted numbers (e.g. 2,400 kg not 2.4t).
- If a beat has zero activity in 30 days, say so directly.
- Never say "needs attention" or "follow up" — say WHAT specifically.
- Never invent customer names or numbers not in the data.
- Skip beats that have insufficient data with the line "Insufficient activity to summarize".
`.trim();

export function buildBeatsOverviewUser(beats: BeatLineSummary[]): string {
  const lines = beats.map(b => {
    const parts = [
      `Beat: "${b.beatName}" (id: ${b.beatId})`,
      `  City: ${b.city ?? "—"}`,
      `  Customers: ${b.totalCustomers} (${b.activeCount} active 30d, ${b.sleepingCount} sleeping 60+d)`,
      `  30d kg: ${b.this30dKg.toLocaleString("en-IN")}, prev 30d: ${b.prev30dKg.toLocaleString("en-IN")}`,
      `  Growth: ${b.growthPct == null ? "no baseline" : `${b.growthPct > 0 ? "+" : ""}${b.growthPct.toFixed(0)}%`}`,
    ];
    if (b.topCustomer) {
      parts.push(`  Top customer (6mo): ${b.topCustomer.name}, ${b.topCustomer.kg.toLocaleString("en-IN")} kg`);
    }
    if (b.topBrand) {
      parts.push(`  Top brand (6mo): ${b.topBrand.name}, ${b.topBrand.kg.toLocaleString("en-IN")} kg`);
    }
    if (b.shrinkingCustomerCount > 0) {
      parts.push(`  Shrinking customers (>30% drop vs prior 30d): ${b.shrinkingCustomerCount}`);
      if (b.topShrinker) {
        parts.push(`  Biggest shrinker: ${b.topShrinker.name} (${b.topShrinker.prevKg} → ${b.topShrinker.recentKg} kg)`);
      }
    }
    return parts.join("\n");
  });

  return `Here are ${beats.length} beats with their 30-day performance data. Generate one line per beat per the rules.

${lines.join("\n\n")}

Output the JSON object now.`;
}
