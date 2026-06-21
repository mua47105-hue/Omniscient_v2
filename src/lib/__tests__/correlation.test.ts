// Characterization tests for src/lib/analysis/correlation.ts

import { pearsonCorrelation, computeCorrelationMatrix, dailyReturns, linearRegression } from '@/lib/analysis/correlation';
import { describe, test, expect } from 'bun:test';

describe('pearsonCorrelation', () => {
  test('perfect positive correlation → 1', () => {
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 5);
  });

  test('perfect negative correlation → -1', () => {
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 5);
  });

  test('uncorrelated → near 0', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
    const r = pearsonCorrelation(x, y);
    expect(Math.abs(r)).toBeLessThan(0.5);
  });

  test('returns 0 for < 2 points (degenerate)', () => {
    // Implementation returns 0, not NaN, when n < 2.
    expect(pearsonCorrelation([1], [2])).toBe(0);
  });

  test('returns 0 for zero variance (denominator === 0)', () => {
    // Implementation returns 0, not NaN, when denominator is 0.
    expect(pearsonCorrelation([5, 5, 5], [1, 2, 3])).toBe(0);
  });
});

describe('dailyReturns', () => {
  test('returns N-1 returns for N prices', () => {
    expect(dailyReturns([100, 101, 102, 103]).length).toBe(3);
  });

  test('correct log-return values (r = ln(p_t / p_{t-1}))', () => {
    const r = dailyReturns([100, 110, 99]);
    // Implementation uses LOG returns, not simple returns.
    expect(r[0]).toBeCloseTo(Math.log(110 / 100), 5);
    expect(r[1]).toBeCloseTo(Math.log(99 / 110), 5);
  });

  test('empty for < 2 prices', () => {
    expect(dailyReturns([100])).toEqual([]);
    expect(dailyReturns([])).toEqual([]);
  });
});

describe('linearRegression', () => {
  test('recovers slope and intercept for y = 2x + 1', () => {
    const x = [0, 1, 2, 3, 4, 5];
    const y = x.map(xi => 2 * xi + 1);
    // Signature is linearRegression(y, x) — y first, x second.
    const { slope, intercept, rSquared } = linearRegression(y, x);
    expect(slope).toBeCloseTo(2, 5);
    expect(intercept).toBeCloseTo(1, 5);
    expect(rSquared).toBeCloseTo(1, 5);
  });

  test('returns 0 slope for < 2 points', () => {
    const { slope } = linearRegression([2], [1]);
    expect(slope).toBe(0);
  });
});

describe('computeCorrelationMatrix', () => {
  test('produces N×N matrix with diagonal = 1 and upper-triangle entries', () => {
    const returns = { A: [1, 2, 3, 4, 5], B: [5, 4, 3, 2, 1], C: [1, 2, 3, 4, 5] };
    const result = computeCorrelationMatrix(returns);
    // Returns a CorrelationMatrix object — assets / entries / matrix.
    expect(result.assets).toEqual(['A', 'B', 'C']);
    // 3×3 matrix.
    expect(result.matrix.length).toBe(3);
    expect(result.matrix[0].length).toBe(3);
    // Diagonal cells = 1.
    for (let i = 0; i < 3; i++) {
      expect(result.matrix[i][i]).toBe(1);
    }
    // Symmetric: matrix[i][j] === matrix[j][i].
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(result.matrix[i][j]).toBeCloseTo(result.matrix[j][i], 10);
      }
    }
    // Upper-triangle entries: 3 pairs for 3 assets.
    expect(result.entries.length).toBe(3);
    // Entries are sorted by |r| descending.
    for (let i = 1; i < result.entries.length; i++) {
      expect(Math.abs(result.entries[i].r)).toBeLessThanOrEqual(Math.abs(result.entries[i - 1].r));
    }
    // Each entry has {x, y, r} fields.
    const e0 = result.entries[0];
    expect(typeof e0.x).toBe('string');
    expect(typeof e0.y).toBe('string');
    expect(typeof e0.r).toBe('number');
  });
});
