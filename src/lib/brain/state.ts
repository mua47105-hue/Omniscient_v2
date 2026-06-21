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
  // Manual override queue: symbols the operator force-ran. Processed even when
  // the autonomous brain is paused, and always at deep tier (bypass the gate).
  forceRunQueue: Set<string>;
}

const g = globalThis as unknown as { __omniscientBrain?: BrainStateInternal };

function freshState(): BrainStateInternal {
  const now = Date.now();
  return {
    running: true,
    mode: 'auto',
    config: { ...DEFAULT_CONFIG },
    watch: new Map(),
    stats: { ticksTotal: 0, llmCallsTotal: 0, llmCallsSkipped: 0, cacheHits: 0, budgetSkips: 0, tokensUsed: 0, tokensSaved: 0, alertsSent: 0, lastTickAt: null, startedAt: now },
    budgetUsed: 0,
    budgetWindowStart: now,
    recentActions: [],
    hydrated: false,
    forceRunQueue: new Set(),
  };
}

function state(): BrainStateInternal {
  if (!g.__omniscientBrain) g.__omniscientBrain = freshState();
  return g.__omniscientBrain;
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
// Queues the symbol + clears its cached verdict so the gate can't skip it.
// Works even when the autonomous brain is paused — this is the manual override.
export function forceRun(symbol: string): void {
  const s = state();
  const sym = symbol.toUpperCase();
  s.forceRunQueue.add(sym);
  const w = s.watch.get(sym);
  if (w) {
    w.lastAnalyzedAt = 0;
    w.lastDataSig = '';
    w.lastVerdict = undefined;
  }
}

/** Drain the force-run queue. Returns the symbols to deep-analyze this tick. */
export function consumeForceRunQueue(): string[] {
  const s = state();
  const out = Array.from(s.forceRunQueue);
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
export function tickStarted(): void {
  const s = state();
  s.stats.ticksTotal++;
  s.stats.lastTickAt = Date.now();
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
  const s = state();
  s.stats.budgetSkips++;
  s.stats.tokensSaved += estimatedSavedTokens;
}
export function recordAlert(): void {
  state().stats.alertsSent++;
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
    stats: s.stats,
    watch: allWatch(),
    recentActions: s.recentActions,
  };
}
