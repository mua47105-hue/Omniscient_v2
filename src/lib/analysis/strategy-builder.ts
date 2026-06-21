/**
 * Strategy Builder — pure-TypeScript mapping + helpers.
 *
 * Bridges the Screener's 14 technical filters (`TECHNICAL_FILTERS`) and the
 * Backtester's rule system (`ENTRY_RULES` / `EXIT_RULES`) so the wizard can:
 *   1. Let users define a strategy using the screener's friendly filter chips.
 *   2. Translate those filters into the backtester's rule keys (where possible).
 *   3. Run `runBacktest()` against historical klines.
 *   4. Re-use the screener scan API to find live matches for deployment.
 *
 * No React/DOM dependencies — safe to import from server components / API
 * routes / pure logic tests.
 */

import type { BacktestResult } from '@/lib/analysis/backtest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategyDefinition {
  /** Stable id (uuid-ish). */
  id: string;
  name: string;
  description: string;
  /** Asset universe (symbols) the strategy scans/deploy on. */
  universe: string[];
  /** Screener filter keys used as entry conditions (e.g. 'rsi_oversold'). */
  entryConditions: string[];
  /** Screener filter keys used as exit conditions (e.g. 'rsi_overbought'). */
  exitConditions: string[];
  /** Hard stop-loss % (1..15). */
  stopLossPct: number;
  /** Take-profit % (2..30). */
  takeProfitPct: number;
  /** Position size % of equity per trade (1..25). */
  positionSizePct: number;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last edit. */
  updatedAt: string;
  /** Last backtest snapshot (optional — only set after running). */
  lastBacktest?: BacktestSnapshot;
}

export interface BacktestSnapshot {
  symbol: string;
  timeframe: string;
  period: string;
  totalReturnPct: number;
  winRate: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  totalTrades: number;
  avgHoldDays: number;
  ranAt: string;
}

export interface StrategySummary {
  valid: boolean;
  entryCount: number;
  exitCount: number;
  /** Take-profit / stop-loss ratio (1.x = TP > SL). */
  rrRatio: number;
  riskLevel: 'conservative' | 'balanced' | 'aggressive';
  /** List of validation errors (empty if `valid`). */
  errors: string[];
}

export interface MappedRules {
  /** Backtester entry-rule keys (excludes stop_loss / take_profit). */
  entryRules: string[];
  /** Backtester exit-rule keys (always includes stop_loss + take_profit). */
  exitRules: string[];
  /** Screener filter keys that couldn't be mapped to a backtest rule. */
  unmapped: string[];
}

// ---------------------------------------------------------------------------
// Screener → Backtest rule mapping
// ---------------------------------------------------------------------------
//
// The screener's filter tests run on `TechnicalIndicators` objects, while the
// backtester has its own rule system with stricter entry/exit rules. We map
// each screener filter to its closest backtester equivalent.
//
// Not all screener filters map cleanly — `bollinger_squeeze`, `near_support`,
// `near_resistance`, and `golden_cross`/`death_cross` have no precise backtest
// equivalent. Those are returned in `unmapped` so the UI can warn the user.

export const SCREENER_TO_BACKTEST_MAP: Record<string, string> = {
  // Entry-side bullish filters
  rsi_oversold: 'rsi_lt_30',
  macd_bullish: 'macd_bullish_cross',
  above_ema50: 'price_gt_ema50',
  golden_cross: 'price_gt_ema50', // approx — confirms uptrend
  bullish_trend: 'price_gt_ema50', // approx — same intent
  volume_spike: 'volume_gt_2x_avg',

  // Exit-side bearish filters
  rsi_overbought: 'rsi_gt_70',
  macd_bearish: 'macd_bearish_cross',
  below_ema50: 'price_lt_ema50',
  death_cross: 'price_lt_ema50', // approx — confirms downtrend
  bearish_trend: 'price_lt_ema50', // approx — same intent

  // Unmapped (no precise backtest equivalent):
  //   - bollinger_squeeze (squeeze ≠ touch)
  //   - near_support / near_resistance (no S/R logic in backtester)
};

/**
 * Map a list of screener filter keys into backtester entry + exit rule keys.
 *
 * The caller passes the strategy's selected entry conditions and exit
 * conditions separately (both are screener filter keys). The function maps
 * each filter to its backtest equivalent, deduplicates, and returns the
 * unmapped filters so the UI can warn the user.
 *
 * `stop_loss` and `take_profit` are always appended to `exitRules` — the
 * backtester handles them inline using the strategy's SL/TP percentages.
 */
export function mapScreenerToBacktest(
  screenerEntryFilters: string[],
  screenerExitFilters: string[],
): MappedRules {
  const entryRules: string[] = [];
  const exitRules: string[] = [];
  const unmapped: string[] = [];

  const seen = new Set<string>();
  const pushUnique = (arr: string[], key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      arr.push(key);
    }
  };

  for (const key of screenerEntryFilters) {
    const mapped = SCREENER_TO_BACKTEST_MAP[key];
    if (mapped) pushUnique(entryRules, mapped);
    else unmapped.push(key);
  }

  for (const key of screenerExitFilters) {
    const mapped = SCREENER_TO_BACKTEST_MAP[key];
    if (mapped) pushUnique(exitRules, mapped);
    else unmapped.push(key);
  }

  // Always include the hard SL/TP — the backtester will read the strategy's
  // percentages and apply them intrabar.
  pushUnique(exitRules, 'stop_loss');
  pushUnique(exitRules, 'take_profit');

  return { entryRules, exitRules, unmapped };
}

