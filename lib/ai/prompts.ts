/**
 * Prompt templates for all AI features.
 *
 * Design principles:
 * - System prompt sets persona, scope, tone, constraints
 * - User message carries the data + question
 * - Keep outputs short and actionable; tea-wholesale operators don't want essays
 * - Always anchor in concrete numbers from the provided context
 * - Tell Claude what NOT to do (don't speculate, don't fabricate names, etc.)
 */

import "server-only";

// =============================================================================
// SHARED SYSTEM PROMPT FRAGMENTS
// =============================================================================

const BIZ_CONTEXT = `
You are an analyst for Sushil Agencies, a wholesale tea distributor in Maharashtra, India.
The business:
- Sells loose and packaged tea (Vikram, Lion, New Sagar, Janta Dust brands and SKUs)
- Operates via beats (sales routes) and salesmen who visit retail customers (kirana, traders)
- Tracks orders, dispatches, customer visits in this app
- All quantities are in kilograms (kg). When discussing volume, use "kg" not "tonnes" or other units
- Currency is Indian Rupees (₹). Format large amounts as "₹X lakh" or "₹X.Y crore"
- Indian context: use Indian formatting (e.g., 1,23,456 not 123,456 for digit grouping is optional)
`.trim();

const TONE_RULES = `
Tone:
- Direct and operator-friendly. Skip the buildup.
- Cite specific numbers from the data provided. Never invent figures.
- If data is missing or insufficient, say so plainly — don't speculate.
- Use plain prose. Avoid bullet lists unless the data is genuinely a list.
- Keep responses concise — operators are busy.
`.trim();

// =============================================================================
// CUSTOMER NARRATIVE
// =============================================================================

export const CUSTOMER_NARRATIVE_SYSTEM = `
${BIZ_CONTEXT}

Your task: write a 2-3 paragraph narrative about a single customer's recent ordering pattern.

Focus on:
1. Are they ordering consistently, growing, shrinking, or sleeping?
2. What products/brands do they prefer?
3. Any anomalies — recent gap, unusual order size, dropped product they used to buy?
4. A specific actionable insight if the data supports one (e.g., "Last ordered Vikram Lion in Feb but bought it monthly before then — worth re-pitching")

${TONE_RULES}

DO NOT:
- Recommend visits or "follow up" generically — only if specific data justifies it
- Mention features/buttons of the app
- Output bullets, headers, or markdown — plain prose only
- Exceed ~150 words
`.trim();

export function buildCustomerNarrativeUser(ctx: CustomerContext): string {
  return `Here's the data on customer "${ctx.name}" from beat "${ctx.beat ?? "(unassigned)"}":

Recent order summary (last 6 months):
- Total orders: ${ctx.totalOrders}
- Total kg: ${ctx.totalKg.toLocaleString("en-IN")}
- Total revenue: ₹${ctx.totalRevenue.toLocaleString("en-IN")}
- First order in window: ${ctx.firstOrderDate ?? "—"}
- Last order: ${ctx.lastOrderDate ?? "—"}
- Days since last order: ${ctx.daysSinceLast ?? "—"}
- Avg order size: ${ctx.avgKgPerOrder?.toFixed(1) ?? "—"} kg

Monthly trend (orders / kg):
${ctx.monthlyTrend.map(m => `  ${m.month}: ${m.orders} orders, ${m.kg.toLocaleString("en-IN")} kg`).join("\n")}

Top products (kg):
${ctx.topProducts.map(p => `  ${p.name}: ${p.kg.toLocaleString("en-IN")} kg over ${p.orders} orders`).join("\n")}

${ctx.droppedProducts.length > 0 ? `Products they USED to buy but haven't in last 60 days:
${ctx.droppedProducts.map(p => `  ${p.name}: last bought ${p.lastBought}, was ordered ${p.previousFrequency} times before`).join("\n")}` : ""}

${ctx.lastVisit ? `Last salesman visit: ${ctx.lastVisit} by ${ctx.lastVisitBy ?? "unknown"}` : "No recorded visits in last 60 days."}

Write the narrative.`.trim();
}

export interface CustomerContext {
  name: string;
  beat: string | null;
  totalOrders: number;
  totalKg: number;
  totalRevenue: number;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  daysSinceLast: number | null;
  avgKgPerOrder: number | null;
  monthlyTrend: { month: string; orders: number; kg: number }[];
  topProducts: { name: string; kg: number; orders: number }[];
  droppedProducts: { name: string; lastBought: string; previousFrequency: number }[];
  lastVisit: string | null;
  lastVisitBy: string | null;
}

// =============================================================================
// BEAT NARRATIVE
// =============================================================================

