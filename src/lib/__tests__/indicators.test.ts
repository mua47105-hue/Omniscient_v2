// Characterization tests for src/lib/market/indicators.ts
// These pin the current behavior of the pure-TS indicator implementations
// so refactors can be verified against known-good outputs.

import { computeIndicators } from '@/lib/market/indicators';
import type { Kline } from '@/lib/types';
import { describe, test, expect } from 'bun:test';

// Generate deterministic klines for reproducible tests.
function makeKlines(prices: number[]): Kline[] {
  return prices.map((p, i) => ({
    openTime: i * 1000,
    open: p * 0.999,
    high: p * 1.001,
    low: p * 0.998,
    close: p,
    volume: 1000,
    closeTime: i * 1000 + 999,
  }));
}

// 200 bars of slightly rising prices with oscillation — enough for ema12/ema26.
const trendingUp = Array.from({ length: 200 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 5) * 2);
// 200 bars of slightly falling prices.
const trendingDown = Array.from({ length: 200 }, (_, i) => 200 - i * 0.3 + Math.cos(i / 7) * 1.5);
// Flat prices.
const flat = Array.from({ length: 200 }, () => 100);

describe('computeIndicators', () => {
  test('returns valid RSI in [0, 100]', () => {
    const ti = computeIndicators(makeKlines(trendingUp));
    expect(ti.rsi14).not.toBeNull();
    expect(ti.rsi14!).toBeGreaterThanOrEqual(0);
    expect(ti.rsi14!).toBeLessThanOrEqual(100);
  });

  test('returns RSI=100 for flat prices (avgLoss === 0 guard)', () => {
    const ti = computeIndicators(makeKlines(flat));
    // Flat prices → no losses → avgLoss === 0 → impl returns 100.
    expect(ti.rsi14).toBe(100);
  });

  test('detects up trend (ema12 > ema26) on rising prices', () => {
    const ti = computeIndicators(makeKlines(trendingUp));
    expect(ti.trend).toBe('up');
    expect(ti.ema12).not.toBeNull();
    expect(ti.ema26).not.toBeNull();
    expect(ti.ema12!).toBeGreaterThan(ti.ema26!);
  });

  test('detects down trend (ema12 < ema26) on falling prices', () => {
    const ti = computeIndicators(makeKlines(trendingDown));
    expect(ti.trend).toBe('down');
    expect(ti.ema12).not.toBeNull();
    expect(ti.ema26).not.toBeNull();
    expect(ti.ema12!).toBeLessThan(ti.ema26!);
  });

  test('summaryScore is in [-100, 100]', () => {
    const ti = computeIndicators(makeKlines(trendingUp));
    expect(ti.summaryScore).toBeGreaterThanOrEqual(-100);
    expect(ti.summaryScore).toBeLessThanOrEqual(100);
  });

  test('votes object has all 5 indicator votes in {-1, 0, 1}', () => {
    const ti = computeIndicators(makeKlines(trendingUp));
    const votes = ti.votes;
    expect(Object.keys(votes).sort()).toEqual(['bollinger', 'ema', 'macd', 'rsi', 'vwap']);
    for (const v of Object.values(votes)) {
      expect([-1, 0, 1]).toContain(v);
    }
    // Sum of votes * 20 = summaryScore (clamped to [-100, 100]).
    const sum = votes.rsi + votes.macd + votes.ema + votes.bollinger + votes.vwap;
    expect(ti.summaryScore).toBe(Math.max(-100, Math.min(100, sum * 20)));
  });

  test('Bollinger bands: upper > middle > lower', () => {
    const ti = computeIndicators(makeKlines(trendingUp));
    expect(ti.bollinger.upper).not.toBeNull();
    expect(ti.bollinger.middle).not.toBeNull();
    expect(ti.bollinger.lower).not.toBeNull();
    expect(ti.bollinger.upper!).toBeGreaterThan(ti.bollinger.middle!);
    expect(ti.bollinger.middle!).toBeGreaterThan(ti.bollinger.lower!);
  });

  test('ATR14 is positive for non-flat data', () => {
    const ti = computeIndicators(makeKlines(trendingUp));
    expect(ti.atr14).not.toBeNull();
    expect(ti.atr14!).toBeGreaterThan(0);
  });

  test('VWAP is positive', () => {
    const ti = computeIndicators(makeKlines(trendingUp));
    expect(ti.vwap).not.toBeNull();
    expect(ti.vwap!).toBeGreaterThan(0);
  });

  test('handles short input (< 26 bars) without crashing — fields null', () => {
    const shortKlines = makeKlines([100, 101, 99, 102, 98, 103]);
    const ti = computeIndicators(shortKlines);
    // Insufficient data → most fields are null, but computeIndicators must not throw.
    expect(ti.rsi14).toBeNull();
    expect(ti.ema12).toBeNull();
    expect(ti.ema26).toBeNull();
    expect(ti.atr14).toBeNull();
    expect(ti.summaryScore).toBeGreaterThanOrEqual(-100);
    expect(ti.summaryScore).toBeLessThanOrEqual(100);
  });

  test('empty input does not crash — all numeric fields null, trend sideways', () => {
    const ti = computeIndicators([]);
    expect(ti.rsi14).toBeNull();
    expect(ti.ema12).toBeNull();
    expect(ti.ema26).toBeNull();
    expect(ti.atr14).toBeNull();
    expect(ti.sma20).toBeNull();
    expect(ti.vwap).toBeNull();
    expect(ti.lastClose).toBeNull();
    expect(ti.trend).toBe('sideways');
    expect(ti.summaryScore).toBe(0);
  });
});
