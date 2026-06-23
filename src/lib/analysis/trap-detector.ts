// Trap detector — bull traps, bear traps, liquidity sweeps, fake breakouts.
//
// WHY THIS EXISTS:
// The audit (CONTRARIAN-AUDIT-1, loopholes L3 + L4) found that the consensus
// engine has NO trap detection. A "momentum breakout" signal fires when price
// breaks above resistance — but this is exactly when a bull trap is most
// dangerous. The system would issue STRONG LONG at the local top, right
// before the reversal.
//
// This module detects 4 trap patterns (cited win rates 65-75%):
//   1. Bull trap: price breaks above resistance, then immediately reverses
//      back below. Signs: long upper wick, close below breakout level,
//      declining volume on the breakout candle.
//   2. Bear trap: price breaks below support, then immediately bounces.
//      Signs: long lower wick, close above breakdown level.
//   3. Liquidity sweep (stop hunt): price spikes above a prior swing high
//      (or below a prior swing low) to grab stops, then reverses. The wick
//      is disproportionately long vs the body.
//   4. Fake breakout: price breaks above resistance but volume is BELOW
//      average (real breakouts have 1.5-3× average volume; fakes have ≤0.8×).
//
// All patterns use pure OHLCV data.

import type { Kline, TechnicalIndicators } from '@/lib/types';

export interface TrapSignal {
  type: 'bull_trap' | 'bear_trap' | 'liquidity_sweep_long' | 'liquidity_sweep_short' | 'fake_breakout';
  direction: 'long' | 'short';  // the CONTRARIAN direction (fade the trap)
  severity: number;             // 0..1
  description: string;
}

/**
 * Compute the average volume over a lookback period.
 */
function avgVolume(klines: Kline[], lookback: number): number {
  const slice = klines.slice(-lookback);
  return slice.reduce((s, k) => s + k.volume, 0) / Math.max(slice.length, 1);
}

/**
 * Find recent swing highs and lows (for liquidity sweep detection).
 * A swing high is a candle whose high is higher than `lookback` candles
 * on each side.
 */
function findSwingPoints(klines: Kline[], lookback: number = 5): {
  swingHighs: { index: number; price: number }[];
  swingLows: { index: number; price: number }[];
} {
  const swingHighs: { index: number; price: number }[] = [];
  const swingLows: { index: number; price: number }[] = [];
  for (let i = lookback; i < klines.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (klines[j].high >= klines[i].high) isHigh = false;
      if (klines[j].low <= klines[i].low) isLow = false;
    }
    if (isHigh) swingHighs.push({ index: i, price: klines[i].high });
    if (isLow) swingLows.push({ index: i, price: klines[i].low });
  }
  return { swingHighs, swingLows };
}

/**
 * Detect all trap patterns in the recent klines.
 * Focuses on the last few candles (traps are short-lived patterns).
 */
