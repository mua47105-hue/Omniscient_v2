import { describe, test, expect } from 'bun:test';
import { deflatedSharpeRatio, moments, dsrVerdict } from '@/lib/analysis/deflated-sharpe';

// DsrStats: { sharpe, nTrades, nTrials, skewness, kurtosis }
// moments: { skewness, kurtosis } (not excessKurtosis)
// deflatedSharpeRatio returns a number
// dsrVerdict returns { label, deploy, color }

describe('deflatedSharpeRatio', () => {
  test('high Sharpe + few trials → high DSR', () => {
    const dsr = deflatedSharpeRatio({ sharpe: 2.0, nTrades: 200, nTrials: 5, skewness: 0, kurtosis: 3 });
    expect(dsr).toBeGreaterThan(0.7);
  });
  test('low Sharpe + many trials → low DSR', () => {
    const dsr = deflatedSharpeRatio({ sharpe: 0.2, nTrades: 50, nTrials: 100, skewness: 0, kurtosis: 3 });
    expect(dsr).toBeLessThan(0.5);
  });
  test('DSR in [0, 1]', () => {
    const dsr = deflatedSharpeRatio({ sharpe: 1.5, nTrades: 100, nTrials: 20, skewness: -0.5, kurtosis: 5 });
    expect(dsr).toBeGreaterThanOrEqual(0);
    expect(dsr).toBeLessThanOrEqual(1);
  });
  test('returns 0 for < 2 trades', () => {
    expect(deflatedSharpeRatio({ sharpe: 5, nTrades: 1, nTrials: 1, skewness: 0, kurtosis: 3 })).toBe(0);
  });
});

describe('moments', () => {
  test('normal data → skewness ≈ 0', () => {
    const returns = Array.from({ length: 1000 }, () => {
      const u1 = Math.random(), u2 = Math.random();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * 0.01;
    });
    const m = moments(returns);
    expect(Math.abs(m.skewness)).toBeLessThan(0.3);
  });
  test('returns 0/0 for < 3 points', () => {
    const m = moments([1, 2]);
    expect(m.skewness).toBe(0);
    expect(m.kurtosis).toBe(0);
  });
});

describe('dsrVerdict', () => {
  test('DSR ≥ 0.95 → deploy true', () => {
    const v = dsrVerdict(0.96);
    expect(v.deploy).toBe(true);
  });
  test('DSR < 0.80 → deploy false', () => {
    const v = dsrVerdict(0.5);
    expect(v.deploy).toBe(false);
  });
});