export const BEAT_NARRATIVE_SYSTEM = `
${BIZ_CONTEXT}

Your task: write a 2-3 paragraph operational summary of a single beat (sales route).

Focus on:
1. Beat health — total customers, active vs sleeping, growing vs shrinking
2. Top customers in this beat and any standout patterns
3. Brand/product mix on this beat — anything unusual vs the business average
4. The most actionable next move (specific customer to re-engage, product opportunity)

${TONE_RULES}

DO NOT:
- Generalize ("the beat is doing well") — be specific or say nothing
- Output bullets, headers, or markdown
- Exceed ~150 words
`.trim();

export function buildBeatNarrativeUser(ctx: BeatContext): string {
  return `Beat: "${ctx.name}" in ${ctx.city ?? "—"}.

Customer roster:
- Total customers: ${ctx.totalCustomers}
- Active in last 30 days: ${ctx.activeCount}
- Sleeping (no order in 60+ days): ${ctx.sleepingCount}
- New customers this month: ${ctx.newThisMonth}

Recent activity (last 6 months):
- Total orders: ${ctx.totalOrders}
- Total kg: ${ctx.totalKg.toLocaleString("en-IN")}
- Total revenue: ₹${ctx.totalRevenue.toLocaleString("en-IN")}

Monthly trend:
${ctx.monthlyTrend.map(m => `  ${m.month}: ${m.kg.toLocaleString("en-IN")} kg, ${m.orders} orders, ${m.activeCustomers} active customers`).join("\n")}

Top 5 customers by kg:
${ctx.topCustomers.map(c => `  ${c.name}: ${c.kg.toLocaleString("en-IN")} kg over ${c.orders} orders`).join("\n")}

Top 3 brands on this beat:
${ctx.topBrands.map(b => `  ${b.name}: ${b.kg.toLocaleString("en-IN")} kg`).join("\n")}

${ctx.shrinkingCustomers.length > 0 ? `Shrinking customers (down >30% vs prior period):
${ctx.shrinkingCustomers.map(c => `  ${c.name}: ${c.prevKg} kg → ${c.recentKg} kg`).join("\n")}` : ""}

Write the narrative.`.trim();
}

export interface BeatContext {
  name: string;
  city: string | null;
  totalCustomers: number;
  activeCount: number;
  sleepingCount: number;
  newThisMonth: number;
  totalOrders: number;
  totalKg: number;
  totalRevenue: number;
  monthlyTrend: { month: string; orders: number; kg: number; activeCustomers: number }[];
  topCustomers: { name: string; kg: number; orders: number }[];
  topBrands: { name: string; kg: number }[];
  shrinkingCustomers: { name: string; prevKg: number; recentKg: number }[];
}

// =============================================================================
// PRODUCT NARRATIVE
// =============================================================================

export const PRODUCT_NARRATIVE_SYSTEM = `
${BIZ_CONTEXT}

Your task: write a 2-3 paragraph summary of a single product's sales performance.

Focus on:
1. Volume trend — growing, stable, declining vs prior period
2. Customer concentration — is this product spread across many customers or dependent on a few?
3. Any customers who used to buy this product and stopped (churn signal)
4. A specific opportunity or risk

${TONE_RULES}

DO NOT:
- Recommend marketing campaigns or generic actions
- Output bullets, headers, or markdown
- Exceed ~150 words
`.trim();

export function buildProductNarrativeUser(ctx: ProductContext): string {
  return `Product: "${ctx.name}" (${ctx.brand})

Performance (last 6 months):
- Total kg sold: ${ctx.totalKg.toLocaleString("en-IN")}
- Total revenue: ₹${ctx.totalRevenue.toLocaleString("en-IN")}
- Distinct customers who bought: ${ctx.distinctCustomers}
- Total order lines: ${ctx.totalOrderLines}

Monthly trend:
${ctx.monthlyTrend.map(m => `  ${m.month}: ${m.kg.toLocaleString("en-IN")} kg, ${m.customers} customers`).join("\n")}

Top 5 customers (by kg):
${ctx.topCustomers.map(c => `  ${c.name}: ${c.kg.toLocaleString("en-IN")} kg`).join("\n")}

${ctx.droppedCustomers.length > 0 ? `Customers who used to buy but stopped (last 60 days):
${ctx.droppedCustomers.slice(0, 5).map(c => `  ${c.name}: last bought on ${c.lastBought}, had bought ${c.previousFrequency} times before`).join("\n")}` : ""}

Concentration: top customer is ${ctx.topCustomerShare ? `${(ctx.topCustomerShare * 100).toFixed(0)}%` : "?"} of this product's kg.

Write the narrative.`.trim();
}

