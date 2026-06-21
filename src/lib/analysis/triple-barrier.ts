/**
 * E9 — Triple-barrier labeling (López de Prado 2018, AFML ch.3).
 *
 * The triple-barrier method labels each historical entry as a +1 / 0 / -1
 * outcome by checking which of three barriers is touched first:
 *
 *   - Upper (take-profit)  → entry ± tpMult × ATR   → label +1
 *   - Lower (stop-loss)    → entry ∓ slMult × ATR   → label -1
 *   - Vertical (timeout)   → entryIndex + holdingPeriod → label 0
 *
 * Conservative check order on each bar: **stop-loss first**. If both the SL
 * and TP levels fall inside the same bar's range, we assume the SL was hit
 * first. This biases the labels toward pessimism, which is the safe side for
 * a self-grading loop — false positives cost real money, false negatives
 * only cost opportunity.
 *
 * The result carries `returnPct` (signed price return) and `returnR` (return
 * in R-multiples relative to the SL distance) so callers can compute Sharpe
 * and risk-adjusted expectancy without re-walking the bars.
 *
 * Integration status (per handover): BUILT + tested, NOT yet wired into
 * grading.ts. Replacing the fixed-24h evaluate() with this changes the
 * self-tuning feedback — re-validate analytics after wiring.
 */

import type { Kline } from '@/lib/types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TripleBarrierConfig {
  /** Stop-loss multiplier × ATR. */
  slMult: number;
  /** Take-profit multiplier × ATR. */
  tpMult: number;
  /** Holding-period bars (vertical barrier). */
  holdingPeriod: number;
  /** 'long' (TP above, SL below) or 'short' (TP below, SL above). */
  direction: 'long' | 'short';
}

export const DEFAULT_TB_CONFIG: TripleBarrierConfig = {
  slMult: 1.5,
  tpMult: 3.0,
  holdingPeriod: 24, // ~1 day on hourly bars
  direction: 'long',
};

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type BarrierLabel = 1 | 0 | -1;
export type ExitReason = 'take-profit' | 'stop-loss' | 'timeout' | 'no-data';

export interface TripleBarrierResult {
  /** +1 = TP hit, -1 = SL hit, 0 = timeout. */
  label: BarrierLabel;
  /** Index into klines where the exit occurred. -1 if no data. */
  exitBar: number;
  /** Exit price (the barrier level, or the bar close for timeout). */
  exitPrice: number;
  exitReason: ExitReason;
  /** Signed price return (e.g. +0.03 = +3% for a long). */
  returnPct: number;
  /** Return in R-multiples (returnPct / slDistancePct). 0 if SL distance is degenerate. */
  returnR: number;
  /** Number of bars held. */
  barsHeld: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk forward from `entryIndex` and label the entry by which barrier is hit
 * first. Conservative ordering: SL first, then TP, then timeout.
 *
 * @param entryPrice  Price at which the position was opened.
 * @param atr         ATR value at entry time (sized in price units).
 * @param klines      Bar series (must include the entry bar and forward bars).
 * @param entryIndex  Index into `klines` of the entry bar. Forward scan starts
 *                    at `entryIndex + 1`.
 * @param config      SL/TP multipliers, holding period, direction.
 */
export function tripleBarrierLabel(
  entryPrice: number,
  atr: number,
  klines: Kline[],
  entryIndex: number,
  config: Partial<TripleBarrierConfig> = {},
): TripleBarrierResult {
  const cfg: TripleBarrierConfig = { ...DEFAULT_TB_CONFIG, ...config };

  const empty: TripleBarrierResult = {
    label: 0,
    exitBar: -1,
    exitPrice: entryPrice,
    exitReason: 'no-data',
    returnPct: 0,
    returnR: 0,
    barsHeld: 0,
  };

  if (
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(atr) ||
    atr <= 0 ||
    !Array.isArray(klines) ||
    klines.length === 0 ||
    entryIndex < 0 ||
    entryIndex >= klines.length
  ) {
    return empty;
  }

  const isLong = cfg.direction === 'long';
  const tpLevel = isLong
    ? entryPrice + cfg.tpMult * atr
    : entryPrice - cfg.tpMult * atr;
  const slLevel = isLong
    ? entryPrice - cfg.slMult * atr
    : entryPrice + cfg.slMult * atr;

  const timeoutBar = Math.min(
    klines.length - 1,
    entryIndex + cfg.holdingPeriod,
  );

  for (let i = entryIndex + 1; i <= timeoutBar; i++) {
    const bar = klines[i];
    if (!bar) break;
    const high = bar.high;
    const low = bar.low;

    // Conservative ordering: SL first.
    const slHit = isLong ? low <= slLevel : high >= slLevel;
    const tpHit = isLong ? high >= tpLevel : low <= tpLevel;

    if (slHit) {
      return finalize(-1, i, slLevel, 'stop-loss', entryPrice, atr, cfg, i - entryIndex);
    }
    if (tpHit) {
      return finalize(1, i, tpLevel, 'take-profit', entryPrice, atr, cfg, i - entryIndex);
    }

    if (i === timeoutBar) {
      // Vertical barrier — exit at the bar close.
      return finalize(0, i, bar.close, 'timeout', entryPrice, atr, cfg, i - entryIndex);
    }
  }

  // Ran out of bars before the timeout (incomplete history).
  const last = klines[klines.length - 1];
  return finalize(0, klines.length - 1, last.close, 'timeout', entryPrice, atr, cfg, klines.length - 1 - entryIndex);
}

function finalize(
  label: BarrierLabel,
  exitBar: number,
  exitPrice: number,
  reason: ExitReason,
  entryPrice: number,
  atr: number,
  cfg: TripleBarrierConfig,
  barsHeld: number,
): TripleBarrierResult {
  const isLong = cfg.direction === 'long';
  const rawReturn = isLong
    ? (exitPrice - entryPrice) / entryPrice
    : (entryPrice - exitPrice) / entryPrice;
  const slDistancePct = (cfg.slMult * atr) / entryPrice;
  const returnR = slDistancePct > 0 ? rawReturn / slDistancePct : 0;
  return {
    label,
    exitBar,
    exitPrice,
    exitReason: reason,
    returnPct: rawReturn,
    returnR,
    barsHeld,
  };
}

// ---------------------------------------------------------------------------
// Batch helper — label a window of entries in one pass
// ---------------------------------------------------------------------------

export interface BatchEntry {
  entryIndex: number;
  entryPrice: number;
  atr: number;
  direction?: 'long' | 'short';
}

/**
 * Label a batch of historical entries against a single bar series.
 * Useful for backtesting — runs the triple-barrier walk for each entry.
 */
export function tripleBarrierLabelBatch(
  klines: Kline[],
  entries: BatchEntry[],
  baseConfig: Partial<TripleBarrierConfig> = {},
): TripleBarrierResult[] {
  return entries.map((e) =>
    tripleBarrierLabel(e.entryPrice, e.atr, klines, e.entryIndex, {
      ...baseConfig,
      direction: e.direction ?? baseConfig.direction,
    }),
  );
}
