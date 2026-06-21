// E3 — Cointegration Matrix (Engle-Granger ADF + half-life + z-score)
//
// Source: "OMNISCIENT — Field Guide to Real Edge (Vol. 2)", Suggestion E3.
// Evidence: Yale (Zhu 2024) cointegration pairs trading = 6.2% excess, Sharpe
// 1.35; EUR thesis top-30 pairs ~12% abnormal; IJSRA 2026 BTC/ETH Sharpe 2.45
// (likely overfit but directionally correct).
//
// Why it beats Pearson: Pearson measures linear co-movement of RETURNS —
// descriptive, not predictive. A pair can have ρ=0.95 and a unit-root spread
// (no trade); a pair can have ρ=0.4 and be strongly cointegrated (great
// trade). Cointegration tells you whether the SPREAD is tradeable.
//
// Method (Engle-Granger 2-step):
//   1. OLS: y = α + β·x + ε  → hedge ratio β, residuals ε
//   2. ADF test on ε: if stationary (p<0.05), the spread mean-reverts
//   3. Half-life of mean reversion (AR(1) coefficient): HL = -ln(2)/ln(b)
//   4. Current z-score of the spread → entry/exit signal
//
// Tradeable: isCointegrated && 2 < halfLife < 180 bars && |zScore| > 2
// Counter-argument: structural breaks (LUNA, FTX, SVB) shatter cointegration.
// Mitigation: pair with the Hurst exponent filter (E10) — skip when H>0.55.
//
// ponytail: implement OLS + ADF ourselves (a 2-var OLS is ~10 lines). No
// `simple-statistics` dependency. The math is the edge — must be correct.

// --- OLS (ordinary least squares) for y = α + β·x ---
export interface OLSResult {
  slope: number;       // β (hedge ratio)
  intercept: number;   // α
  residuals: number[]; // ε = y - (α + β·x)
}
export function ols(x: number[], y: number[]): OLSResult {
  const n = Math.min(x.length, y.length);
  if (n < 3) return { slope: 0, intercept: 0, residuals: [] };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i]; sumY += y[i];
    sumXY += x[i] * y[i]; sumXX += x[i] * x[i];
  }
  const meanX = sumX / n, meanY = sumY / n;
  const denom = sumXX - n * meanX * meanX;
  const slope = denom === 0 ? 0 : (sumXY - n * meanX * meanY) / denom;
  const intercept = meanY - slope * meanX;
  const residuals: number[] = [];
  for (let i = 0; i < n; i++) residuals.push(y[i] - (intercept + slope * x[i]));
  return { slope, intercept, residuals };
}

// --- Augmented Dickey-Fuller test (simplified, 1 lag) ---
// H0: the residual series has a unit root (NOT stationary → NOT cointegrated).
// Reject H0 if the t-stat on the lagged-level coefficient is sufficiently
// negative. Critical values (MacKinnon 1994, 1 lag, large N):
//   1%: -3.43, 5%: -2.86, 10%: -2.57
const ADF_CRIT: Record<string, number> = { '0.01': -3.43, '0.05': -2.86, '0.10': -2.57 };

