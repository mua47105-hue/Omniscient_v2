/**
 * Correlation + regression utilities — pure TS, no deps.
 *
 *   - pearsonCorrelation(x, y)              → r in [-1, +1]
 *   - dailyReturns(prices)                 → log-returns aligned to bars
 *   - computeCorrelationMatrix(returns)    → N×N matrix with all pairwise r
 *   - linearRegression(y, x)               → {slope, intercept, rSquared}
 *
 * The matrix is symmetric (r(x,y) == r(y,x)) so we only compute the upper
 * triangle and mirror it. Returns map {symbol: number[]} of aligned returns
 * (caller is responsible for alignment — typically by trimming to the
 * shortest series).
 */

// ---------------------------------------------------------------------------
// Pearson correlation
// ---------------------------------------------------------------------------

export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;

  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  if (den === 0) return 0;
  return num / den;
}

// ---------------------------------------------------------------------------
// Daily (log) returns
// ---------------------------------------------------------------------------

/**
 * Convert a price series to log-returns. r_t = ln(p_t / p_{t-1}).
 * Returns an array of length n-1. Handles zero/negative prices by skipping.
 */
export function dailyReturns(prices: number[]): number[] {
  if (prices.length < 2) return [];
  const out: number[] = new Array(prices.length - 1);
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1];
    const b = prices[i];
    if (a > 0 && b > 0 && Number.isFinite(a) && Number.isFinite(b)) {
      out[i - 1] = Math.log(b / a);
    } else {
      out[i - 1] = 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Linear regression (y = slope·x + intercept)
// ---------------------------------------------------------------------------

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  n: number;
}

export function linearRegression(
  y: number[],
  x: number[],
): LinearRegressionResult {
  const n = Math.min(y.length, x.length);
  if (n < 2) return { slope: 0, intercept: 0, rSquared: 0, n };

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;

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

  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const rSquared = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, intercept, rSquared, n };
}

// ---------------------------------------------------------------------------
// Correlation matrix
// ---------------------------------------------------------------------------

export interface CorrelationMatrixEntry {
  x: string;
  y: string;
  r: number; // -1..1
}

export interface CorrelationMatrix {
  assets: string[];
  /** Flat list of upper-triangular pair entries (for sortable tables). */
  entries: CorrelationMatrixEntry[];
  /** 2D matrix: matrix[i][j] = r(assets[i], assets[j]). Diagonal = 1. */
  matrix: number[][];
}

/**
 * Compute the Pearson correlation matrix for a map of {symbol: returns}.
 * Inputs are pre-aligned by the caller (we use the trailing min length).
 */
export function computeCorrelationMatrix(
  returns: Record<string, number[]>,
): CorrelationMatrix {
  const assets = Object.keys(returns).sort();
  const n = assets.length;
  const matrix: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(0),
  );
  const entries: CorrelationMatrixEntry[] = [];

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const r = pearsonCorrelation(returns[assets[i]], returns[assets[j]]);
      matrix[i][j] = r;
      matrix[j][i] = r;
      entries.push({ x: assets[i], y: assets[j], r });
    }
  }

  entries.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return { assets, entries, matrix };
}
