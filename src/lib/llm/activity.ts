// LLM Activity Logger — tracks every LLM call for the activity panel.
//
// Captures: timestamp, provider, model, module (crypto_technical, news_sentiment,
// etc.), latency, success/failure, error message, tokens used, and whether a
// fallback was used. Stores the last 100 calls in memory (ring buffer) —
// enough for the activity panel without unbounded memory growth.
//
// The activity panel at /llm-activity shows this data in real-time so users
// can see exactly what each LLM model is doing, which provider is serving
// requests, and how the fallback chain is working.

export interface LlmActivityEntry {
  id: string;
  timestamp: number;
  provider: string;          // e.g. "Pollinations", "OpenRouter"
  model: string;             // e.g. "openai", "meta-llama/llama-3.3-70b-instruct"
  module: string;            // e.g. "crypto_technical", "news_sentiment", "test", "brain"
  asset?: string;            // e.g. "BTCUSDT" (if applicable)
  latencyMs: number;
  success: boolean;
  error?: string;
  fallbackUsed: boolean;
  primaryProvider?: string;  // the provider that was tried first (if fallback)
  promptTokens?: number;
  completionTokens?: number;
  contentPreview?: string;   // first 80 chars of the response
}

const MAX_ENTRIES = 100;
const activityLog: LlmActivityEntry[] = [];

/** Log an LLM activity entry. Called after every LLM call (success or failure). */
export function logLlmActivity(entry: Omit<LlmActivityEntry, 'id' | 'timestamp'>): void {
  const fullEntry: LlmActivityEntry = {
    ...entry,
    id: `llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  activityLog.push(fullEntry);
  // Ring buffer — keep only the last MAX_ENTRIES
  if (activityLog.length > MAX_ENTRIES) {
    activityLog.splice(0, activityLog.length - MAX_ENTRIES);
  }
}

/** Get the recent LLM activity log (newest first). */
export function getLlmActivity(limit: number = 50): LlmActivityEntry[] {
  return activityLog.slice(-limit).reverse();
}

/** Get summary stats for the activity panel header. */
export function getLlmActivityStats(): {
  totalCalls: number;
  successCount: number;
  failCount: number;
  avgLatencyMs: number;
  fallbackCount: number;
  byProvider: Record<string, { calls: number; success: number; fail: number; avgLatencyMs: number }>;
  byModule: Record<string, { calls: number; success: number; fail: number }>;
} {
  const total = activityLog.length;
  if (total === 0) {
    return {
      totalCalls: 0,
      successCount: 0,
      failCount: 0,
      avgLatencyMs: 0,
      fallbackCount: 0,
      byProvider: {},
      byModule: {},
    };
  }

  let successCount = 0;
  let failCount = 0;
  let totalLatency = 0;
  let fallbackCount = 0;
  const byProvider: Record<string, { calls: number; success: number; fail: number; totalLatency: number }> = {};
  const byModule: Record<string, { calls: number; success: number; fail: number }> = {};

  for (const e of activityLog) {
    if (e.success) successCount++;
    else failCount++;
    totalLatency += e.latencyMs;
    if (e.fallbackUsed) fallbackCount++;

    if (!byProvider[e.provider]) {
      byProvider[e.provider] = { calls: 0, success: 0, fail: 0, totalLatency: 0 };
    }
    byProvider[e.provider].calls++;
    if (e.success) byProvider[e.provider].success++;
    else byProvider[e.provider].fail++;
    byProvider[e.provider].totalLatency += e.latencyMs;

    if (!byModule[e.module]) {
      byModule[e.module] = { calls: 0, success: 0, fail: 0 };
    }
    byModule[e.module].calls++;
    if (e.success) byModule[e.module].success++;
    else byModule[e.module].fail++;
  }

  return {
    totalCalls: total,
    successCount,
    failCount,
    avgLatencyMs: Math.round(totalLatency / total),
    fallbackCount,
    byProvider: Object.fromEntries(
      Object.entries(byProvider).map(([k, v]) => [k, {
        calls: v.calls,
        success: v.success,
        fail: v.fail,
        avgLatencyMs: Math.round(v.totalLatency / v.calls),
      }])
    ),
    byModule,
  };
}
