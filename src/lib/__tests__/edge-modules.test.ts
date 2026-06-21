// Characterization tests for src/lib/analysis/hurst.ts, triple-barrier.ts, deflated-sharpe.ts

import { hurstExponent, classifyRegime } from '@/lib/analysis/hurst';
import { tripleBarrierLabel, DEFAULT_TB_CONFIG } from '@/lib/analysis/triple-barrier';
import { deflatedSharpeRatio, moments, dsrVerdict } from '@/lib/analysis/deflated-sharpe';
import type { Kline } from '@/lib/types';
import { describe, test, expect } from 'bun:test';

// --- Hurst ---

describe('hurstExponent', () => {
  test('white noise → H ≈ 0.5 (RANDOM)', () => {
    const wn = Array.from({ length: 600 }, () => (Math.random() - 0.5));
    const result = hurstExponent(wn);
    // Returns a HurstResult object — H is on `.hurst`.
    expect(result.hurst).toBeGreaterThan(0.4);
    expect(result.hurst).toBeLessThan(0.7);
    expect(result.nPoints).toBeGreaterThan(0);
    expect(result.windowSizes.length).toBe(result.fValues.length);
  });

  test('strongly anti-persistent (φ=-0.7) → H < 0.5', () => {
    // DFA needs a strong negative AR(1) coefficient to register H < 0.5
    // on a 600-sample window — φ=-0.3 is too weak.
    let ap = 0;
    const series = Array.from({ length: 600 }, () => (ap = -0.7 * ap + (Math.random() - 0.5)));
    const result = hurstExponent(series);
    expect(result.hurst).toBeLessThan(0.5);
  });

  test('strongly persistent (φ=0.85) → H > 0.5', () => {
    let p = 0;
    const series = Array.from({ length: 600 }, () => (p = 0.85 * p + (Math.random() - 0.5)));
    const result = hurstExponent(series);
    expect(result.hurst).toBeGreaterThan(0.5);
  });

  test('returns NaN hurst for insufficient data (< 16 samples)', () => {
    const result = hurstExponent([1, 2, 3]);
    expect(Number.isNaN(result.hurst)).toBe(true);
    expect(result.nPoints).toBe(0);
    expect(result.windowSizes).toEqual([]);
  });
});

describe('classifyRegime', () => {
  test('strongly anti-persistent → MEAN_REVERTING', () => {
    let ap = 0;
    const series = Array.from({ length: 600 }, () => (ap = -0.7 * ap + (Math.random() - 0.5)));
    const regime = classifyRegime(series);
    expect(regime.label).toBe('MEAN_REVERTING');
    expect(regime.meanRevertOk).toBe(true);
    expect(regime.momentumOk).toBe(false);
  });

  test('strongly persistent → TRENDING', () => {
    let p = 0;
    const series = Array.from({ length: 600 }, () => (p = 0.85 * p + (Math.random() - 0.5)));
    const regime = classifyRegime(series);
    expect(regime.label).toBe('TRENDING');
    expect(regime.momentumOk).toBe(true);
    expect(regime.meanRevertOk).toBe(false);
  });
});

// --- Triple-Barrier ---

// Helper: build a minimal Kline. The implementation only reads .high/.low/.close.
function bar(high: number, low: number, close: number): Kline {
  return {
    openTime: 0, open: close, high, low, close,
    volume: 0, closeTime: 0, quoteVolume: 0,
  } as Kline;
}

