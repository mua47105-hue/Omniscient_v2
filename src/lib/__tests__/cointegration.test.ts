// Characterization tests for src/lib/analysis/cointegration.ts

import { ols, adfTest, engleGranger, computeCointegrationMatrix } from '@/lib/analysis/cointegration';
import { describe, test, expect } from 'bun:test';

describe('ols', () => {
  test('recovers slope ≈ 2 for y = 2x + noise', () => {
    const x = Array.from({ length: 100 }, (_, i) => i);
    const y = x.map(xi => 2 * xi + 1 + (Math.random() - 0.5) * 0.5);
    // Signature is ols(y, x) — y first, x second.
    const { beta, alpha, residuals } = ols(y, x);
    expect(beta).toBeCloseTo(2, 1);
    expect(alpha).toBeCloseTo(1, 0);
    expect(residuals.length).toBe(100);
  });

  test('returns slope 0 for constant x (sxx === 0)', () => {
    // ols(y, x): y=[5,5,5], x=[1,2,3] → sxy=0 → beta=0
    const { beta } = ols([5, 5, 5], [1, 2, 3]);
    expect(beta).toBe(0);
  });

  test('returns empty residuals for < 3 points', () => {
    const { residuals } = ols([1, 2], [3, 4]);
    expect(residuals).toEqual([]);
  });
});

describe('adfTest', () => {
  test('returns pValue = 1 for < 5 points (degenerate guard)', () => {
    // Implementation short-circuits when n < 5.
    const result = adfTest([1, 2, 3, 4]);
    expect(result.pValue).toBe(1);
    expect(result.isStationary).toBe(false);
  });

  test('stationary series (white noise) → pValue < 0.05', () => {
    // White noise is stationary → ADF should reject unit root.
    const noise = Array.from({ length: 200 }, () => (Math.random() - 0.5) * 2);
    const result = adfTest(noise);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.isStationary).toBe(true);
  });

  test('random walk (unit root) → pValue >= 0.10', () => {
    // Cumulative sum of noise = random walk (non-stationary).
    let rw = 0;
    const walk = Array.from({ length: 200 }, () => (rw += (Math.random() - 0.5)));
    const result = adfTest(walk);
    expect(result.pValue).toBeGreaterThanOrEqual(0.10);
  });
});

describe('engleGranger', () => {
  test('detects cointegration in y = 2x + stationary noise', () => {
    // The residual must be *strongly* stationary for the simple no-lag ADF
    // to reject the unit root — white noise works, smooth oscillations do not.
    const x = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1);
    const y = x.map(v => 2 * v + (Math.random() - 0.5) * 2);
    // pair is a string ("Y/X"), not an array.
    const result = engleGranger(y, x, 'Y/X');
    expect(result).not.toBeNull();
    expect(result.hedgeRatio).toBeCloseTo(2, 0);
    expect(result.isCointegrated).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
  });

  test('returns non-cointegrated result for insufficient data', () => {
    // engleGranger never returns null — it returns an `empty` result with
    // isCointegrated=false / tradeable=false when n < minObs.
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    const result = engleGranger(y, x, 'Y/X');
    expect(result.isCointegrated).toBe(false);
    expect(result.tradeable).toBe(false);
  });

  test('zScore is finite for a cointegrated pair', () => {
    const x = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1);
    const y = x.map(v => 2 * v + (Math.random() - 0.5) * 1);
    const result = engleGranger(y, x, 'Y/X');
    expect(Number.isFinite(result.zScore)).toBe(true);
  });
});

describe('computeCointegrationMatrix', () => {
  test('returns upper-triangle pairs only', () => {
    const prices = {
      A: Array.from({ length: 300 }, (_, i) => 100 + i * 0.1),
      B: Array.from({ length: 300 }, (_, i) => 200 + i * 0.05),
      C: Array.from({ length: 300 }, (_, i) => 50 + i * 0.2),
    };
    const matrix = computeCointegrationMatrix(prices);
    // 3 assets → 3 upper-triangular pairs.
    expect(matrix.entries.length).toBe(3);
    expect(matrix.assets).toEqual(['A', 'B', 'C']);
    // byPair lookup should contain both directions for each pair.
    expect(Object.keys(matrix.byPair).length).toBe(6);
  });

  test('returns empty entries for single asset', () => {
    const matrix = computeCointegrationMatrix({ A: [1, 2, 3] });
    expect(matrix.entries.length).toBe(0);
    expect(matrix.assets).toEqual(['A']);
  });
});
