// Characterization tests for src/lib/risk/vol_targeting.ts

import { volTargetSize, DEFAULT_VOL_TARGET_CONFIG } from '@/lib/risk/vol_targeting';
import { describe, test, expect } from 'bun:test';

function makeKlines(prices: number[]) {
  return prices.map(p => ({ open: p * 0.999, close: p }));
}

describe('volTargetSize', () => {
  test('returns notional inversely proportional to realized vol', () => {
    const lowVol = makeKlines(Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 0.1));
    const highVol = makeKlines(Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 5));
    const lowResult = volTargetSize(10000, lowVol);
    const highResult = volTargetSize(10000, highVol);
    // Lower vol → larger notional (inverse relationship).
    expect(lowResult.notional).toBeGreaterThan(highResult.notional);
  });

  test('caps notional at maxNotionalPct of equity', () => {
    const veryLowVol = makeKlines(Array.from({ length: 30 }, () => 100)); // flat → vol ≈ 0
    const result = volTargetSize(10000, veryLowVol, { ...DEFAULT_VOL_TARGET_CONFIG, maxNotionalPct: 0.25 });
    expect(result.notional).toBeLessThanOrEqual(10000 * 0.25);
  });

  test('falls back to 2% fixed for < 10 bars', () => {
    const shortKlines = makeKlines([100, 101, 99]);
    const result = volTargetSize(10000, shortKlines);
    expect(result.notional).toBe(200); // 2% of 10000
    expect(result.sizePct).toBe(0.02);
    expect(result.rationale).toContain('insufficient');
  });

  test('returns realizedVol > 0 for valid input', () => {
    const klines = makeKlines(Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 3) * 2));
    const result = volTargetSize(10000, klines);
    expect(result.realizedVol).toBeGreaterThan(0);
  });

  test('sizePct = notional / equity', () => {
    const klines = makeKlines(Array.from({ length: 30 }, (_, i) => 100 + i * 0.5));
    const result = volTargetSize(50000, klines);
    expect(result.sizePct).toBeCloseTo(result.notional / 50000, 5);
  });

  test('handles empty klines gracefully', () => {
    const result = volTargetSize(10000, []);
    expect(result.notional).toBe(200); // 2% fallback
  });
});
