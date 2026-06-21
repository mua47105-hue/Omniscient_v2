/**
 * Pure-TS technical indicators. No external deps.
 *
 *  - sma, ema, emaSeries, rsi(14), macd, bollinger(20,2), vwap, atr(14),
 *    findLevels
 *  - `computeIndicators(klines)` returns a TechnicalIndicators object with
 *    trend detection + a 5-indicator vote count → summary score in [-100, 100].
 *
 *  Vote rules (each indicator votes +1 bull / -1 bear / 0 neutral):
 *    RSI:        >55 bull, <45 bear, else neutral
 *    MACD:       histogram > 0 bull, < 0 bear, else neutral
 *    EMA:        ema12 > ema26 bull, < bear, else neutral
 *    Bollinger:  close > middle bull, < middle bear, else neutral
 *    VWAP:       close > vwap bull, < bear, else neutral
 *  summaryScore = voteSum * 20  → range [-100, 100]
 */
import type { Kline, TechnicalIndicators } from '@/lib/types';

// ---------------------------------------------------------------------------
// SMA
// ---------------------------------------------------------------------------

export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

// ---------------------------------------------------------------------------
// EMA — single next value (uses prior EMA)
// ---------------------------------------------------------------------------

export function ema(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  return series.length ? series[series.length - 1] : null;
}

export function emaSeries(values: number[], period: number): number[] {
  if (period <= 0 || values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  // Seed with SMA of the first `period` values.
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

// ---------------------------------------------------------------------------
// RSI (Wilder's smoothing)
// ---------------------------------------------------------------------------

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ---------------------------------------------------------------------------
// MACD (12, 26, 9)
// ---------------------------------------------------------------------------

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: number | null; signal: number | null; histogram: number | null } {
  if (values.length < slow) {
    return { macd: null, signal: null, histogram: null };
  }
  const emaFast = emaSeries(values, fast);
  const emaSlow = emaSeries(values, slow);
  if (!emaFast.length || !emaSlow.length) {
    return { macd: null, signal: null, histogram: null };
  }
  // Align by tail: emaSlow is shorter.
  const offset = emaFast.length - emaSlow.length;
  const macdLine: number[] = [];
  for (let i = 0; i < emaSlow.length; i++) {
    macdLine.push(emaFast[i + offset] - emaSlow[i]);
  }
  const signalLine = emaSeries(macdLine, signalPeriod);
  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalLine.length ? signalLine[signalLine.length - 1] : null;
  const hist = macdVal != null && signalVal != null ? macdVal - signalVal : null;
  return { macd: macdVal, signal: signalVal, histogram: hist };
}

// ---------------------------------------------------------------------------
// Bollinger Bands (20, 2)
// ---------------------------------------------------------------------------

export function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): { upper: number | null; middle: number | null; lower: number | null } {
  if (values.length < period) {
    return { upper: null, middle: null, lower: null };
  }
  const slice = values.slice(values.length - period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((a, b) => a + (b - mean) * (b - mean), 0) / period;
  const sd = Math.sqrt(variance);
  return {
    upper: mean + mult * sd,
    middle: mean,
    lower: mean - mult * sd,
  };
}

// ---------------------------------------------------------------------------
// VWAP (rolling over supplied klines)
// ---------------------------------------------------------------------------

export function vwap(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): number | null {
  const n = Math.min(highs.length, lows.length, closes.length, volumes.length);
  if (n === 0) return null;
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < n; i++) {
    const typical = (highs[i] + lows[i] + closes[i]) / 3;
    pv += typical * volumes[i];
    vol += volumes[i];
  }
  if (vol === 0) return null;
  return pv / vol;
}

// ---------------------------------------------------------------------------
// ATR (Wilder, 14)
// ---------------------------------------------------------------------------

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  const n = Math.min(highs.length, lows.length, closes.length);
  if (n < period + 1) return null;
  const trs: number[] = [];
  trs.push(highs[0] - lows[0]);
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
  }
  // Wilder smoothing
  let prev = 0;
  for (let i = 0; i < period; i++) prev += trs[i];
  prev /= period;
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
  }
  return prev;
}

// ---------------------------------------------------------------------------
// Support / Resistance levels (local extrema)
// ---------------------------------------------------------------------------

export function findLevels(
  closes: number[],
  window = 5,
): { supports: number[]; resistances: number[] } {
  const supports: number[] = [];
  const resistances: number[] = [];
  if (closes.length < window * 2 + 1) return { supports, resistances };
  for (let i = window; i < closes.length - window; i++) {
    let isMax = true;
    let isMin = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (closes[j] >= closes[i]) isMax = false;
      if (closes[j] <= closes[i]) isMin = false;
    }
    if (isMax) resistances.push(closes[i]);
    if (isMin) supports.push(closes[i]);
  }
  return { supports, resistances };
}

// ---------------------------------------------------------------------------
// Trend detection
// ---------------------------------------------------------------------------

function detectTrend(
  closes: number[],
  ema12: number | null,
  ema26: number | null,
): 'up' | 'down' | 'sideways' {
  if (ema12 == null || ema26 == null || closes.length < 50) return 'sideways';
  // Slope of last 20 closes.
  const last20 = closes.slice(-20);
  const slope = (last20[last20.length - 1] - last20[0]) / last20[0];
  if (ema12 > ema26 && slope > 0.005) return 'up';
  if (ema12 < ema26 && slope < -0.005) return 'down';
  return 'sideways';
}

// ---------------------------------------------------------------------------
// computeIndicators — top-level entry point
// ---------------------------------------------------------------------------

export function computeIndicators(klines: Kline[]): TechnicalIndicators {
  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const volumes = klines.map((k) => k.volume);

  const lastClose = closes.length ? closes[closes.length - 1] : null;
  const sma20 = sma(closes, 20);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const rsi14 = rsi(closes, 14);
  const macdRes = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const vwapVal = vwap(highs, lows, closes, volumes);
  const atr14 = atr(highs, lows, closes, 14);
  const trend = detectTrend(closes, ema12, ema26);

  // 5-indicator vote.
  const voteRsi = rsi14 == null ? 0 : rsi14 > 55 ? 1 : rsi14 < 45 ? -1 : 0;
  const voteMacd =
    macdRes.histogram == null ? 0 : macdRes.histogram > 0 ? 1 : macdRes.histogram < 0 ? -1 : 0;
  const voteEma =
    ema12 == null || ema26 == null ? 0 : ema12 > ema26 ? 1 : ema12 < ema26 ? -1 : 0;
  const voteBb =
    lastClose == null || bb.middle == null
      ? 0
      : lastClose > bb.middle
        ? 1
        : lastClose < bb.middle
          ? -1
          : 0;
  const voteVwap =
    lastClose == null || vwapVal == null
      ? 0
      : lastClose > vwapVal
        ? 1
        : lastClose < vwapVal
          ? -1
          : 0;

  const voteSum = voteRsi + voteMacd + voteEma + voteBb + voteVwap;
  const summaryScore = Math.max(-100, Math.min(100, voteSum * 20));

  return {
    sma20,
    ema12,
    ema26,
    rsi14,
    macd: macdRes,
    bollinger: bb,
    vwap: vwapVal,
    atr14,
    lastClose,
    trend,
    votes: { rsi: voteRsi, macd: voteMacd, ema: voteEma, bollinger: voteBb, vwap: voteVwap },
    summaryScore,
  };
}
