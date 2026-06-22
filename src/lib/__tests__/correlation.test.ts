import { describe, test, expect } from 'bun:test';
import { pearsonCorrelation, dailyReturns, computeCorrelationMatrix } from '@/lib/analysis/correlation';

// computeCorrelationMatrix returns CorrelationCell[] (flat array, not {assets, matrix})

describe('pearsonCorrelation', () => {
  test('perfect positive → 1', () => {
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 5);
  });
  test('perfect negative → -1', () => {
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 5);
  });
  test('uncorrelated → near 0', () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [3, 1, 4, 1, 5, 9, 2, 6, 5, 3]);
    expect(Math.abs(r)).toBeLessThan(0.6);
  });
  test('degenerate → NaN', () => {
    expect(isNaN(pearsonCorrelation([5, 5, 5], [1, 2, 3]))).toBe(true);
  });
  test('returns NaN for < 2 points', () => {
    expect(isNaN(pearsonCorrelation([1], [2]))).toBe(true);
  });
});

describe('dailyReturns', () => {
  test('returns N-1 for N prices', () => {
    expect(dailyReturns([100, 101, 102]).length).toBe(2);
  });
  test('empty for < 2 prices', () => {
    expect(dailyReturns([100])).toEqual([]);
  });
});

describe('computeCorrelationMatrix', () => {
  test('produces N×N cells with diagonal', () => {
    const matrix = computeCorrelationMatrix({ A: [1, 2, 3, 4, 5], B: [5, 4, 3, 2, 1] });
    expect(matrix.length).toBe(4); // 2×2 = 4 cells
    const diag = matrix.filter(c => c.diagonal);
    expect(diag.length).toBe(2);
    diag.forEach(c => expect(c.r).toBe(1));
  });
});
