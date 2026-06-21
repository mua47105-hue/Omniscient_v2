/**
 * Lazy Brain — in-memory state singleton.
 *
 * Lives on `globalThis` so it survives Next.js 16 / Turbopack hot reloads.
 * Control flags (running/mode/config) are persisted to the Setting KV table
 * via `hydrate()` on first touch (see `src/lib/config/settings.ts`).
 *
 * Hot-reload safety:
 *  `state()` runs a migration pass on every call — each field is checked for
 *  existence AND type. A previous regression where `forceRunQueue` was changed
 *  from Set→Map crashed the dev server on hot reload; the `instanceof Map`
 *  guard below prevents that class of bug. Nested stats fields need their own
 *  guards (`if (s.stats.triggersNews == null) s.stats.triggersNews = 0`).
 */

import type { BrainConfig, BrainMode } from './types';
import { defaultBrainConfig } from './config';

// ---------------------------------------------------------------------------
// Public types (re-exported for callers)
// ---------------------------------------------------------------------------

export type { BrainConfig, BrainMode } from './types';
export type {
  AssetWatch,
  BrainStats,
  BrainAction,
  StatsSample,
  TuneEvent,
  TriggerSource,
} from './types';
import type {
  AssetWatch,
  BrainStats,
  BrainAction,
  StatsSample,
  TuneEvent,
  TriggerSource,
} from './types';

// ---------------------------------------------------------------------------
// Internal brain state (never serialised directly — `snapshot()` is the API)
// ---------------------------------------------------------------------------

interface BrainState {
  // Control
  running: boolean;
  mode: BrainMode;
  config: BrainConfig;
  hydrated: boolean;

  // Per-asset watch (last verdict / noteworthiness / regime / action)
  watch: Map<string, AssetWatch>;

  // Cumulative stats
  stats: BrainStats;

  // Rolling token budget
  budgetUsed: number;
  budgetWindowStart: number;

  // Recent action feed (capped 60)
  recentActions: BrainAction[];

  // Manual/news/cross-asset override queue
  forceRunQueue: Map<string, TriggerSource>;

  // Sparkline ring buffer (capped 120)
  statsSamples: StatsSample[];

  // Self-tune history (capped 50)
  tuneEvents: TuneEvent[];

  // LLM circuit-breaker (global cooldown, exponential backoff)
  llmCooldownUntil: number;
  llmConsecutiveFailures: number;

  // "Brain thinking" indicator
  tickStartTs: number;
  lastTickDurationMs: number;

  // Per-tick delta counters (reset by recordSample). NOT part of BrainStats —
  // these feed the llmCalls/skips columns of the next StatsSample.
  _tickLlmCalls: number;
  _tickSkips: number;
}

