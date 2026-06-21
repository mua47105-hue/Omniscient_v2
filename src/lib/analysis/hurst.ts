// E10 — Hurst Exponent Regime Filter
//
// Source: "OMNISCIENT — Field Guide to Real Edge (Vol. 2)", Suggestion E10.
// Evidence: MDPI 2024 (Mathematics) "Anti-Persistent Values of the Hurst
// Exponent Anticipate Mean Reversion"; Amberdata ADF+Hurst for crypto pairs.
//
// What: H < 0.5 = mean-reverting regime. H > 0.5 = trending regime. H ≈ 0.5 =
// random walk. Use as a regime filter: only enable mean-reversion strategies
// (e.g. cointegration pairs, E3) when H < 0.5; only enable momentum when H > 0.5.
//
// Prevents mean-reversion blowups in trending regimes — LUNA, FTX, SVB all
// broke cointegration. Pair with E3: skip the pairs trade when spread H > 0.55.
//
// Counter-argument: Hurst is backward-looking — slow to detect regime change.
// Mitigation: use a LOCAL/ROLLING window (60 bars), not full-sample.
//
// Method: Detrended Fluctuation Analysis (DFA).
//   1. Compute profile Y_t = Σ(x_i − mean)
//   2. For window sizes n in [16,32,64,128,256]: segment, fit linear trend per
//      segment, compute RMS of residuals F(n)
//   3. log-log regress log(F(n)) on log(n); slope = H
//
// ponytail: pure function, no deps. Reuse the OLS slope from cointegration.ts.

import { ols } from '@/lib/analysis/cointegration';

/**
 * Compute the Hurst exponent via DFA. Returns 0.5 (random walk) on
 * insufficient data — a safe neutral default that won't trigger either filter.
 */
export function hurstExponent(series: number[], minN = 16, maxN = 256): number {
  if (!series || series.length < maxN * 2) return 0.5;

  // 1. Profile (cumulative deviation from mean).
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const profile: number[] = [];
  let cumsum = 0;
  for (const x of series) {
    cumsum += x - mean;
    profile.push(cumsum);
  }

  // 2. For each window size n, segment the profile, detrend each segment with
  //    a linear fit, compute the RMS fluctuation F(n).
  const logNs: number[] = [];
  const logFs: number[] = [];
  for (let n = minN; n <= maxN; n *= 2) {
    const nWindows = Math.floor(profile.length / n);
    if (nWindows < 2) continue;
    let fSum = 0;
    for (let w = 0; w < nWindows; w++) {
      const window = profile.slice(w * n, (w + 1) * n);
      // Linear detrend: regress window on [0,1,2,...] and take residuals.
      const xs = window.map((_, i) => i);
      const { slope, intercept } = ols(xs, window);
      let ssr = 0;
      for (let i = 0; i < window.length; i++) {
        const resid = window[i] - (intercept + slope * xs[i]);
        ssr += resid * resid;
      }
      fSum += Math.sqrt(ssr / window.length);
    }
    const f = fSum / nWindows;
    if (f > 0) {
      logNs.push(Math.log(n));
      logFs.push(Math.log(f));
    }
  }

  // Need ≥3 points for a meaningful slope.
  if (logNs.length < 3) return 0.5;
  // 3. log-log regression slope = H.
  const { slope } = ols(logNs, logFs);
  // Clamp to a sane range [0, 1] (true Hurst bounds).
  return Math.max(0, Math.min(1, slope));
}

export interface Regime {
  hurst: number;
  label: 'MEAN_REVERTING' | 'TRENDING' | 'RANDOM';
  /** Allow mean-reversion strategies (cointegration)? H < 0.5, with margin. */
  meanRevertOk: boolean;
  /** Allow momentum strategies? H > 0.5, with margin. */
  momentumOk: boolean;
}

/**
 * Classify a series into a regime via the Hurst exponent.
 * Margins (0.45/0.55) avoid flapping at the 0.5 boundary.
 */
export function classifyRegime(series: number[]): Regime {
  const hurst = hurstExponent(series);
  let label: Regime['label'] = 'RANDOM';
  if (hurst < 0.45) label = 'MEAN_REVERTING';
  else if (hurst > 0.55) label = 'TRENDING';
  return {
    hurst: Math.round(hurst * 100) / 100,
    label,
    meanRevertOk: hurst < 0.5,
    momentumOk: hurst > 0.5,
  };
}