// ---------------------------------------------------------------------------
// Validation + summary
// ---------------------------------------------------------------------------

export const STRATEGY_VALIDATION = {
  /** Must have ≥1 entry condition. */
  minEntries: 1,
  /** Must have ≥1 exit condition. */
  minExits: 1,
  minStopLossPct: 0.1,
  maxStopLossPct: 15,
  minTakeProfitPct: 0.1,
  maxTakeProfitPct: 30,
  minPositionSizePct: 0.1,
  maxPositionSizePct: 25,
};

/**
 * Build a UI-facing summary + validation result for a strategy.
 *
 * `valid` requires:
 *   - ≥1 entry condition
 *   - ≥1 exit condition
 *   - 0 < SL ≤ 15
 *   - 0 < TP ≤ 30
 *   - 0 < positionSize ≤ 25
 */
export function buildStrategySummary(strategy: {
  entryConditions: string[];
  exitConditions: string[];
  stopLossPct: number;
  takeProfitPct: number;
  positionSizePct: number;
}): StrategySummary {
  const errors: string[] = [];

  if (strategy.entryConditions.length < STRATEGY_VALIDATION.minEntries) {
    errors.push('At least 1 entry condition is required.');
  }
  if (strategy.exitConditions.length < STRATEGY_VALIDATION.minExits) {
    errors.push('At least 1 exit condition is required.');
  }
  if (
    strategy.stopLossPct < STRATEGY_VALIDATION.minStopLossPct ||
    strategy.stopLossPct > STRATEGY_VALIDATION.maxStopLossPct
  ) {
    errors.push('Stop-loss must be between 0.1% and 15%.');
  }
  if (
    strategy.takeProfitPct < STRATEGY_VALIDATION.minTakeProfitPct ||
    strategy.takeProfitPct > STRATEGY_VALIDATION.maxTakeProfitPct
  ) {
    errors.push('Take-profit must be between 0.1% and 30%.');
  }
  if (
    strategy.positionSizePct < STRATEGY_VALIDATION.minPositionSizePct ||
    strategy.positionSizePct > STRATEGY_VALIDATION.maxPositionSizePct
  ) {
    errors.push('Position size must be between 0.1% and 25%.');
  }

  const rrRatio =
    strategy.stopLossPct > 0
      ? strategy.takeProfitPct / strategy.stopLossPct
      : 0;

  // Risk level tiers based on position size + SL.
  const riskBudget =
    (strategy.positionSizePct / 100) * (strategy.stopLossPct / 100) * 100; // % of equity at risk per trade
  let riskLevel: StrategySummary['riskLevel'] = 'balanced';
  if (riskBudget < 0.5) riskLevel = 'conservative';
  else if (riskBudget > 1.5) riskLevel = 'aggressive';

  return {
    valid: errors.length === 0,
    entryCount: strategy.entryConditions.length,
    exitCount: strategy.exitConditions.length,
    rrRatio,
    riskLevel,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Default asset universe (top 10 crypto by liquidity)
// ---------------------------------------------------------------------------

export const DEFAULT_UNIVERSE: string[] = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'ADAUSDT',
  'DOGEUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'DOTUSDT',
];

// ---------------------------------------------------------------------------
// localStorage persistence helpers (called client-side only)
// ---------------------------------------------------------------------------

export const STRATEGIES_STORAGE_KEY = 'omniscient.strategies.v1';

export function loadStrategies(): StrategyDefinition[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STRATEGIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StrategyDefinition[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveStrategies(strategies: StrategyDefinition[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STRATEGIES_STORAGE_KEY,
      JSON.stringify(strategies),
    );
  } catch {
    // Quota exceeded — silently ignore (we don't want to crash the wizard).
  }
}

export function createBlankStrategy(): StrategyDefinition {
  const now = new Date().toISOString();
  return {
    id: `strat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: 'My Strategy',
    description: '',
    universe: [...DEFAULT_UNIVERSE],
    entryConditions: ['rsi_oversold', 'volume_spike'],
    exitConditions: ['rsi_overbought'],
    stopLossPct: 5,
    takeProfitPct: 10,
    positionSizePct: 10,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Price-alert deployment helpers
// ---------------------------------------------------------------------------

export interface DeployPlan {
  symbol: string;
  /** 'above' for take-profit, 'below' for stop-loss. */
  condition: 'above' | 'below';
  targetPrice: number;
  conviction: number;
  matchedFilters: string[];
}

/**
 * Compute the price-alert deployment plan for a single matched asset.
 *
 * We deploy two alerts per asset — a take-profit alert (price × (1 + TP%))
 * with condition 'above', and a stop-loss alert (price × (1 − SL%)) with
 * condition 'below'. The user can opt in/out per alert in the UI.
 */
export function buildDeployPlan(
  symbol: string,
  price: number,
  stopLossPct: number,
  takeProfitPct: number,
  conviction: number,
  matchedFilters: string[],
): DeployPlan[] {
  return [
    {
      symbol,
      condition: 'above',
      targetPrice: price * (1 + takeProfitPct / 100),
      conviction,
      matchedFilters,
    },
    {
      symbol,
      condition: 'below',
      targetPrice: price * (1 - stopLossPct / 100),
      conviction,
      matchedFilters,
    },
  ];
}