export function detectTraps(klines: Kline[], indicators?: TechnicalIndicators): TrapSignal[] {
  if (klines.length < 30) return [];

  const signals: TrapSignal[] = [];
  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2];
  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.close, last.open);
  const lowerWick = Math.min(last.close, last.open) - last.low;
  const range = last.high - last.low || 0.0001;
  const avgVol = avgVolume(klines, 20);
  const lastVol = last.volume;
  const volRatio = avgVol > 0 ? lastVol / avgVol : 1;

  const resistance = indicators?.resistance ?? [];
  const support = indicators?.support ?? [];
  const atr = indicators?.atr ?? range;

  // --- Bull Trap ---
  // Price broke above resistance (intraday high > resistance) but closed
  // back below it, with a long upper wick. The breakout failed.
  if (resistance.length > 0) {
    const nearestResistance = resistance[resistance.length - 1];
    if (last.high > nearestResistance && last.close < nearestResistance) {
      // Failed breakout — the wick pierced resistance but the body closed below
      const wickRatio = upperWick / range;
      const severity = Math.min(1, wickRatio * 0.7 + (1 - Math.min(1, volRatio)) * 0.3);
      if (severity > 0.3) {
        signals.push({
          type: 'bull_trap',
          direction: 'short',
          severity,
          description: `Bull trap: price spiked to ${last.high.toFixed(2)} above resistance ${nearestResistance.toFixed(2)} but closed back below at ${last.close.toFixed(2)} (upper wick ${(wickRatio * 100).toFixed(0)}% of range)`,
        });
      }
    }
  }

  // --- Bear Trap ---
  // Price broke below support (intraday low < support) but closed back above.
  if (support.length > 0) {
    const nearestSupport = support[support.length - 1];
    if (last.low < nearestSupport && last.close > nearestSupport) {
      const wickRatio = lowerWick / range;
      const severity = Math.min(1, wickRatio * 0.7 + (1 - Math.min(1, volRatio)) * 0.3);
      if (severity > 0.3) {
        signals.push({
          type: 'bear_trap',
          direction: 'long',
          severity,
          description: `Bear trap: price spiked to ${last.low.toFixed(2)} below support ${nearestSupport.toFixed(2)} but closed back above at ${last.close.toFixed(2)} (lower wick ${(wickRatio * 100).toFixed(0)}% of range)`,
        });
      }
    }
  }

  // --- Liquidity Sweep (Stop Hunt) ---
  // Price spiked above a prior swing high (sweeping stop-losses) then
  // reversed. Or spiked below a prior swing low then bounced.
  const { swingHighs, swingLows } = findSwingPoints(klines, 5);

  // Only look at the most recent swing points (not the current candle)
  const recentSwingHighs = swingHighs.filter((s) => s.index < klines.length - 2).slice(-3);
  const recentSwingLows = swingLows.filter((s) => s.index < klines.length - 2).slice(-3);

  // Sell-side liquidity sweep: price spikes above a prior swing high then reverses
  if (recentSwingHighs.length > 0) {
    const highestRecent = recentSwingHighs.reduce((max, s) => s.price > max.price ? s : max, recentSwingHighs[0]);
    if (last.high > highestRecent.price && last.close < highestRecent.price) {
      // Swept the swing high then closed back below — stop hunt
      const sweepDepth = (last.high - highestRecent.price) / atr;
      const wickRatio = upperWick / range;
      if (sweepDepth > 0.3 && wickRatio > 0.4) {
        signals.push({
          type: 'liquidity_sweep_short',
          direction: 'short',
          severity: Math.min(1, sweepDepth * 0.5 + wickRatio * 0.5),
          description: `Liquidity sweep: price swept above swing high ${highestRecent.price.toFixed(2)} (depth ${sweepDepth.toFixed(1)}×ATR) then reversed — stop hunt, bearish`,
        });
      }
    }
  }

  // Buy-side liquidity sweep: price spikes below a prior swing low then bounces
  if (recentSwingLows.length > 0) {
    const lowestRecent = recentSwingLows.reduce((min, s) => s.price < min.price ? s : min, recentSwingLows[0]);
    if (last.low < lowestRecent.price && last.close > lowestRecent.price) {
      const sweepDepth = (lowestRecent.price - last.low) / atr;
      const wickRatio = lowerWick / range;
      if (sweepDepth > 0.3 && wickRatio > 0.4) {
        signals.push({
          type: 'liquidity_sweep_long',
          direction: 'long',
          severity: Math.min(1, sweepDepth * 0.5 + wickRatio * 0.5),
          description: `Liquidity sweep: price swept below swing low ${lowestRecent.price.toFixed(2)} (depth ${sweepDepth.toFixed(1)}×ATR) then reversed — stop hunt, bullish`,
        });
      }
    }
  }

  // --- Fake Breakout ---
  // Price broke above resistance with LOW volume (real breakouts have 1.5-3×
  // average volume; fakes have ≤0.8×). This is a low-conviction breakout
  // likely to fail.
  if (resistance.length > 0 && last.close > resistance[resistance.length - 1]) {
    if (volRatio < 0.8) {
      // Breakout on low volume — likely fake
      const severity = Math.min(0.8, (0.8 - volRatio) * 1.5);
      signals.push({
        type: 'fake_breakout',
        direction: 'short',
        severity,
        description: `Fake breakout: price closed above resistance ${resistance[resistance.length - 1].toFixed(2)} but volume is only ${(volRatio * 100).toFixed(0)}% of average — low conviction, likely to fail`,
      });
    }
  }

  return signals;
}

/**
 * Aggregate all trap signals into a single contrarian score.
 * Returns a score from -100 to 100 (negative = bearish contrarian, positive
 * = bullish contrarian), plus the list of detected traps.
 */
export function aggregateTrapScore(klines: Kline[], indicators?: TechnicalIndicators): {
  score: number;           // -100..100 — contrarian direction
  confidence: number;      // 0..100
  signals: TrapSignal[];
} {
  const signals = detectTraps(klines, indicators);
  if (signals.length === 0) {
    return { score: 0, confidence: 0, signals: [] };
  }

  let weightedScore = 0;
  let totalSeverity = 0;
  for (const s of signals) {
    const dirScore = s.direction === 'long' ? 100 : -100;
    weightedScore += dirScore * s.severity;
    totalSeverity += s.severity;
  }

  const score = totalSeverity > 0 ? weightedScore / totalSeverity : 0;
  const confidence = Math.min(95, signals.length * 25 + totalSeverity * 20);

  return { score, confidence, signals };
}
