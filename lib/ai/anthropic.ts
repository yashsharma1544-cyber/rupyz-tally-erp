/**
 * Thin wrapper around the Anthropic API.
 *
 * Why not use the official SDK? We could, but the API surface we use is
 * tiny (1 endpoint, no streaming for v1) and a raw fetch keeps Vercel
 * bundle size down. If we add streaming or tools later, switch to the SDK.
 *
 * Server-only — reads ANTHROPIC_API_KEY from process.env. Never import
 * this file from a "use client" component.
 */

import "server-only";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Model strings. Update when newer models ship; check
// https://docs.claude.com for current names.
export const MODELS = {
  SONNET:  "claude-sonnet-4-6",
  OPUS:    "claude-opus-4-7",
  HAIKU:   "claude-haiku-4-5-20251001",
} as const;

// Pricing per million tokens (USD), as of May 2026.
// Used to estimate cost-per-generation for logging/budgeting.
// Verify against current pricing at https://www.anthropic.com/pricing
const PRICING = {
  [MODELS.SONNET]: { input: 3.00,  output: 15.00 },
  [MODELS.OPUS]:   { input: 15.00, output: 75.00 },
  [MODELS.HAIKU]:  { input: 0.80,  output: 4.00 },
} as const;

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeCallParams {
  model: string;
  system: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ClaudeResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
}

class AnthropicError extends Error {
  constructor(message: string, public status?: number, public type?: string) {
    super(message);
    this.name = "AnthropicError";
  }
}

/**
 * Call Claude. Throws AnthropicError on non-2xx, network failures, or
 * malformed responses.
 */
export async function callClaude(params: ClaudeCallParams): Promise<ClaudeResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnthropicError("ANTHROPIC_API_KEY not set in environment");
  }

  const body = {
    model: params.model,
    max_tokens: params.maxTokens ?? 1024,
    temperature: params.temperature ?? 1.0,
    system: params.system,
    messages: params.messages,
  };

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    throw new AnthropicError(`Network error calling Anthropic: ${e?.message ?? e}`);
  }

  if (!res.ok) {
    let bodyText = await res.text().catch(() => "");
    let detail = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      detail = parsed?.error?.message ?? bodyText;
    } catch { /* keep as text */ }
    throw new AnthropicError(`Anthropic API ${res.status}: ${detail.slice(0, 500)}`, res.status);
  }

  const data = await res.json();

  // Extract text from content blocks (Anthropic returns array of blocks)
  let content = "";
  for (const block of data.content ?? []) {
    if (block.type === "text") content += block.text;
  }

  const inputTokens  = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const pricing = PRICING[params.model as keyof typeof PRICING];
  const costUsd = pricing 
    ? (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output
    : 0;

  return {
    content,
    inputTokens,
    outputTokens,
    costUsd: Number(costUsd.toFixed(6)),
    model: data.model ?? params.model,
  };
}

/**
 * Compute a stable hash of input context so we know when to invalidate cache.
 * Uses Web Crypto SHA-1 (~20 char hex prefix is plenty for our cache key).
 */
export async function contextHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export { AnthropicError };