export interface ProductContext {
  name: string;
  brand: string;
  totalKg: number;
  totalRevenue: number;
  distinctCustomers: number;
  totalOrderLines: number;
  monthlyTrend: { month: string; kg: number; customers: number }[];
  topCustomers: { name: string; kg: number }[];
  droppedCustomers: { name: string; lastBought: string; previousFrequency: number }[];
  topCustomerShare: number | null;
}

// =============================================================================
// DAILY BRIEFING
// =============================================================================

export const DAILY_BRIEFING_SYSTEM = `
${BIZ_CONTEXT}

Your task: write a 4-6 paragraph daily briefing for the business owner/operator at start of day.

Cover, in this order:
1. Yesterday's number — orders, kg, revenue, and how that compares to the trailing 7-day and 30-day averages
2. Two or three things worth attention today — sleeping customers due for outreach, shrinking accounts, products with falling trends, opportunities, or anomalies
3. One specific lead-or-lag indicator worth watching
4. Acknowledge what's normal/healthy without dwelling on it

${TONE_RULES}

DO NOT:
- Repeat lots of numbers — the operator can see them. Highlight what's notable.
- Speculate about reasons unless the data clearly supports it
- Output bullets, headers, or markdown — running prose only
- Exceed ~250 words
- Start with "Good morning" or other pleasantries
`.trim();

export function buildDailyBriefingUser(ctx: DailyBriefingContext): string {
  return `As-of date: ${ctx.asOfDate}

Yesterday's activity:
- Orders: ${ctx.yesterday.orders}
- Kg: ${ctx.yesterday.kg.toLocaleString("en-IN")}
- Revenue: ₹${ctx.yesterday.revenue.toLocaleString("en-IN")}

Trailing averages:
- 7-day avg orders/day: ${ctx.avg7d.orders.toFixed(1)}
- 7-day avg kg/day: ${ctx.avg7d.kg.toLocaleString("en-IN")}
- 30-day avg orders/day: ${ctx.avg30d.orders.toFixed(1)}
- 30-day avg kg/day: ${ctx.avg30d.kg.toLocaleString("en-IN")}

Active workflow:
- Pending orders (received but not dispatched): ${ctx.pendingOrders}
- Orders in transit (dispatched but not delivered): ${ctx.inTransitOrders}

Customer alerts:
- Customers gone sleeping in last 7 days: ${ctx.sleepingThisWeek}
- Top 3 highest-value sleeping customers (kg in last 6mo / days since last order):
${ctx.topSleepingCustomers.map(c => `  ${c.name}: ${c.kg.toLocaleString("en-IN")} kg, ${c.daysSince}d ago`).join("\n")}

Beat alerts:
- Beats with no orders yesterday: ${ctx.beatsWithNoActivity}/${ctx.totalBeats}
- Worst-trending beat: ${ctx.worstBeat ? `${ctx.worstBeat.name} (${ctx.worstBeat.changePct > 0 ? "+" : ""}${ctx.worstBeat.changePct.toFixed(0)}% vs prior 30d)` : "—"}

Product alerts:
- Worst-trending product (last 30d vs prior 30d): ${ctx.worstProduct ? `${ctx.worstProduct.name} (${ctx.worstProduct.changePct.toFixed(0)}%)` : "—"}

Write the briefing.`.trim();
}

export interface DailyBriefingContext {
  asOfDate: string;
  yesterday: { orders: number; kg: number; revenue: number };
  avg7d: { orders: number; kg: number };
  avg30d: { orders: number; kg: number };
  pendingOrders: number;
  inTransitOrders: number;
  sleepingThisWeek: number;
  topSleepingCustomers: { name: string; kg: number; daysSince: number }[];
  beatsWithNoActivity: number;
  totalBeats: number;
  worstBeat: { name: string; changePct: number } | null;
  worstProduct: { name: string; changePct: number } | null;
}

// =============================================================================
// CHAT (ask anything)
// =============================================================================

export const CHAT_SYSTEM = `
${BIZ_CONTEXT}

You are a friendly, knowledgeable assistant who answers questions about Sushil Agencies' business data.

How you work:
- You receive the user's question along with a snapshot of relevant business data
- You answer using only the data provided. If the data isn't sufficient, say so and suggest what data would help.
- You can refer back to earlier turns in the conversation
- For questions you can't answer from data, be honest — don't fabricate

${TONE_RULES}

DO NOT:
- Mention "the data shows" or "based on the context" — just answer naturally
- Output excessive markdown. Light bolding for emphasis OK, no headers/bullets unless the answer genuinely needs structure.
- Make up customer names, product names, or numbers
- Exceed ~200 words unless the user asks for detail

If asked about something you don't have data for (e.g., a future plan, a customer name not in context, market conditions), say so and offer to help with a related question.
`.trim();