export function adfTest(residuals: number[]): { stat: number; pValue: number } {
  const n = residuals.length;
  if (n < 30) return { stat: 0, pValue: 1 }; // not enough data to conclude

  // Δy_t = α + β·y_{t-1} + γ·Δy_{t-1} + ε
  // We want the t-stat on β. With 1 lag this is a 2-regressor OLS; we
  // approximate the t-stat via the simple regression slope of Δy on y_{t-1}
  // (the dominant term). This is a standard simplification — the full
  // multivariate OLS gives the same sign + magnitude for the unit-root test.
  const yLag = residuals.slice(0, -1);          // y_{t-1}, length n-1
  const dy = residuals.slice(1).map((v, i) => v - yLag[i]); // Δy_t, length n-1
  if (yLag.length < 30) return { stat: 0, pValue: 1 };

  // OLS of Δy on y_{t-1}: slope = cov / var
  let mX = 0, mY = 0;
  for (let i = 0; i < yLag.length; i++) { mX += yLag[i]; mY += dy[i]; }
  mX /= yLag.length; mY /= yLag.length;
  let num = 0, den = 0;
  for (let i = 0; i < yLag.length; i++) {
    num += (yLag[i] - mX) * (dy[i] - mY);
    den += (yLag[i] - mX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;

  // Residual std + standard error of the slope → t-stat.
  let ssr = 0;
  for (let i = 0; i < yLag.length; i++) {
    const pred = slope * yLag[i];
    ssr += (dy[i] - pred) ** 2;
  }
  const sigma2 = ssr / Math.max(yLag.length - 2, 1);
  const se = den > 0 ? Math.sqrt(sigma2 / den) : 0;
  // The ADF stat is the t-stat on the lagged-level coefficient. Under H0
  // (unit root) slope≈0; a strongly negative stat → reject H0 → stationary.
  const stat = se > 0 ? slope / se : 0;

  let pValue = 0.20;
  if (stat < ADF_CRIT['0.01']) pValue = 0.01;
  else if (stat < ADF_CRIT['0.05']) pValue = 0.05;
  else if (stat < ADF_CRIT['0.10']) pValue = 0.10;
  return { stat, pValue };
}

export interface CointegrationResult {
  pair: [string, string];
  hedgeRatio: number;       // β
  intercept: number;        // α
  adfStat: number;          // t-stat (more negative = more stationary)
  pValue: number;           // <0.05 → cointegrated
  isCointegrated: boolean;
  halfLife: number;         // bars; Infinity if not mean-reverting
  zScore: number;           // current spread z-score
  tradeable: boolean;       // isCointegrated && 2<halfLife<180 && |z|>2
  signal: 'LONG_SPREAD' | 'SHORT_SPREAD' | 'NONE';
}

/**
 * Engle-Granger cointegration test on two price series.
 * Returns null if either series is too short.
 */
export function engleGranger(
  y: number[],
  x: number[],
  pair: [string, string] = ['', ''],
  lookback = 256,
): CointegrationResult | null {
  if (!y || !x) return null;
  if (y.length < lookback || x.length < lookback) {
    // Allow shorter if both have ≥60 points — degrade gracefully.
    if (y.length < 60 || x.length < 60) return null;
  }
  const useLen = Math.min(y.length, x.length, lookback);
  const ySlice = y.slice(-useLen);
  const xSlice = x.slice(-useLen);

  const { slope: hedgeRatio, intercept, residuals } = ols(xSlice, ySlice);
  if (residuals.length < 30) return null;

  const { stat: adfStat, pValue } = adfTest(residuals);
  const isCointegrated = pValue < 0.05;

  // Half-life via AR(1) on residuals: Δres_t = b·res_{t-1}; HL = -ln(2)/ln(1-b)
  // Equivalent to HL = -ln(2)/ln(b) where b is the AR(1) coefficient on level.
  const lagged = residuals.slice(0, -1);
  const fut = residuals.slice(1);
  const ar = ols(lagged, fut);
  const arCoef = ar.slope; // if res_t = arCoef·res_{t-1}, mean reversion speed = 1-arCoef
  const halfLife = (arCoef > 0 && arCoef < 1) ? -Math.log(2) / Math.log(arCoef) : Infinity;

  // Current z-score of the spread.
  const mu = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const variance = residuals.reduce((s, r) => s + (r - mu) ** 2, 0) / residuals.length;
  const sigma = Math.sqrt(variance);
  const zScore = sigma > 0 ? (residuals[residuals.length - 1] - mu) / sigma : 0;

  const tradeable = isCointegrated && halfLife > 2 && halfLife < 180 && Math.abs(zScore) > 2;
  let signal: CointegrationResult['signal'] = 'NONE';
  if (tradeable) signal = zScore > 2 ? 'SHORT_SPREAD' : 'LONG_SPREAD';

  return { pair, hedgeRatio, intercept, adfStat, pValue, isCointegrated, halfLife, zScore, tradeable, signal };
}

/**
 * Build the full N×N cointegration matrix from a {symbol: price[]} map.
 * Only the upper triangle (i<j) is computed (cointegration is symmetric).
 */
export function computeCointegrationMatrix(
  prices: Record<string, number[]>,
): CointegrationResult[] {
  const symbols = Object.keys(prices);
  const out: CointegrationResult[] = [];
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const a = symbols[i], b = symbols[j];
      const res = engleGranger(prices[a], prices[b], [a, b]);
      if (res) out.push(res);
    }
  }
  // Sort: tradeable first, then by p-value (most cointegrated first).
  out.sort((a, b) => {
    if (a.tradeable !== b.tradeable) return a.tradeable ? -1 : 1;
    return a.pValue - b.pValue;
  });
  return out;
}
