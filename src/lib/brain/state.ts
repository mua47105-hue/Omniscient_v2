// The Lazy Brain — autonomous orchestration + token economy.
//
// Applies ponytail's ladder to EVERY LLM call the scheduler would make:
//   1. YAGNI      — if the deterministic consensus is already unanimous and
//                   high-conviction, the LLM call doesn't need to exist. Skip.
//   2. budget     — if the rolling token budget is exhausted, downshift to
//                   deterministic-only (no LLM) until the window resets. This
//                   is the free-tier safety net that prevents rate-limit hits.
//   3. cache      — if the market data signature is unchanged since the last
//                   LLM verdict, reuse it. Don't pay twice for the same read.
//   4. cadence    — if nothing noteworthy is happening and we analyzed
//                   recently, skip. Calm markets don't need re-analysis.
//   5. minimum    — only then call the LLM, with the smallest prompt that
//                   captures the decision (delta + key stats, not 200 candles).
//
// Never cut: the consensus integrity (deterministic layers always run), the
// grading loop, price alerts, or alert delivery. The brain only governs
// WHETHER and HOW DEEPLY the LLM is consulted — it never silences a real
// signal. That's lazy, not negligent.
//
// State lives in-memory on globalThis (survives Next.js hot reloads). Control
// flags (running/mode/config) are mirrored to the Setting table so a restart
// preserves the operator's intent. Stats + watch cache are ephemeral — they
// rebuild from live market data on the first tick after a restart.

import { getSetting, setSetting, SETTING_KEYS } from '@/lib/config/settings';

export type BrainMode = 'auto' | 'manual';

export interface AssetWatch {
  symbol: string;
  lastPrice: number;
  lastAnalyzedAt: number; // epoch ms of the last LLM call
  lastWatchedAt: number; // epoch ms of the last deterministic watch pass
  lastDataSig: string; // signature of the market data at last LLM call
  lastVerdict?: {
    score: number;
    rationale: string;
    confidence: number;
    model: string;
    direction: string;
    conviction: number;
  };
  lastNoteworthiness: number;
  lastRegime: 'trending' | 'ranging' | 'volatile';
  lastTier: number; // 0 = watch-only (no LLM), 1 = triage LLM, 2 = deep LLM
  lastAction: string; // skip | cache | analyze | watch | alert
  lastReason: string;
  updatedAt: number;
}

export interface BrainStats {
  ticksTotal: number;
  llmCallsTotal: number;
  llmCallsSkipped: number; // unanimous-deterministic + too-soon skips
  cacheHits: number;
  budgetSkips: number;
  tokensUsed: number;
  tokensSaved: number; // estimated tokens not spent thanks to the gate
  alertsSent: number;
  lastTickAt: number | null;
  startedAt: number;
  // Autonomy trigger counts — how many times each trigger type has fired.
  triggersNews: number;
  triggersCrossAsset: number;
  triggersManual: number;
}

/** A point-in-time sample of the token economy — powers the savings sparkline. */
export interface StatsSample {
  ts: number;
  tokensUsed: number;
  tokensSaved: number;
  llmCalls: number;
  skips: number;
}

/** A self-tuning nudge — records the threshold change + the reason. Powers the
 *  self-tune history chart so operators can see the brain learning over time. */
export interface TuneEvent {
  ts: number;
  field: 'unanimousConviction' | 'minNoteworthiness' | 'highNoteworthiness';
  from: number;
  to: number;
  reason: string;
  winRate: number;
  sampleSize: number;
}

export interface BrainConfig {
  // Gate thresholds. Tuned for a free stack: be lazy by default, only spend
  // an LLM call when deterministic math is undecided OR something is happening.
  minNoteworthiness: number; // 0-100; below this AND recently analyzed → skip
  highNoteworthiness: number; // 0-100; at/above this → eligible for deep tier
  unanimousConviction: number; // deterministic conviction >= this → skip LLM
  unanimousAgreement: number; // indicator agreement fraction >= this → skip LLM
  cacheTtlMs: number; // reuse a verdict if data signature unchanged within this
  minReanalyzeMs: number; // min gap between LLM calls for the same asset
  budgetCap: number; // max tokens per budget window
  budgetWindowMs: number; // budget window length
}

export interface BrainAction {
  ts: number;
  symbol: string;
  action: string; // skip | cache | analyze | watch | alert
  tier: number;
  reason: string;
  tokens?: number;
  conviction?: number;
  direction?: string;
}

