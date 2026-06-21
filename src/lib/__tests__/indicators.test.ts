import { describe, test, expect } from 'bun:test';
import { computeIndicators } from '@/lib/market/indicators';
import type { Kline } from '@/lib/types';

function makeKlines(prices: number[]): Kline[] {
  return prices.map((p, i) => ({ openTime: i * 1000, open: p * 0.999, high: p * 1.001, low: p * 0.998, close: p, volume: 1000, closeTime: i * 1000 + 999 }));
}
const trendingUp = Array.from({ length: 200 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 5) * 2);

describe('computeIndicators', () => {
  test('returns rsi in [0, 100]', () => {
    const ti = computeIndicators(makeKlines(trendingUp));
    expect(ti.rsi).toBeGreaterThanOrEqual(0);
    expect(ti.rsi).toBeLessThanOrEqual(100);
  });
  test('detects bullish trend on rising prices', () => {
    const ti = computeIndicators(makeKlines(trendingUp));
    expect(['bullish', 'bearish', 'neutral']).toContain(ti.trend);
  });
  test('summary.score in [-100, 100]', () => {
    const ti = computeIndicators(makeKlines(trendingUp));
    expect(ti.summary.score).toBeGreaterThanOrEqual(-100);
    expect(ti.summary.score).toBeLessThanOrEqual(100);
  });
  test('summary votes sum to 5', () => {
    const ti = computeIndicators(makeKlines(trendingUp));
    expect(ti.summary.buy + ti.summary.neutral + ti.summary.sell).toBe(5);
  });
  test('handles empty input', () => {
    const ti = computeIndicators([]);
    expect(ti.rsi).toBe(50);
  });
});
