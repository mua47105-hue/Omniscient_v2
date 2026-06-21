/**
 * E3 — Engle-Granger cointegration (own OLS + ADF, no deps).
 *
 * Two-step Engle-Granger:
 *   1. OLS regress y on x (with intercept): y = α + β·x + ε
 *   2. ADF test on the residuals ε. If the ADF statistic is more negative
 *      than the MacKinnon critical value, the residuals are stationary and
 *      the pair is cointegrated.
 *
 * If cointegrated, we additionally compute:
 *   - hedgeRatio β (from the OLS slope)
 *   - halfLife  (Ornstein-Uhlenbeck mean-reversion half-life, in bars)
 *   - zScore    (current residual standardised by its in-sample std-dev)
 *   - tradeable boolean (cointegrated + |z| ≥ 1 + reasonable half-life)
 *   - signal    ('long-spread' | 'short-spread' | 'flat')
 *
 * Evidence: Yale 2024 statistical-arbitrage study on crypto pairs reports
 * Sharpe ≈ 1.35 with Engle-Granger cointegration filter + z-score entry.
 *
 * CRITICAL: `engleGranger()` must be called on **price levels** (not returns),
 * because we are explicitly looking for a stationary linear combination of
 * I(1) series. Contrast with `hurst.ts`, which must be called on I(0) series.
 */

// ---------------------------------------------------------------------------
// MacKinnon (1996) critical values for the Engle-Granger residual ADF test
// (no constant, no trend — the residuals have zero mean by construction).
// ---------------------------------------------------------------------------

const MACKINNON_CRITICAL: Record<'1pct' | '5pct' | '10pct', number> = {
  '1pct': -3.43,
  '5pct': -2.86,
  '10pct': -2.57,
};

// ---------------------------------------------------------------------------
// Pure-math helpers
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function variance(xs: number[], sample: boolean = true): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (sample ? n - 1 : n);
}

function stdDev(xs: number[]): number {
  return Math.sqrt(variance(xs, true));
}

/**
 * Own OLS regression with intercept.
 *   y = α + β·x + ε
 * Returns intercept α, slope β, residuals ε, and standard error of the slope
 * (used for the t-stat in ADF below).
 */
export interface OlsResult {
  alpha: number;
  beta: number;
  residuals: number[];
  rSquared: number;
  slopeStdErr: number;
}

export function ols(y: number[], x: number[]): OlsResult {
  const n = Math.min(y.length, x.length);
  if (n < 3) {
    return { alpha: 0, beta: 0, residuals: [], rSquared: 0, slopeStdErr: 0 };
  }
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  const beta = sxx > 0 ? sxy / sxx : 0;
  const alpha = my - beta * mx;

  const residuals: number[] = new Array(n);
  for (let i = 0; i < n; i++) residuals[i] = y[i] - (alpha + beta * x[i]);

  // R²
  const rSquared = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;

  // Standard error of the slope: sqrt(MSE / sxx), MSE = SSE/(n-2)
  let sse = 0;
  for (const r of residuals) sse += r * r;
  const mse = n > 2 ? sse / (n - 2) : 0;
  const slopeStdErr = sxx > 0 ? Math.sqrt(mse / sxx) : 0;

  return { alpha, beta, residuals, rSquared, slopeStdErr };
}

// ---------------------------------------------------------------------------
// ADF test on a residual series (no constant, no trend)
// ---------------------------------------------------------------------------

export interface AdfResult {
  /** The ADF test statistic (t-stat on the lag-1 coefficient). */
  adfStat: number;
  /** Approximate p-value derived from the MacKinnon critical values. */
  pValue: number;
  /** Critical-value verdict. */
  isStationary: boolean;
  n: number;
}

/**
 * Augmented Dickey-Fuller test on residuals (no constant, no trend):
 *
 *   Δy_t = γ·y_{t-1} + ε_t
 *
 * The t-statistic on γ is the ADF statistic. We use the simplest form (no
 * lagged Δy terms) since the input is already an OLS residual series and we
 * want the test to be fast enough to run on every pair in a matrix.
 *
 * p-value is approximated by linear interpolation between the MacKinnon
 * critical values — sufficient for a "is this tradeable" gate.
 */