describe('tripleBarrierLabel', () => {
  const klines: Kline[] = [
    bar(102, 99, 101),
    bar(104, 100, 103),
    bar(106, 102, 105),
    bar(103, 97, 98),
  ];

  test('TP hit → label 1, exitReason "take-profit"', () => {
    // Entry 100, ATR 2, TP=100+2*2=104. Bar 1 has high=104 → TP hit.
    const result = tripleBarrierLabel(100, 2, klines, 0, {
      ...DEFAULT_TB_CONFIG, tpMult: 2, slMult: 1.5, direction: 'long',
    });
    expect(result.label).toBe(1);
    expect(result.exitReason).toBe('take-profit');
  });

  test('SL hit → label -1, exitReason "stop-loss" (SL checked first)', () => {
    // Entry 100, ATR 2, SL=100-1.5*2=97. Bar 3 has low=97 → SL hit.
    const result = tripleBarrierLabel(100, 2, klines, 0, {
      ...DEFAULT_TB_CONFIG, tpMult: 10, slMult: 1.5, holdingPeriod: 4, direction: 'long',
    });
    expect(result.label).toBe(-1);
    expect(result.exitReason).toBe('stop-loss');
  });

  test('Timeout → label 0, exitReason "timeout"', () => {
    // Tight barriers that never hit within holdingPeriod.
    const flatKlines = Array.from({ length: 5 }, () => bar(100.5, 99.5, 100));
    const result = tripleBarrierLabel(100, 2, flatKlines, 0, {
      ...DEFAULT_TB_CONFIG, tpMult: 10, slMult: 10, holdingPeriod: 3, direction: 'long',
    });
    expect(result.label).toBe(0);
    expect(result.exitReason).toBe('timeout');
  });

  test('returnR is 4/3 for TP at 2×ATR with SL at 1.5×ATR (long)', () => {
    // Need at least 2 bars so the forward scan actually runs (entryIndex+1
    // must be ≤ timeoutBar). With a single bar the loop never executes and
    // the impl returns a timeout fallback.
    const tpKlines: Kline[] = [
      bar(105, 100, 104), // entry bar (index 0)
      bar(106, 101, 105), // bar 1 — TP at 104 hit (high=106 ≥ 104)
    ];
    // Entry 100, ATR 2, TP=100+2*2=104, SL=100-1.5*2=97. Risk = 3.
    // Return = (104-100)/100 = 0.04; returnR = 0.04 / 0.03 = 4/3.
    const result = tripleBarrierLabel(100, 2, tpKlines, 0, {
      ...DEFAULT_TB_CONFIG, tpMult: 2, slMult: 1.5, direction: 'long',
    });
    expect(result.label).toBe(1);
    expect(result.returnR).toBeCloseTo(4 / 3, 1);
  });

  test('short side: TP below entry → label 1', () => {
    // Entry 100, short, TP=100-2*2=96. Bar 1 low=95 → TP hit.
    const shortKlines: Kline[] = [
      bar(101, 99, 100), // entry bar
      bar(101, 95, 97),  // bar 1 — TP at 96 hit (low=95 ≤ 96)
    ];
    const result = tripleBarrierLabel(100, 2, shortKlines, 0, {
      ...DEFAULT_TB_CONFIG, tpMult: 2, slMult: 1.5, direction: 'short',
    });
    expect(result.label).toBe(1);
    expect(result.exitReason).toBe('take-profit');
  });
});

// --- Deflated Sharpe Ratio ---

describe('deflatedSharpeRatio', () => {
  test('high per-period Sharpe + few trials → high DSR (likely genuine)', () => {
    const result = deflatedSharpeRatio({
      sharpe: 2.0,
      skewness: 0,
      excessKurtosis: 0,
      nObservations: 200,
      nTrials: 5,
      perPeriodSharpe: 0.5,
    });
    // Returns a DsrResult object — DSR is on `.dsr`.
    expect(result.dsr).toBeGreaterThan(0.8);
    expect(result.verdict).toBe('genuine');
  });

  test('low Sharpe + many trials → low DSR (likely noise)', () => {
    const result = deflatedSharpeRatio({
      sharpe: 0.3,
      skewness: 0,
      excessKurtosis: 0,
      nObservations: 50,
      nTrials: 100,
      perPeriodSharpe: 0.05,
    });
    expect(result.dsr).toBeLessThan(0.5);
    expect(result.verdict).toBe('noise');
  });

  test('returns dsr=0 for < 2 observations', () => {
    const result = deflatedSharpeRatio({
      sharpe: 5, skewness: 0, excessKurtosis: 0,
      nObservations: 1, nTrials: 1, perPeriodSharpe: 5,
    });
    expect(result.dsr).toBe(0);
    expect(result.verdict).toBe('noise');
  });

  test('DSR is in [0, 1]', () => {
    const result = deflatedSharpeRatio({
      sharpe: 1.5,
      skewness: -0.5,
      excessKurtosis: 2,
      nObservations: 100,
      nTrials: 20,
      perPeriodSharpe: 0.3,
    });
    expect(result.dsr).toBeGreaterThanOrEqual(0);
    expect(result.dsr).toBeLessThanOrEqual(1);
    // Verdict bucket must be one of the four allowed labels.
    expect(['genuine', 'likely', 'inconclusive', 'noise']).toContain(result.verdict);
  });
});

describe('moments', () => {
  test('normal data (Box-Muller) → skewness ≈ 0, excessKurtosis ≈ 0', () => {
    // Box-Muller transform: properly normal samples (uniform random would
    // give excessKurtosis ≈ -1.2, not 0).
    const returns = Array.from({ length: 2000 }, () => {
      const u1 = Math.random();
      const u2 = Math.random();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * 0.01;
    });
    const m = moments(returns);
    expect(Math.abs(m.skewness)).toBeLessThan(0.2);
    // Field is `excessKurtosis` (kurt_raw − 3, so ≈ 0 for normal data).
    expect(Math.abs(m.excessKurtosis)).toBeLessThan(0.5);
  });

  test('returns 0/0 for < 3 points', () => {
    const m = moments([1, 2]);
    expect(m.skewness).toBe(0);
    expect(m.excessKurtosis).toBe(0);
  });
});

describe('dsrVerdict', () => {
  test('DSR ≥ 0.95 → genuine', () => {
    // Returns the verdict string directly, not an object.
    expect(dsrVerdict(0.96)).toBe('genuine');
  });

  test('DSR < 0.50 → noise', () => {
    expect(dsrVerdict(0.3)).toBe('noise');
  });
});
