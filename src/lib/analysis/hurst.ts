/**
 * E10 — Hurst exponent via DFA (Detrended Fluctuation Analysis).
 *
 * DFA is more robust than the classic R/S estimator on small samples and
 * non-stationary series. The procedure:
 *
 *   1. Profile:      Y_i = Σ_{j=1..i} (x_j − mean(x))
 *   2. Segment:      split Y into non-overlapping windows of length n
 *   3. Detrend:      in each window, fit a line (DFA1) and take residuals
 *   4. RMS:          F(n) = sqrt( mean(residual_i²) )  across all windows
 *   5. Repeat:       for n in [minN .. maxN]
 *   6. Regress:      log F(n) vs log n → slope = H
 *
 * Interpretation:
 *   H < 0.5 → mean-reverting (anti-persistent)
 *   H = 0.5 → random walk
 *   H > 0.5 → trending (persistent)
 *
 * ⚠️ **CRITICAL**: call this on an I(0) series (returns, log-returns, or a
 * cointegration spread). Calling it on price levels will return H ≈ 1 (a
 * trivially persistent random walk) and produce no useful information.
 *
 * Integration (per handover §9 recommendation #2): use `classifyRegime()` as
 * a cointegration filter — skip pairs trades when spread Hurst > 0.55.
 */

// ---------------------------------------------------------------------------
// Pure-math helpers
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Ordinary least-squares line fit. Returns {slope, intercept}. */
function linFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  return { slope, intercept };
}

// ---------------------------------------------------------------------------
// DFA core
// ---------------------------------------------------------------------------

/**
 * Compute F(n) — the detrended fluctuation for a given window size n.
 * DFA1 (linear detrend).
 */
function dfaF(series: number[], n: number): number {
  const N = series.length;
  if (n < 2 || N < n) return 0;

  // 1. Profile: cumulative sum of (x - mean).
  const m = mean(series);
  const profile: number[] = new Array(N);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += series[i] - m;
    profile[i] = acc;
  }

  // 2-4. Segment → detrend → RMS.
  const nWindows = Math.floor(N / n);
  if (nWindows < 1) return 0;

  let sumSq = 0;
  for (let w = 0; w < nWindows; w++) {
    const start = w * n;
    // Local xs and ys for this window.
    const xs: number[] = new Array(n);
    const ys: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = i;
      ys[i] = profile[start + i];
    }
    const { slope, intercept } = linFit(xs, ys);
    let localSq = 0;
    for (let i = 0; i < n; i++) {
      const resid = ys[i] - (intercept + slope * xs[i]);
      localSq += resid * resid;
    }
    sumSq += localSq / n;
  }

  return Math.sqrt(sumSq / nWindows);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HurstResult {
  /** Hurst exponent (0..1). NaN if insufficient data. */
  hurst: number;
  /** Number of (n, F(n)) points used in the regression. */
  nPoints: number;
  /** R² of the log-log fit (goodness of fit). */
  rSquared: number;
  /** The window sizes evaluated. */
  windowSizes: number[];
  /** The F(n) values, same order as windowSizes. */
  fValues: number[];
}

/**
 * Compute the Hurst exponent via DFA.
 *
 * @param series  I(0) series (returns, spreads). NOT price levels.
 * @param minN    Smallest window size (default 4).
 * @param maxN    Largest window size (default N/4, capped).
 */
export function hurstExponent(
  series: number[],
  minN: number = 4,
  maxN?: number,
): HurstResult {
  const N = series.length;
  const empty: HurstResult = {
    hurst: NaN,
    nPoints: 0,
    rSquared: 0,
    windowSizes: [],
    fValues: [],
  };
  if (N < 16) return empty;

  const topN = maxN ?? Math.max(minN + 1, Math.floor(N / 4));

  // Build the (n, F(n)) list using a geometric progression of n.
  const ns: number[] = [];
  const fs: number[] = [];
  for (let n = minN; n <= topN; n = Math.floor(n * 1.4) + 1) {
    if (n > N) break;
    const f = dfaF(series, n);
    if (f > 0) {
      ns.push(n);
      fs.push(f);
    }
  }

  if (ns.length < 3) return empty;

  // log-log regression: log F = H · log n + c
  const logN = ns.map((n) => Math.log(n));
  const logF = fs.map((f) => Math.log(f));
  const { slope } = linFit(logN, logF);

  // R² for the fit.
  const logFmean = mean(logF);
  let ssTot = 0;
  let ssRes = 0;
  const { intercept } = linFit(logN, logF);
  for (let i = 0; i < logN.length; i++) {
    const pred = intercept + slope * logN[i];
    ssTot += (logF[i] - logFmean) * (logF[i] - logFmean);
    ssRes += (logF[i] - pred) * (logF[i] - pred);
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return {
    hurst: slope,
    nPoints: ns.length,
    rSquared: r2,
    windowSizes: ns,
    fValues: fs,
  };
}

// ---------------------------------------------------------------------------
// Regime classification
// ---------------------------------------------------------------------------

export type HurstLabel = 'MEAN_REVERTING' | 'TRENDING' | 'RANDOM';

export interface HurstRegime {
  hurst: number;
  label: HurstLabel;
  /** True when H < 0.45 — pairs-trading / mean-reversion strategies are valid. */
  meanRevertOk: boolean;
  /** True when H > 0.55 — trend-following / momentum strategies are valid. */
  momentumOk: boolean;
  /** R² of the underlying DFA fit (NaN if not computed). */
  rSquared: number;
}

/**
 * Classify a series into MEAN_REVERTING / TRENDING / RANDOM using the Hurst
 * exponent with 0.45 / 0.55 margins.
 *
 *   H < 0.45 → MEAN_REVERTING (meanRevertOk=true)
 *   H > 0.55 → TRENDING       (momentumOk=true)
 *   else     → RANDOM
 *
 * The dead-band around 0.5 prevents flipping strategy regime on noise.
 */
export function classifyRegime(
  series: number[],
  minN: number = 4,
  maxN?: number,
): HurstRegime {
  const r = hurstExponent(series, minN, maxN);
  const H = r.hurst;

  if (!Number.isFinite(H)) {
    return { hurst: NaN, label: 'RANDOM', meanRevertOk: false, momentumOk: false, rSquared: NaN };
  }

  let label: HurstLabel;
  let meanRevertOk: boolean;
  let momentumOk: boolean;

  if (H < 0.45) {
    label = 'MEAN_REVERTING';
    meanRevertOk = true;
    momentumOk = false;
  } else if (H > 0.55) {
    label = 'TRENDING';
    meanRevertOk = false;
    momentumOk = true;
  } else {
    label = 'RANDOM';
    meanRevertOk = false;
    momentumOk = false;
  }

  return { hurst: H, label, meanRevertOk, momentumOk, rSquared: r.rSquared };
}
