import { describe, test, expect } from 'bun:test';
import { hurstExponent } from '@/lib/analysis/hurst';

// hurstExponent returns a NUMBER (not an object) in this codebase.
// classifyRegime does NOT exist — only hurstExponent.

describe('hurstExponent', () => {
  test('white noise → H ≈ 0.5', () => {
    const wn = Array.from({ length: 600 }, () => (Math.random() - 0.5));
    const h = hurstExponent(wn);
    expect(h).toBeGreaterThan(0.35);
    expect(h).toBeLessThan(0.7);
  });
  test('anti-persistent → H < 0.5', () => {
    let ap = 0;
    const s = Array.from({ length: 600 }, () => (ap = -0.7 * ap + (Math.random() - 0.5)));
    expect(hurstExponent(s)).toBeLessThan(0.5);
  });
  test('persistent → H > 0.5', () => {
    let p = 0;
    const s = Array.from({ length: 600 }, () => (p = 0.7 * p + (Math.random() - 0.5)));
    expect(hurstExponent(s)).toBeGreaterThan(0.5);
  });
  test('returns 0.5 for insufficient data', () => {
    expect(hurstExponent([1, 2, 3])).toBe(0.5);
  });
});