const DEFAULT_CONFIG: BrainConfig = {
  minNoteworthiness: 35,
  highNoteworthiness: 65,
  unanimousConviction: 70,
  unanimousAgreement: 0.8,
  cacheTtlMs: 30 * 60 * 1000, // 30 min
  minReanalyzeMs: 10 * 60 * 1000, // 10 min
  budgetCap: 60_000, // ~600 small LLM calls/hour on a free tier before downshift
  budgetWindowMs: 60 * 60 * 1000, // 1 hour
};

interface BrainStateInternal {
  running: boolean;
  mode: BrainMode;
  config: BrainConfig;
  watch: Map<string, AssetWatch>;
  stats: BrainStats;
  budgetUsed: number;
  budgetWindowStart: number;
  recentActions: BrainAction[];
  hydrated: boolean;
  // Manual override queue: symbol → trigger source ('manual'|'news'|'cross-asset').
  // Processed even when the autonomous brain is paused, always at deep tier.
  forceRunQueue: Map<string, string>;
  // Token-economy timeline samples — one per tick, ring-buffered (capped) so
  // the savings sparkline has history without unbounded memory growth.
  statsSamples: StatsSample[];
  // Self-tune history — records each threshold nudge so operators can see the
  // brain learning. Capped to avoid unbounded growth.
  tuneEvents: TuneEvent[];
}

const g = globalThis as unknown as { __omniscientBrain?: BrainStateInternal };
const MAX_SAMPLES = 120; // ~2h of 60s ticks — enough for a meaningful sparkline
const MAX_TUNE_EVENTS = 50; // self-tune history cap

function freshState(): BrainStateInternal {
  const now = Date.now();
  return {
    running: true,
    mode: 'auto',
    config: { ...DEFAULT_CONFIG },
    watch: new Map(),
    stats: { ticksTotal: 0, llmCallsTotal: 0, llmCallsSkipped: 0, cacheHits: 0, budgetSkips: 0, tokensUsed: 0, tokensSaved: 0, alertsSent: 0, lastTickAt: null, startedAt: now, triggersNews: 0, triggersCrossAsset: 0, triggersManual: 0 },
    budgetUsed: 0,
    budgetWindowStart: now,
    recentActions: [],
    hydrated: false,
    forceRunQueue: new Map(),
    statsSamples: [],
    tuneEvents: [],
  };
}

function state(): BrainStateInternal {
  if (!g.__omniscientBrain) g.__omniscientBrain = freshState();
  // Hot-reload migration: if the cached state predates a new field OR a field's
  // type changed (e.g. forceRunQueue Set→Map), backfill/replace it so a stale
  // singleton from a previous code version doesn't crash. Each field needs a
  // guard here that checks BOTH existence AND the expected type.
  const s = g.__omniscientBrain;
  if (!s.statsSamples) s.statsSamples = [];
  if (!s.tuneEvents) s.tuneEvents = [];
  if (!(s.forceRunQueue instanceof Map)) s.forceRunQueue = new Map();
  // Nested stats fields added later — backfill on the existing stats object
  // rather than resetting it (which would lose ticksTotal/tokensUsed).
  if (s.stats.triggersNews == null) s.stats.triggersNews = 0;
  if (s.stats.triggersCrossAsset == null) s.stats.triggersCrossAsset = 0;
  if (s.stats.triggersManual == null) s.stats.triggersManual = 0;
  return s;
}

// Hydration: pull persisted control flags from the Setting KV on first use.
// Stats/watch stay ephemeral (they rebuild from live data). Non-fatal on error.
export async function hydrate(): Promise<void> {
  const s = state();
  if (s.hydrated) return;
  try {
    const persisted = await getSetting<Partial<{ running: boolean; mode: BrainMode; config: Partial<BrainConfig> }>>(SETTING_KEYS.brainState, {});
    if (typeof persisted.running === 'boolean') s.running = persisted.running;
    if (persisted.mode === 'auto' || persisted.mode === 'manual') s.mode = persisted.mode;
    if (persisted.config) s.config = { ...DEFAULT_CONFIG, ...persisted.config };
  } catch { /* ephemeral defaults are fine */ }
  s.hydrated = true;
}

async function persist(): Promise<void> {
  const s = state();
  try {
    await setSetting(SETTING_KEYS.brainState, { running: s.running, mode: s.mode, config: s.config });
  } catch { /* non-fatal */ }
}

// --- Public control API (used by /api/brain) ---
export async function setRunning(on: boolean): Promise<void> {
  state().running = on;
  await persist();
}
export async function setMode(mode: BrainMode): Promise<void> {
  state().mode = mode;
  await persist();
}
export async function setConfig(patch: Partial<BrainConfig>): Promise<void> {
  const s = state();
  s.config = { ...s.config, ...patch };
  await persist();
}
export function isRunning(): boolean {
  return state().running;
}
export function getMode(): BrainMode {
  return state().mode;
}

