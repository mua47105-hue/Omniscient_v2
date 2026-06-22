// Divergence detector — RSI, MACD, and Volume divergences.
//
// WHY THIS EXISTS:
// The audit (CONTRARIAN-AUDIT-1) found that the consensus engine treats RSI<30
// as always-bullish and MACD>0 as always-bullish. This is a critical blind
// spot: in a bear trend, RSI<30 is a "falling knife" (price keeps falling
// despite oversold). And at market tops, MACD>0 with price making higher
// highs but MACD making LOWER highs is a classic bearish divergence that
// precedes a reversal.
//
// This module detects 7 divergence patterns (cited win rates 55-75% on 4H+):
//   1. Bearish RSI divergence  (price ↑ higher high, RSI ↓ lower high)  → bearish
//   2. Bullish RSI divergence  (price ↓ lower low,  RSI ↑ higher low)   → bullish
//   3. Hidden bearish RSI      (price ↓ lower high, RSI ↑ higher high)  → bearish (continuation)
//   4. Hidden bullish RSI      (price ↑ higher low,  RSI ↓ lower low)   → bullish (continuation)
//   5. Bearish MACD divergence (price ↑ higher high, MACD hist ↓ lower) → bearish
//   6. Bullish MACD divergence (price ↓ lower low,  MACD hist ↑ higher) → bullish
//   7. Volume divergence       (price ↑, volume ↓ = weak rally → bearish; vice versa)
//
// All patterns use pure OHLCV data — no external API calls needed.

import type { Kline } from '@/lib/types';

export interface DivergenceSignal {
  type: 'rsi_bearish' | 'rsi_bullish' | 'rsi_hidden_bearish' | 'rsi_hidden_bullish'
      | 'macd_bearish' | 'macd_bullish' | 'volume_bearish' | 'volume_bullish';
  direction: 'long' | 'short';  // the CONTRARIAN direction (what to do about it)
  severity: number;             // 0..1 — how strong is this divergence
  description: string;
}

/**
 * Find local extrema (peaks and troughs) in a series using a fractal approach.
 * A peak is a point higher than `lookback` points on each side; a trough is
 * the reverse. Returns indices of peaks and troughs.
 */
function findExtrema(values: number[], lookback: number = 3): { peaks: number[]; troughs: number[] } {
  const peaks: number[] = [];
  const troughs: number[] = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    let isPeak = true;
    let isTrough = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (values[j] >= values[i]) isPeak = false;
      if (values[j] <= values[i]) isTrough = false;
    }
    if (isPeak) peaks.push(i);
    if (isTrough) troughs.push(i);
  }
  return { peaks, troughs };
}

/**
 * Compute RSI series (not just the last value) so we can compare RSI at
 * different price extrema.
 */