export function adfTest(residuals: number[]): AdfResult {
  const n = residuals.length;
  if (n < 5) {
    return { adfStat: 0, pValue: 1, isStationary: false, n };
  }

  // Δy_t and y_{t-1} for t = 1..n-1
  const dy: number[] = new Array(n - 1);
  const yLag: number[] = new Array(n - 1);
  for (let i = 1; i < n; i++) {
    dy[i - 1] = residuals[i] - residuals[i - 1];
    yLag[i - 1] = residuals[i - 1];
  }

  // OLS through the origin: dy = γ·yLag
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < dy.length; i++) {
    sxx += yLag[i] * yLag[i];
    sxy += yLag[i] * dy[i];
  }
  const gamma = sxx > 0 ? sxy / sxx : 0;

  // Residuals of this regression → used for the std error of γ
  let sse = 0;
  for (let i = 0; i < dy.length; i++) {
    const pred = gamma * yLag[i];
    sse += (dy[i] - pred) * (dy[i] - pred);
  }
  const k = dy.length;
  const mse = k > 1 ? sse / (k - 1) : 0;
  const seGamma = sxx > 0 ? Math.sqrt(mse / sxx) : 0;
  const adfStat = seGamma > 0 ? gamma / seGamma : 0;

  // p-value via inverse-linear interpolation of MacKinnon criticals.
  const pValue = approxPValue(adfStat);
  const isStationary = adfStat < MACKINNON_CRITICAL['5pct'];

  return { adfStat, pValue, isStationary, n };
}

/**
 * Approximate p-value by linear interpolation between MacKinnon criticals.
 * Below the 1% critical → p ≈ 0.005; above the 10% critical → p ≈ 0.99.
 * Between criticals, linear in the stat.
 */
function approxPValue(adf: number): number {
  const c1 = MACKINNON_CRITICAL['1pct']; // -3.43, p=0.01
  const c5 = MACKINNON_CRITICAL['5pct']; // -2.86, p=0.05
  const c10 = MACKINNON_CRITICAL['10pct']; // -2.57, p=0.10

  if (adf <= c1) return 0.005;
  if (adf >= c10) return 0.99;
  if (adf <= c5) {
    // between c1 and c5 → p in (0.01, 0.05)
    const t = (adf - c1) / (c5 - c1);
    return 0.01 + t * (0.05 - 0.01);
  }
  // between c5 and c10 → p in (0.05, 0.10)
  const t = (adf - c5) / (c10 - c5);
  return 0.05 + t * (0.10 - 0.05);
}

// ---------------------------------------------------------------------------
// Half-life (Ornstein-Uhlenbeck)
// ---------------------------------------------------------------------------

/**
 * Mean-reversion half-life (in bars) of a residual series.
 *
 * Regress Δresidual_t on -residual_{t-1}: the slope λ gives the speed of
 * mean reversion. Half-life = ln(2) / λ. A half-life of 5 bars means a
 * deviation decays to half its size in 5 bars. We require 1 ≤ half-life ≤ 250
 * for the spread to be practically tradeable.
 */
export function halfLife(residuals: number[]): number {
  const n = residuals.length;
  if (n < 5) return Infinity;

  const dy: number[] = new Array(n - 1);
  const yLag: number[] = new Array(n - 1);
  for (let i = 1; i < n; i++) {
    dy[i - 1] = residuals[i] - residuals[i - 1];
    yLag[i - 1] = residuals[i - 1];
  }

  // OLS through the origin with sign flip: dy = -λ · yLag
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < dy.length; i++) {
    sxx += yLag[i] * yLag[i];
    sxy += yLag[i] * dy[i];
  }
  const slope = sxx > 0 ? sxy / sxx : 0; // this is -λ
  const lambda = -slope;
  if (lambda <= 0) return Infinity;
  return Math.log(2) / lambda;
}

// ---------------------------------------------------------------------------
// Engle-Granger end-to-end
// ---------------------------------------------------------------------------

export type CointegrationSignal = 'long-spread' | 'short-spread' | 'flat';

export interface EngleGrangerResult {
  pair: string;
  hedgeRatio: number;
  adfStat: number;
  pValue: number;
  isCointegrated: boolean;
  halfLife: number;
  zScore: number;
  tradeable: boolean;
  signal: CointegrationSignal;
  n: number;
}

export interface EngleGrangerOptions {
  /** Minimum sample size to attempt the test. */
  minObs?: number;
  /** Minimum |z| for the tradeable flag. */
  minZScore?: number;
  /** Maximum half-life (in bars) for the tradeable flag. */
  maxHalfLife?: number;
  /** Minimum half-life (in bars) — sub-1 bar means pure noise. */
  minHalfLife?: number;
}