// Force a re-analysis of an asset on the next tick, regardless of the gate.
// `source` records WHY (manual | news | cross-asset) so the resulting signal
// can be stamped with its trigger for operator traceability. Works even when
// the autonomous brain is paused — this is the manual override.
export function forceRun(symbol: string, source: 'manual' | 'news' | 'cross-asset' = 'manual'): void {
  const s = state();
  const sym = symbol.toUpperCase();
  s.forceRunQueue.set(sym, source);
  const w = s.watch.get(sym);
  if (w) {
    w.lastAnalyzedAt = 0;
    w.lastDataSig = '';
    w.lastVerdict = undefined;
  }
}

/** Drain the force-run queue. Returns symbol→source pairs to deep-analyze this tick. */
export function consumeForceRunQueue(): { symbol: string; source: string }[] {
  const s = state();
  const out = Array.from(s.forceRunQueue.entries()).map(([symbol, source]) => ({ symbol, source }));
  s.forceRunQueue.clear();
  return out;
}

// Reset the token budget window immediately (operator override).
export function resetBudget(): void {
  const s = state();
  s.budgetUsed = 0;
  s.budgetWindowStart = Date.now();
}

// --- Budget: rolling window. When used >= cap, the gate downshifts to
// deterministic-only. Hard ceiling that keeps a free tier alive.
export function budgetRemaining(): number {
  const s = state();
  const now = Date.now();
  if (now - s.budgetWindowStart > s.config.budgetWindowMs) {
    s.budgetWindowStart = now;
    s.budgetUsed = 0;
  }
  return Math.max(0, s.config.budgetCap - s.budgetUsed);
}
export function budgetExhausted(): boolean {
  return budgetRemaining() <= 0;
}
function spendBudget(tokens: number): void {
  state().budgetUsed += tokens;
}

// --- Global LLM cooldown: when the active LLM provider rate-limits us (429),
// we pause ALL LLM calls for a short window. This is the fix for the
// "thundering herd" problem: without it, an 11-asset scan after back-off
// expires fires 11 simultaneous requests and they ALL get 429'd again. With
// it, the first 429 trips a global circuit-breaker; subsequent assets in the
// same scan (and the next scan, if within the window) skip the LLM and use
// the deterministic consensus instead. One failure → one cooldown, not eleven.
let llmCooldownUntil = 0;
let llmConsecutiveFailures = 0;

/** True if the global LLM circuit-breaker is tripped (rate-limited recently). */
export function llmInCooldown(): boolean {
  return Date.now() < llmCooldownUntil;
}
/** When the current cooldown ends (epoch ms), or 0 if not cooling down. */
export function llmCooldownUntilTs(): number {
  return llmCooldownUntil;
}
/**
 * Record an LLM failure. Trip the circuit-breaker with exponential back-off:
 * 1st failure → 30s, 2nd → 60s, 3rd+ → 120s. Capped at 120s so the brain
 * never stays down for long. Reset on the first success.
 */
export function recordLlmFailure(): void {
  llmConsecutiveFailures++;
  const backoff = Math.min(120_000, 30_000 * Math.pow(2, llmConsecutiveFailures - 1));
  llmCooldownUntil = Date.now() + backoff;
  console.log(`[brain] LLM failure #${llmConsecutiveFailures} → global cooldown ${backoff / 1000}s`);
}
/** Record an LLM success — clears the consecutive-failure counter. */
export function recordLlmSuccess(): void {
  llmConsecutiveFailures = 0;
}

// --- Watch cache: per-asset last-read of the market ---
export function getWatch(symbol: string): AssetWatch | undefined {
  return state().watch.get(symbol);
}
export function setWatch(w: AssetWatch): void {
  state().watch.set(w.symbol, w);
}
export function allWatch(): AssetWatch[] {
  return Array.from(state().watch.values()).sort((a, b) => b.lastNoteworthiness - a.lastNoteworthiness);
}

// --- Stats + action log ---
// Thinking state — tracks whether a tick is in progress + the last tick's
// duration. Powers the "Brain thinking" live indicator so operators see the
// brain actively processing, not just static stats.
let tickStartTs = 0;
let lastTickDurationMs = 0;

export function tickStarted(): void {
  const s = state();
  s.stats.ticksTotal++;
  s.stats.lastTickAt = Date.now();
  tickStartTs = Date.now();
}