interface GlobalWithBrain {
  __OMNISCIENT_BRAIN__?: BrainState;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECENT_ACTIONS = 60;
const MAX_SAMPLES = 120;
const MAX_TUNE_EVENTS = 50;
const MAX_SEEN_ARTICLES = 500;

const LLM_COOLDOWN_BASE_MS = 30_000; // 30s on first failure
const LLM_COOLDOWN_MAX_MS = 120_000; // cap at 2min

// ---------------------------------------------------------------------------
// Fresh-state factory
// ---------------------------------------------------------------------------

function freshStats(): BrainStats {
  return {
    ticksTotal: 0,
    llmCallsTotal: 0,
    tokensUsed: 0,
    tokensSaved: 0,
    cacheHits: 0,
    budgetSkips: 0,
    triggersNews: 0,
    triggersCrossAsset: 0,
    triggersManual: 0,
    alertsSent: 0,
  };
}

function freshState(): BrainState {
  return {
    running: false,
    mode: 'auto',
    config: defaultBrainConfig(),
    hydrated: false,
    watch: new Map(),
    stats: freshStats(),
    budgetUsed: 0,
    budgetWindowStart: Date.now(),
    recentActions: [],
    forceRunQueue: new Map(),
    statsSamples: [],
    tuneEvents: [],
    llmCooldownUntil: 0,
    llmConsecutiveFailures: 0,
    tickStartTs: 0,
    lastTickDurationMs: 0,
    _tickLlmCalls: 0,
    _tickSkips: 0,
  };
}

// ---------------------------------------------------------------------------
// Singleton accessor with hot-reload migration guards
// ---------------------------------------------------------------------------

function state(): BrainState {
  const g = globalThis as unknown as GlobalWithBrain;
  if (!g.__OMNISCIENT_BRAIN__) {
    g.__OMNISCIENT_BRAIN__ = freshState();
    return g.__OMNISCIENT_BRAIN__;
  }
  const s = g.__OMNISCIENT_BRAIN__!;

  // Each guard checks BOTH existence AND type. The `instanceof Map` checks are
  // critical — a previous regression where forceRunQueue was changed from Set
  // to Map crashed the dev server on hot reload.
  if (typeof s.running !== 'boolean') s.running = false;
  if (s.mode !== 'auto' && s.mode !== 'manual') s.mode = 'auto';
  if (!s.config || typeof s.config !== 'object') s.config = defaultBrainConfig();
  if (!(s.watch instanceof Map)) s.watch = new Map();
  if (!s.stats || typeof s.stats !== 'object') s.stats = freshStats();
  // Nested stats guards
  if (typeof s.stats.ticksTotal !== 'number') s.stats.ticksTotal = 0;
  if (typeof s.stats.llmCallsTotal !== 'number') s.stats.llmCallsTotal = 0;
  if (typeof s.stats.tokensUsed !== 'number') s.stats.tokensUsed = 0;
  if (typeof s.stats.tokensSaved !== 'number') s.stats.tokensSaved = 0;
  if (typeof s.stats.cacheHits !== 'number') s.stats.cacheHits = 0;
  if (typeof s.stats.budgetSkips !== 'number') s.stats.budgetSkips = 0;
  if (s.stats.triggersNews == null) s.stats.triggersNews = 0;
  if (s.stats.triggersCrossAsset == null) s.stats.triggersCrossAsset = 0;
  if (s.stats.triggersManual == null) s.stats.triggersManual = 0;
  if (typeof s.stats.alertsSent !== 'number') s.stats.alertsSent = 0;
  if (typeof s.budgetUsed !== 'number') s.budgetUsed = 0;
  if (typeof s.budgetWindowStart !== 'number') s.budgetWindowStart = Date.now();
  if (!Array.isArray(s.recentActions)) s.recentActions = [];
  if (typeof s.hydrated !== 'boolean') s.hydrated = false;
  if (!(s.forceRunQueue instanceof Map)) s.forceRunQueue = new Map();
  if (!Array.isArray(s.statsSamples)) s.statsSamples = [];
  if (!Array.isArray(s.tuneEvents)) s.tuneEvents = [];
  if (typeof s.llmCooldownUntil !== 'number') s.llmCooldownUntil = 0;
  if (typeof s.llmConsecutiveFailures !== 'number') s.llmConsecutiveFailures = 0;
  if (typeof s.tickStartTs !== 'number') s.tickStartTs = 0;
  if (typeof s.lastTickDurationMs !== 'number') s.lastTickDurationMs = 0;
  if (typeof s._tickLlmCalls !== 'number') s._tickLlmCalls = 0;
  if (typeof s._tickSkips !== 'number') s._tickSkips = 0;

  return s;
}

// ---------------------------------------------------------------------------
// Hydration (load running/mode/config from Setting KV on first touch)
// ---------------------------------------------------------------------------

const SETTING_KEYS = {
  running: 'brain.running',
  mode: 'brain.mode',
  config: 'brain.config',
} as const;

/**
 * Load persisted control flags from the Setting KV table. Best-effort — if the
 * DB is unavailable we fall back to in-memory defaults. Only runs once per
 * process (guarded by `hydrated`).
 */
export async function hydrate(): Promise<void> {
  const s = state();
  if (s.hydrated) return;
  try {
    // Lazy import to avoid pulling Prisma into pure-logic test paths.
    const { db } = await import('@/lib/db');
    const rows = await db.setting.findMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
    });
    const kv: Record<string, string> = {};
    for (const r of rows) kv[r.key] = r.value;
    if (kv[SETTING_KEYS.running] != null) s.running = kv[SETTING_KEYS.running] === 'true';
    const mode = kv[SETTING_KEYS.mode];
    if (mode === 'auto' || mode === 'manual') s.mode = mode;
    if (kv[SETTING_KEYS.config]) {
      try {
        const parsed = JSON.parse(kv[SETTING_KEYS.config]);
        s.config = { ...defaultBrainConfig(), ...parsed };
      } catch {
        /* keep default */
      }
    }
  } catch {
    /* DB unavailable — keep defaults */
  }
  s.hydrated = true;
}