export function engleGranger(
  y: number[],
  x: number[],
  pair: string,
  lookback?: number,
  options: EngleGrangerOptions = {},
): EngleGrangerResult {
  const minObs = options.minObs ?? 30;
  const minZ = options.minZScore ?? 1.0;
  const maxHL = options.maxHalfLife ?? 250;
  const minHL = options.minHalfLife ?? 1;

  // Apply lookback window if requested.
  let yy = y;
  let xx = x;
  if (lookback && lookback > 0) {
    const n = Math.min(y.length, x.length);
    const start = Math.max(0, n - lookback);
    yy = y.slice(start);
    xx = x.slice(start);
  }

  const n = Math.min(yy.length, xx.length);

  // Defaults for the degenerate case.
  const empty: EngleGrangerResult = {
    pair,
    hedgeRatio: 0,
    adfStat: 0,
    pValue: 1,
    isCointegrated: false,
    halfLife: Infinity,
    zScore: 0,
    tradeable: false,
    signal: 'flat',
    n,
  };

  if (n < minObs) return empty;

  const olsResult = ols(yy, xx);
  if (olsResult.residuals.length < minObs) return empty;

  const adf = adfTest(olsResult.residuals);
  const hl = halfLife(olsResult.residuals);

  // z-score of the most recent residual.
  const rMean = mean(olsResult.residuals);
  const rSd = stdDev(olsResult.residuals);
  const lastResid = olsResult.residuals[olsResult.residuals.length - 1];
  const zScore = rSd > 0 ? (lastResid - rMean) / rSd : 0;

  const isCointegrated = adf.isStationary;
  const tradeable =
    isCointegrated &&
    Math.abs(zScore) >= minZ &&
    Number.isFinite(hl) &&
    hl >= minHL &&
    hl <= maxHL;

  let signal: CointegrationSignal = 'flat';
  if (tradeable) {
    // Positive z (y rich relative to x): short y, long x → "short-spread".
    signal = zScore > 0 ? 'short-spread' : 'long-spread';
  }

  return {
    pair,
    hedgeRatio: olsResult.beta,
    adfStat: adf.adfStat,
    pValue: adf.pValue,
    isCointegrated,
    halfLife: hl,
    zScore,
    tradeable,
    signal,
    n,
  };
}

// ---------------------------------------------------------------------------
// Cointegration matrix
// ---------------------------------------------------------------------------

export interface CointegrationMatrixEntry {
  pair: string;
  x: string;
  y: string;
  hedgeRatio: number;
  adfStat: number;
  pValue: number;
  isCointegrated: boolean;
  halfLife: number;
  zScore: number;
  tradeable: boolean;
  signal: CointegrationSignal;
}

export interface CointegrationMatrix {
  assets: string[];
  entries: CointegrationMatrixEntry[];
  /** Map of "ASSET_A|ASSET_B" → entry, for O(1) lookup. */
  byPair: Record<string, CointegrationMatrixEntry>;
}

/**
 * Compute pairwise Engle-Granger cointegration for every pair in `prices`.
 *
 * `prices` is a map of asset symbol → price series (aligned by timestamp,
 * same length). The output is a flat list of upper-triangular pair entries
 * plus a lookup map.
 *
 * Cost: O(n²) pairs × O(lookback) for the OLS+ADF. For a 10-asset universe
 * with 200-bar lookback that's 45 pairs × ~600 ops = ~27k ops per refresh —
 * well under a second.
 */
export function computeCointegrationMatrix(
  prices: Record<string, number[]>,
  options: EngleGrangerOptions & { lookback?: number } = {},
): CointegrationMatrix {
  const assets = Object.keys(prices).sort();
  const entries: CointegrationMatrixEntry[] = [];
  const byPair: Record<string, CointegrationMatrixEntry> = {};

  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      const x = assets[i];
      const y = assets[j];
      const px = prices[x];
      const py = prices[y];
      if (!px || !py) continue;
      const pair = `${y}/${x}`;
      const r = engleGranger(py, px, pair, options.lookback, options);
      const entry: CointegrationMatrixEntry = {
        pair,
        x,
        y,
        hedgeRatio: r.hedgeRatio,
        adfStat: r.adfStat,
        pValue: r.pValue,
        isCointegrated: r.isCointegrated,
        halfLife: r.halfLife,
        zScore: r.zScore,
        tradeable: r.tradeable,
        signal: r.signal,
      };
      entries.push(entry);
      byPair[`${x}|${y}`] = entry;
      byPair[`${y}|${x}`] = entry;
    }
  }

  // Sort: tradeable first, then by |zScore| desc.
  entries.sort((a, b) => {
    if (a.tradeable !== b.tradeable) return a.tradeable ? -1 : 1;
    return Math.abs(b.zScore) - Math.abs(a.zScore);
  });

  return { assets, entries, byPair };
}
