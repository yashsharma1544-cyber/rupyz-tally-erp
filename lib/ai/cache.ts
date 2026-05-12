/**
 * Read-through cache for AI generations.
 *
 * Pattern: try DB cache first (by feature + entity + scope_date + context_hash).
 * On miss, call Claude, persist result, return it.
 *
 * Cache scope is per-day so we get a fresh narrative each morning but
 * don't pay for repeated requests within the same day.
 *
 * If the underlying business data changes (new orders, etc.), the
 * context_hash changes and the cache misses, regenerating.
 *
 * Server-only.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaude, contextHash, MODELS } from "./anthropic";

export interface CachedGeneration {
  content: string;
  cached: boolean;
  model: string;
  generatedAt: string;
  costUsd: number;
}

export interface GenerateParams {
  db: SupabaseClient;                    // service-role client
  feature: string;                       // e.g. 'customer_narrative'
  entityType: string | null;             // 'customer' | 'beat' | 'product' | null
  entityId: string | null;
  model?: string;                        // defaults to Sonnet
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export async function generateOrFetchCached(p: GenerateParams): Promise<CachedGeneration> {
  const today = new Date().toISOString().slice(0, 10);
  const hash = await contextHash(p.systemPrompt + "\n" + p.userPrompt);
  const model = p.model ?? MODELS.SONNET;

  // Cache lookup
  let q = p.db
    .from("ai_generations")
    .select("content, model, created_at, cost_usd, context_hash")
    .eq("feature", p.feature)
    .eq("scope_date", today)
    .eq("context_hash", hash);

  if (p.entityType === null) q = q.is("entity_type", null);
  else q = q.eq("entity_type", p.entityType);

  if (p.entityId === null) q = q.is("entity_id", null);
  else q = q.eq("entity_id", p.entityId);

  const { data: cached } = await q.maybeSingle();
  if (cached) {
    return {
      content: cached.content,
      cached: true,
      model: cached.model,
      generatedAt: cached.created_at,
      costUsd: Number(cached.cost_usd ?? 0),
    };
  }

  // Cache miss — call Claude
  const result = await callClaude({
    model,
    system: p.systemPrompt,
    messages: [{ role: "user", content: p.userPrompt }],
    maxTokens: p.maxTokens ?? 600,
    temperature: 0.4,
  });

  // Persist. If a concurrent request beat us to it, we get a unique
  // violation — ignore it; the value is the same anyway.
  const { error: insertErr } = await p.db
    .from("ai_generations")
    .insert({
      feature: p.feature,
      entity_type: p.entityType,
      entity_id: p.entityId,
      scope_date: today,
      model: result.model,
      prompt_tokens: result.inputTokens,
      completion_tokens: result.outputTokens,
      content: result.content,
      context_hash: hash,
      cost_usd: result.costUsd,
    });
  if (insertErr && insertErr.code !== "23505") {  // 23505 = unique_violation
    // Other error — log but don't fail the user-facing request
    console.error("ai_generations insert failed:", insertErr);
  }

  return {
    content: result.content,
    cached: false,
    model: result.model,
    generatedAt: new Date().toISOString(),
    costUsd: result.costUsd,
  };
}