async function persist(key: string, value: string): Promise<void> {
  try {
    const { db } = await import('@/lib/db');
    await db.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Control flags
// ---------------------------------------------------------------------------

export function setRunning(running: boolean): void {
  const s = state();
  s.running = running;
  void persist(SETTING_KEYS.running, String(running));
}

/** Read the running flag without going through hydrate(). */
export function isRunning(): boolean {
  return state().running;
}

/** Alias for callers that prefer the get-prefixed convention. */
export function getRunning(): boolean {
  return state().running;
}

export function setMode(mode: BrainMode): void {
  const s = state();
  s.mode = mode;
  void persist(SETTING_KEYS.mode, mode);
}

export function getMode(): BrainMode {
  return state().mode;
}

export function setConfig(patch: Partial<BrainConfig>): void {
  const s = state();
  s.config = { ...s.config, ...patch };
  void persist(SETTING_KEYS.config, JSON.stringify(s.config));
}

export function getConfig(): BrainConfig {
  return state().config;
}

// ---------------------------------------------------------------------------
// Force-run queue
// ---------------------------------------------------------------------------

export function forceRun(symbol: string, source: TriggerSource): void {
  state().forceRunQueue.set(symbol, source);
}

/** Drain the queue (returns a copy). Caller processes then this clears. */
export function consumeForceRunQueue(): Map<string, TriggerSource> {
  const s = state();
  const copy = new Map(s.forceRunQueue);
  s.forceRunQueue.clear();
  return copy;
}

// ---------------------------------------------------------------------------
// Budget (rolling token window)
// ---------------------------------------------------------------------------

export function resetBudget(): void {
  const s = state();
  s.budgetUsed = 0;
  s.budgetWindowStart = Date.now();
}

function rollBudgetWindow(now: number): void {
  const s = state();
  if (now - s.budgetWindowStart >= s.config.budgetWindowMs) {
    s.budgetUsed = 0;
    s.budgetWindowStart = now;
  }
}

export function budgetRemaining(): number {
  const s = state();
  rollBudgetWindow(Date.now());
  return Math.max(0, s.config.budgetCap - s.budgetUsed);
}

export function budgetExhausted(): boolean {
  return budgetRemaining() <= 0;
}

// ---------------------------------------------------------------------------
// Watch (per-asset last verdict)
// ---------------------------------------------------------------------------

export function getWatch(symbol: string): AssetWatch | undefined {
  return state().watch.get(symbol);
}

export function setWatch(w: AssetWatch): void {
  state().watch.set(w.symbol, w);
}

export function allWatch(): AssetWatch[] {
  return Array.from(state().watch.values());
}

// ---------------------------------------------------------------------------
// Thinking indicator
// ---------------------------------------------------------------------------

export function tickStarted(): void {
  const s = state();
  s.tickStartTs = Date.now();
  s.stats.ticksTotal++;
}

export function tickEnded(): void {
  const s = state();
  if (s.tickStartTs > 0) {
    s.lastTickDurationMs = Date.now() - s.tickStartTs;
    s.tickStartTs = 0;
  }
}

export function isThinking(): boolean {
  return state().tickStartTs > 0;
}

export function lastTickDuration(): number {
  return state().lastTickDurationMs;
}

// ---------------------------------------------------------------------------
// LLM circuit-breaker (global cooldown, exponential 30s→60s→120s)
// ---------------------------------------------------------------------------

export function llmInCooldown(): boolean {
  return Date.now() < state().llmCooldownUntil;
}

export function llmCooldownUntilTs(): number {
  return state().llmCooldownUntil;
}

/** Trip the breaker. Exponential backoff: 30s → 60s → 120s (capped). */
export function recordLlmFailure(): void {
  const s = state();
  s.llmConsecutiveFailures++;
  const n = s.llmConsecutiveFailures;
  const backoff = Math.min(LLM_COOLDOWN_MAX_MS, LLM_COOLDOWN_BASE_MS * Math.pow(2, n - 1));
  s.llmCooldownUntil = Date.now() + backoff;
}

export function recordLlmSuccess(): void {
  const s = state();
  s.llmConsecutiveFailures = 0;
  s.llmCooldownUntil = 0;
}

// ---------------------------------------------------------------------------
// Stat recorders
// ---------------------------------------------------------------------------

export function recordLlmCall(tokensUsed: number): void {
  const s = state();
  s.stats.llmCallsTotal++;
  s.stats.tokensUsed += tokensUsed || 0;
  s.budgetUsed += tokensUsed || 0;
  s._tickLlmCalls++;
}

/**
 * Record a skip (YAGNI/cache/cadence). Adds the estimated tokens saved to the
 * cumulative counter so the dashboard sparkline reflects real economy.
 */
export function recordSkip(estimatedSavedTokens: number): void {
  const s = state();
  s.stats.tokensSaved += estimatedSavedTokens || 0;
  s._tickSkips++;
}

export function recordCacheHit(estimatedSavedTokens: number): void {
  const s = state();
  s.stats.cacheHits++;
  s.stats.tokensSaved += estimatedSavedTokens || 0;
}

/**
 * Budget-skip. NOTE: does NOT add to tokensSaved — the companion recordSkip
 * already handles tokensSaved for skip-actions. This only bumps the
 * budgetSkips counter (separate metric for the dashboard).
 */
export function recordBudgetSkip(): void {
  state().stats.budgetSkips++;
}

export function recordAlert(): void {
  state().stats.alertsSent++;
}

export function recordTrigger(source: TriggerSource): void {
  const s = state();
  if (source === 'news') s.stats.triggersNews++;
  else if (source === 'cross-asset') s.stats.triggersCrossAsset++;
  else if (source === 'manual') s.stats.triggersManual++;
}

// ---------------------------------------------------------------------------
// Self-tune event log
// ---------------------------------------------------------------------------

export function recordTuneEvent(ev: Omit<TuneEvent, 'ts'>): void {
  const s = state();
  s.tuneEvents.push({ ...ev, ts: Date.now() });
  if (s.tuneEvents.length > MAX_TUNE_EVENTS) s.tuneEvents.shift();
}

export function getTuneEvents(): TuneEvent[] {
  return state().tuneEvents.slice();
}

// ---------------------------------------------------------------------------
// Sparkline samples
// ---------------------------------------------------------------------------

export function recordSample(): void {
  const s = state();
  s.statsSamples.push({
    ts: Date.now(),
    tokensUsed: s.stats.tokensUsed,
    tokensSaved: s.stats.tokensSaved,
    llmCalls: s._tickLlmCalls,
    skips: s._tickSkips,
  });
  if (s.statsSamples.length > MAX_SAMPLES) s.statsSamples.shift();
  // reset per-tick deltas
  s._tickLlmCalls = 0;
  s._tickSkips = 0;
}

export function getSamples(): StatsSample[] {
  return state().statsSamples.slice();
}

// ---------------------------------------------------------------------------
// Action feed
// ---------------------------------------------------------------------------

export function recordAction(a: Omit<BrainAction, 'ts'>): void {
  const s = state();
  s.recentActions.push({ ...a, ts: Date.now() });
  if (s.recentActions.length > MAX_RECENT_ACTIONS) s.recentActions.shift();
}

export function recentActions(): BrainAction[] {
  return state().recentActions.slice();
}

export function getStats(): BrainStats {
  return { ...state().stats };
}

// ---------------------------------------------------------------------------
// Snapshot — the single serialisable view consumed by the brain API + UI
// ---------------------------------------------------------------------------

export interface BrainSnapshot {
  running: boolean;
  mode: BrainMode;
  config: BrainConfig;
  hydrated: boolean;
  budgetUsed: number;
  budgetWindowStart: number;
  budgetCap: number;
  budgetRemaining: number;
  budgetExhausted: boolean;
  llmCooldownUntil: number;
  llmInCooldown: boolean;
  llmConsecutiveFailures: number;
  thinking: boolean;
  tickStartTs: number;
  lastTickDurationMs: number;
  stats: BrainStats;
  watch: AssetWatch[];
  recentActions: BrainAction[];
  statsSamples: StatsSample[];
  tuneEvents: TuneEvent[];
  forceRunQueue: Array<[string, TriggerSource]>;
}

export function snapshot(): BrainSnapshot {
  const s = state();
  rollBudgetWindow(Date.now());
  return {
    running: s.running,
    mode: s.mode,
    config: s.config,
    hydrated: s.hydrated,
    budgetUsed: s.budgetUsed,
    budgetWindowStart: s.budgetWindowStart,
    budgetCap: s.config.budgetCap,
    budgetRemaining: Math.max(0, s.config.budgetCap - s.budgetUsed),
    budgetExhausted: s.budgetUsed >= s.config.budgetCap,
    llmCooldownUntil: s.llmCooldownUntil,
    llmInCooldown: Date.now() < s.llmCooldownUntil,
    llmConsecutiveFailures: s.llmConsecutiveFailures,
    thinking: s.tickStartTs > 0,
    tickStartTs: s.tickStartTs,
    lastTickDurationMs: s.lastTickDurationMs,
    stats: { ...s.stats },
    watch: Array.from(s.watch.values()),
    recentActions: s.recentActions.slice(),
    statsSamples: s.statsSamples.slice(),
    tuneEvents: s.tuneEvents.slice(),
    forceRunQueue: Array.from(s.forceRunQueue.entries()),
  };
}

// ---------------------------------------------------------------------------
// Test helper — wipes the singleton. NOT used in production code paths.
// ---------------------------------------------------------------------------

export function __resetForTests(): void {
  const g = globalThis as unknown as GlobalWithBrain;
  g.__OMNISCIENT_BRAIN__ = freshState();
}
