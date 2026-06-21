// Technical indicators — pure TypeScript implementations (no external deps)
// All return normalized values for the consensus engine.

import type { Kline, TechnicalIndicators } from '@/lib/types';

function sma(values: number[], period: number): number {
  if (values.length < period) return values.reduce((s, v) => s + v, 0) / Math.max(values.length, 1);
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsi(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes: number[]) {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, i) => (ema12[i] ?? 0) - (ema26[i] ?? 0));
  const signalLine = emaSeries(macdLine, 9);
  const histogram = (macdLine[macdLine.length - 1] ?? 0) - (signalLine[signalLine.length - 1] ?? 0);
  return {
    macd: macdLine[macdLine.length - 1] ?? 0,
    signal: signalLine[signalLine.length - 1] ?? 0,
    histogram,
  };
}

function bollinger(closes: number[], period: number = 20, mult: number = 2) {
  const slice = closes.slice(-period);
  const mid = slice.reduce((s, v) => s + v, 0) / Math.max(slice.length, 1);
  const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / Math.max(slice.length, 1);
  const sd = Math.sqrt(variance);
  return { upper: mid + mult * sd, middle: mid, lower: mid - mult * sd };
}

function vwap(klines: Kline[]): number {
  let pv = 0;
  let vol = 0;
  for (const k of klines) {
    const typical = (k.high + k.low + k.close) / 3;
    pv += typical * k.volume;
    vol += k.volume;
  }
  return vol > 0 ? pv / vol : 0;
}

function atr(klines: Kline[], period: number = 14): number {
  if (klines.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const k = klines[i];
    const prev = klines[i - 1];
    trs.push(
      Math.max(k.high - k.low, Math.abs(k.high - prev.close), Math.abs(k.low - prev.close))
    );
  }
  return sma(trs, period);
}

/** Find support/resistance levels via local extrema */
function findLevels(klines: Kline[], lookback: number = 20): { support: number[]; resistance: number[] } {
  const support: number[] = [];
  const resistance: number[] = [];
  for (let i = lookback; i < klines.length - lookback; i++) {
    const window = klines.slice(i - lookback, i + lookback + 1);
    const low = Math.min(...window.map((k) => k.low));
    const high = Math.max(...window.map((k) => k.high));
    if (klines[i].low === low) support.push(klines[i].low);
    if (klines[i].high === high) resistance.push(klines[i].high);
  }
  return {
    support: [...new Set(support)].slice(-3),
    resistance: [...new Set(resistance)].slice(0, 3),
  };
}

/** Full indicator set from klines */
export function computeIndicators(klines: Kline[]): TechnicalIndicators {
  const closes = klines.map((k) => k.close);
  const lastPrice = closes[closes.length - 1] ?? 0;

  const rsiVal = rsi(closes, 14);
  const macdVal = macd(closes);
  const ema20Val = ema(closes, 20);
  const ema50Val = ema(closes, 50);
  const ema200Val = ema(closes, 200);
  const sma20Val = sma(closes, 20);
  const bb = bollinger(closes, 20, 2);
  const vwapVal = vwap(klines);
  const atrVal = atr(klines, 14);
  const levels = findLevels(klines, 20);

  // trend from EMA alignment
  let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (ema20Val > ema50Val && ema50Val > ema200Val) trend = 'bullish';
  else if (ema20Val < ema50Val && ema50Val < ema200Val) trend = 'bearish';

  // simple vote count
  let buy = 0;
  let neutral = 0;
  let sell = 0;
  if (rsiVal < 30) buy++;
  else if (rsiVal > 70) sell++;
  else neutral++;
  if (macdVal.histogram > 0) buy++;
  else if (macdVal.histogram < 0) sell++;
  else neutral++;
  if (trend === 'bullish') buy++;
  else if (trend === 'bearish') sell++;
  else neutral++;
  if (lastPrice > vwapVal) buy++;
  else if (lastPrice < vwapVal) sell++;
  else neutral++;
  if (lastPrice < bb.lower) buy++;
  else if (lastPrice > bb.upper) sell++;
  else neutral++;

  const score = ((buy - sell) / Math.max(buy + neutral + sell, 1)) * 100;

  return {
    rsi: rsiVal,
    macd: macdVal,
    ema20: ema20Val,
    ema50: ema50Val,
    ema200: ema200Val,
    sma20: sma20Val,
    bollinger: bb,
    vwap: vwapVal,
    atr: atrVal,
    support: levels.support,
    resistance: levels.resistance,
    trend,
    summary: { buy, neutral, sell, score: Math.round(score) },
  };
}