function rsiSeries(closes: number[], period: number = 14): number[] {
  if (closes.length < period + 1) return closes.map(() => 50);
  const rsiVals: number[] = new Array(closes.length).fill(50);
  let avgGain = 0;
  let avgLoss = 0;
  // Seed with first `period` changes
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  rsiVals[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  // Wilder's smoothing for the rest
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsiVals[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsiVals;
}

/**
 * Compute MACD histogram series for divergence comparison.
 */
function macdHistogramSeries(closes: number[]): number[] {
  const ema = (vals: number[], p: number) => {
    const k = 2 / (p + 1);
    const out: number[] = [vals[0] ?? 0];
    for (let i = 1; i < vals.length; i++) out.push(vals[i] * k + out[i - 1] * (1 - k));
    return out;
  };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => (ema12[i] ?? 0) - (ema26[i] ?? 0));
  const signalLine = ema(macdLine, 9);
  return macdLine.map((m, i) => m - (signalLine[i] ?? 0));
}

/**
 * Detect all divergence patterns in the given klines.
 * Returns an array of DivergenceSignal — each represents a contrarian signal.
 * Empty array = no divergences detected (the trend is clean).
 */
export function detectDivergences(klines: Kline[]): DivergenceSignal[] {
  if (klines.length < 60) return []; // need enough data for extrema + smoothing

  const closes = klines.map((k) => k.close);
  const volumes = klines.map((k) => k.volume);
  const rsiVals = rsiSeries(closes, 14);
  const macdHistVals = macdHistogramSeries(closes);

  const signals: DivergenceSignal[] = [];

  // --- RSI Divergence ---
  // Find the last 2-3 peaks and troughs in price, compare their RSI values.
  const { peaks: pricePeaks, troughs: priceTroughs } = findExtrema(closes, 3);
  const { peaks: rsiPeaks, troughs: rsiTroughs } = findExtrema(rsiVals, 3);

  // Bearish RSI divergence: price makes a higher high, but RSI makes a lower high
  if (pricePeaks.length >= 2 && rsiPeaks.length >= 2) {
    const lastPeak = pricePeaks[pricePeaks.length - 1];
    const prevPeak = pricePeaks[pricePeaks.length - 2];
    const lastRsiAtPeak = rsiVals[lastPeak];
    const prevRsiAtPeak = rsiVals[prevPeak];
    if (closes[lastPeak] > closes[prevPeak] && lastRsiAtPeak < prevRsiAtPeak - 2) {
      const rsiDrop = prevRsiAtPeak - lastRsiAtPeak;
      const priceRise = (closes[lastPeak] - closes[prevPeak]) / closes[prevPeak];
      const severity = Math.min(1, (rsiDrop / 15) * (1 + priceRise * 5));
      signals.push({
        type: 'rsi_bearish',
        direction: 'short',
        severity,
        description: `Bearish RSI divergence: price ${closes[prevPeak].toFixed(2)}→${closes[lastPeak].toFixed(2)} (higher high) but RSI ${prevRsiAtPeak.toFixed(0)}→${lastRsiAtPeak.toFixed(0)} (lower high)`,
      });
    }
  }

  // Bullish RSI divergence: price makes a lower low, but RSI makes a higher low
  if (priceTroughs.length >= 2 && rsiTroughs.length >= 2) {
    const lastTrough = priceTroughs[priceTroughs.length - 1];
    const prevTrough = priceTroughs[priceTroughs.length - 2];
    const lastRsiAtTrough = rsiVals[lastTrough];
    const prevRsiAtTrough = rsiVals[prevTrough];
    if (closes[lastTrough] < closes[prevTrough] && lastRsiAtTrough > prevRsiAtTrough + 2) {
      const rsiRise = lastRsiAtTrough - prevRsiAtTrough;
      const priceDrop = (closes[prevTrough] - closes[lastTrough]) / closes[prevTrough];
      const severity = Math.min(1, (rsiRise / 15) * (1 + priceDrop * 5));
      signals.push({
        type: 'rsi_bullish',
        direction: 'long',
        severity,
        description: `Bullish RSI divergence: price ${closes[prevTrough].toFixed(2)}→${closes[lastTrough].toFixed(2)} (lower low) but RSI ${prevRsiAtTrough.toFixed(0)}→${lastRsiAtTrough.toFixed(0)} (higher low)`,
      });
    }
  }

  // Hidden bearish RSI: price makes a lower high, RSI makes a higher high → bearish continuation
  if (pricePeaks.length >= 2) {
    const lastPeak = pricePeaks[pricePeaks.length - 1];
    const prevPeak = pricePeaks[pricePeaks.length - 2];
    const lastRsi = rsiVals[lastPeak];
    const prevRsi = rsiVals[prevPeak];
    if (closes[lastPeak] < closes[prevPeak] && lastRsi > prevRsi + 2) {
      signals.push({
        type: 'rsi_hidden_bearish',
        direction: 'short',
        severity: Math.min(0.7, (lastRsi - prevRsi) / 15),
        description: `Hidden bearish RSI divergence: price lower high but RSI higher high → bearish continuation`,
      });
    }
  }

  // Hidden bullish RSI: price makes a higher low, RSI makes a lower low → bullish continuation
  if (priceTroughs.length >= 2) {
    const lastTrough = priceTroughs[priceTroughs.length - 1];
    const prevTrough = priceTroughs[priceTroughs.length - 2];
    const lastRsi = rsiVals[lastTrough];
    const prevRsi = rsiVals[prevTrough];
    if (closes[lastTrough] > closes[prevTrough] && lastRsi < prevRsi - 2) {
      signals.push({
        type: 'rsi_hidden_bullish',
        direction: 'long',
        severity: Math.min(0.7, (prevRsi - lastRsi) / 15),
        description: `Hidden bullish RSI divergence: price higher low but RSI lower low → bullish continuation`,
      });
    }
  }

  // --- MACD Divergence ---
  const { peaks: macdPeaks, troughs: macdTroughs } = findExtrema(macdHistVals, 3);

  // Bearish MACD: price higher high, MACD histogram lower high
  if (pricePeaks.length >= 2 && macdPeaks.length >= 2) {
    const lastPeak = pricePeaks[pricePeaks.length - 1];
    const prevPeak = pricePeaks[pricePeaks.length - 2];
    const lastMacd = macdHistVals[lastPeak];
    const prevMacd = macdHistVals[prevPeak];
    if (closes[lastPeak] > closes[prevPeak] && lastMacd < prevMacd - 0.01) {
      signals.push({
        type: 'macd_bearish',
        direction: 'short',
        severity: Math.min(1, Math.abs(prevMacd - lastMacd) / Math.max(Math.abs(prevMacd), 0.01)),
        description: `Bearish MACD divergence: price higher high but MACD histogram declining`,
      });
    }
  }

  // Bullish MACD: price lower low, MACD histogram higher low
  if (priceTroughs.length >= 2 && macdTroughs.length >= 2) {
    const lastTrough = priceTroughs[priceTroughs.length - 1];
    const prevTrough = priceTroughs[priceTroughs.length - 2];
    const lastMacd = macdHistVals[lastTrough];
    const prevMacd = macdHistVals[prevTrough];
    if (closes[lastTrough] < closes[prevTrough] && lastMacd > prevMacd + 0.01) {
      signals.push({
        type: 'macd_bullish',
        direction: 'long',
        severity: Math.min(1, Math.abs(lastMacd - prevMacd) / Math.max(Math.abs(lastMacd), 0.01)),
        description: `Bullish MACD divergence: price lower low but MACD histogram rising`,
      });
    }
  }

  // --- Volume Divergence ---
  // Price rising but volume declining = weak rally (bearish)
  // Price falling but volume declining = weak selloff (bullish)
  if (klines.length >= 30) {
    const recentHalf = klines.slice(-15);
    const prevHalf = klines.slice(-30, -15);
    const recentVol = recentHalf.reduce((s, k) => s + k.volume, 0) / 15;
    const prevVol = prevHalf.reduce((s, k) => s + k.volume, 0) / 15;
    const recentPrice = recentHalf[recentHalf.length - 1].close;
    const prevPrice = prevHalf[0].close;
    const priceChange = (recentPrice - prevPrice) / prevPrice;
    const volChange = prevVol > 0 ? (recentVol - prevVol) / prevVol : 0;

    if (priceChange > 0.02 && volChange < -0.15) {
      // Price up >2% but volume down >15% = weak rally
      signals.push({
        type: 'volume_bearish',
        direction: 'short',
        severity: Math.min(0.8, Math.abs(volChange) * 2),
        description: `Volume divergence: price +${(priceChange * 100).toFixed(1)}% but volume ${volChange > 0 ? '+' : ''}${(volChange * 100).toFixed(1)}% — weak rally`,
      });
    } else if (priceChange < -0.02 && volChange < -0.15) {
      // Price down >2% but volume down >15% = weak selloff (exhaustion)
      signals.push({
        type: 'volume_bullish',
        direction: 'long',
        severity: Math.min(0.8, Math.abs(volChange) * 2),
        description: `Volume divergence: price ${(priceChange * 100).toFixed(1)}% but volume declining — weak selloff, exhaustion bounce likely`,
      });
    }
  }

  return signals;
}

/**
 * Aggregate all divergence signals into a single contrarian score.
 * Returns a score from -100 to 100 (negative = bearish contrarian signal,
 * positive = bullish contrarian signal), plus the list of detected patterns.
 */
export function aggregateDivergenceScore(klines: Kline[]): {
  score: number;           // -100..100 — contrarian direction
  confidence: number;      // 0..100
  signals: DivergenceSignal[];
} {
  const signals = detectDivergences(klines);
  if (signals.length === 0) {
    return { score: 0, confidence: 0, signals: [] };
  }

  // Weight by severity — stronger divergences dominate
  let weightedScore = 0;
  let totalSeverity = 0;
  for (const s of signals) {
    const dirScore = s.direction === 'long' ? 100 : -100;
    weightedScore += dirScore * s.severity;
    totalSeverity += s.severity;
  }

  const score = totalSeverity > 0 ? weightedScore / totalSeverity : 0;
  // Confidence scales with number of confirming divergences + their severity
  const confidence = Math.min(90, signals.length * 20 + totalSeverity * 15);

  return { score, confidence, signals };
}