/** Mark the tick complete — records how long it took. Call at the end of POST. */
export function tickEnded(): void {
  if (tickStartTs > 0) {
    lastTickDurationMs = Date.now() - tickStartTs;
    tickStartTs = 0;
  }
}

/** True if a tick is currently in progress (the brain is "thinking"). */
export function isThinking(): boolean {
  return tickStartTs > 0 && Date.now() - tickStartTs < 30000; // sanity cap: a tick >30s is stuck
}

/** How long the last completed tick took (ms). 0 if none has finished. */
export function lastTickDuration(): number {
  return lastTickDurationMs;
}

/**
 * Snapshot the current cumulative stats into the timeline ring buffer. Called
 * once per tick (at the end of tickStarted's sibling, by the scheduler) so the
 * savings sparkline has a fresh point every minute. Capped at MAX_SAMPLES.
 */
export function recordSample(): void {
  const s = state();
  s.statsSamples.push({
    ts: Date.now(),
    tokensUsed: s.stats.tokensUsed,
    tokensSaved: s.stats.tokensSaved,
    llmCalls: s.stats.llmCallsTotal,
    skips: s.stats.llmCallsSkipped + s.stats.budgetSkips,
  });
  if (s.statsSamples.length > MAX_SAMPLES) s.statsSamples.shift();
}

/** The token-economy timeline — newest last. Empty until the first tick. */
export function getSamples(): StatsSample[] {
  return state().statsSamples;
}
export function recordLlmCall(tokens: number): void {
  const s = state();
  s.stats.llmCallsTotal++;
  s.stats.tokensUsed += tokens;
  spendBudget(tokens);
}
export function recordSkip(estimatedSavedTokens: number): void {
  const s = state();
  s.stats.llmCallsSkipped++;
  s.stats.tokensSaved += estimatedSavedTokens;
}
export function recordCacheHit(estimatedSavedTokens: number): void {
  const s = state();
  s.stats.cacheHits++;
  s.stats.tokensSaved += estimatedSavedTokens;
}
export function recordBudgetSkip(estimatedSavedTokens: number): void {
  // NOTE: does NOT add to tokensSaved — the companion recordSkip() call already
  // does that. recordBudgetSkip only counts the budget-skip counter so the
  // scoreboard can show "unanimous + budget" breakdown. (Previously both added
  // to tokensSaved, double-counting — fixed.)
  void estimatedSavedTokens;
  state().stats.budgetSkips++;
}
export function recordAlert(): void {
  state().stats.alertsSent++;
}

/** Record an autonomy trigger firing — counts by source for the trigger-stats tile. */
export function recordTrigger(source: 'news' | 'cross-asset' | 'manual'): void {
  const s = state();
  if (source === 'news') s.stats.triggersNews++;
  else if (source === 'cross-asset') s.stats.triggersCrossAsset++;
  else s.stats.triggersManual++;
}

/** Record a self-tuning threshold nudge — powers the self-tune history chart. */
export function recordTuneEvent(e: Omit<TuneEvent, 'ts'>): void {
  const s = state();
  s.tuneEvents.push({ ...e, ts: Date.now() });
  if (s.tuneEvents.length > MAX_TUNE_EVENTS) s.tuneEvents.shift();
}

/** The self-tune history — newest last. Empty until the first nudge (needs grades). */
export function getTuneEvents(): TuneEvent[] {
  return state().tuneEvents;
}
export function recordAction(a: Omit<BrainAction, 'ts'>): void {
  const s = state();
  s.recentActions.unshift({ ...a, ts: Date.now() });
  if (s.recentActions.length > 60) s.recentActions.length = 60;
}
export function recentActions(): BrainAction[] {
  return state().recentActions;
}
export function getStats(): BrainStats {
  return state().stats;
}
export function getConfig(): BrainConfig {
  return state().config;
}

// Full snapshot for the control-panel API + UI.
export function snapshot() {
  const s = state();
  return {
    running: s.running,
    mode: s.mode,
    config: s.config,
    budget: { cap: s.config.budgetCap, used: s.budgetUsed, remaining: budgetRemaining(), windowMs: s.config.budgetWindowMs, windowStart: s.budgetWindowStart },
    llm: { inCooldown: llmInCooldown(), cooldownUntil: llmCooldownUntilTs(), consecutiveFailures: llmConsecutiveFailures },
    thinking: isThinking(),
    lastTickDurationMs: lastTickDuration(),
    stats: s.stats,
    samples: s.statsSamples,
    tuneEvents: s.tuneEvents,
    watch: allWatch(),
    recentActions: s.recentActions,
  };
}
