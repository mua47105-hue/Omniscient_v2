/**
 * E9 — Deflated Sharpe Ratio (Bailey & López de Prado 2014).
 *
 * The DSR adjusts an observed Sharpe ratio for two biases:
 *
 *   1. **Multiple testing** — the more strategies you backtest, the more
 *      likely the best one is high purely by chance. The DSR compares the
 *      observed SR to the *expected maximum* SR under the null of zero edge
 *      across N trials.
 *
 *   2. **Non-normality** — skewness and kurtosis inflate the variance of the
 *      SR estimator (Lo 2002). The DSR widens the denominator accordingly.
 *
 *   DSR = Φ( (SR − E[max SR]) / σ(SR) )
 *
 * Interpretation:
 *   - DSR ≥ 0.95 → SR is unlikely to be a multiple-testing artifact.
 *   - DSR < 0.5  → SR is indistinguishable from luck. **Fix signal quality
 *     first** — no risk-management technique can rescue noise.
 *
 * Suggested gate (per handover §10): reject any backtested strategy with
 * DSR < 0.95.
 */

// ---------------------------------------------------------------------------
// Abramowitz-Stegun normal CDF (7.1.26) — max abs error 7.5e-8
// ---------------------------------------------------------------------------

const SQRT2PI = Math.sqrt(2 * Math.PI);

export function normalCDF(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;

  const t = 1 / (1 + p * z);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);

  return 0.5 * (1 + sign * y);
}

// ---------------------------------------------------------------------------
// Inverse normal CDF (Acklam's algorithm) — for the E[max] expectation
// ---------------------------------------------------------------------------

export function inverseNormalCDF(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  // Coefficients
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const plow = 0.02425;
  const phigh = 1 - plow;

  let q: number;
  let r: number;
  let x: number;

  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  // One Halley refinement step for accuracy.
  const e = normalCDF(x) - p;
  const u = e * SQRT2PI * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);

  return x;
}

// ---------------------------------------------------------------------------
// Higher moments (skewness + excess kurtosis)
// ---------------------------------------------------------------------------

export interface Moments {
  n: number;
  mean: number;
  stdDev: number;
  skewness: number;
  /** Excess kurtosis (kurtosis − 3, so 0 for a normal distribution). */
  excessKurtosis: number;
}

export function moments(returns: number[]): Moments {
  const n = returns.length;
  if (n < 3) {
    return { n, mean: 0, stdDev: 0, skewness: 0, excessKurtosis: 0 };
  }
  let s = 0;
  for (const r of returns) s += r;
  const m = s / n;

  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  for (const r of returns) {
    const d = r - m;
    const d2 = d * d;
    s2 += d2;
    s3 += d2 * d;
    s4 += d2 * d2;
  }
  const varPop = s2 / n;
  const sd = Math.sqrt(varPop);
  const skewness = sd > 0 ? s3 / n / (sd * sd * sd) : 0;
  const excessKurtosis = varPop > 0 ? s4 / n / (varPop * varPop) - 3 : 0;
  return { n, mean: m, stdDev: sd, skewness, excessKurtosis };
}

// ---------------------------------------------------------------------------
// DSR
// ---------------------------------------------------------------------------

export interface DsrStats {
  /** Annualised Sharpe ratio (already annualised — input). */
  sharpe: number;
  /** Skewness of the per-period returns. */
  skewness: number;
  /** Excess kurtosis (0 for a normal distribution). */
  excessKurtosis: number;
  /** Number of per-period return observations. */
  nObservations: number;
  /** Number of strategy variants backtested (multiple-testing penalty). */
  nTrials: number;
  /** Per-period Sharpe (the observed SR ÷ sqrt(periodsPerYear)). Required for σ(SR). */
  perPeriodSharpe: number;
}

export interface DsrResult {
  dsr: number;
  /** Expected max SR across N trials under the null. */
  expectedMaxSharpe: number;
  /** Std-dev of the SR estimator (with skew/kurt adjustment). */
  sharpeStdErr: number;
  /** Verdict bucket. */
  verdict: 'genuine' | 'likely' | 'inconclusive' | 'noise';
}

/**
 * Compute the Deflated Sharpe Ratio.
 *
 *   σ(SR) = sqrt( (1 − skew·SR + (kurt−1)/4 · SR²) / (n − 1) )   [per-period SR]
 *   E[max SR] = σ(SR) · ( (1−γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e)) )
 *   DSR = Φ( (SR − E[max SR]) / σ(SR) )
 *
 * where γ is the Euler-Mascheroni constant (≈ 0.5772), N is the number of
 * trials, and SR/σ(SR) are on the **per-period** basis (not annualised).
 */
export function deflatedSharpeRatio(stats: DsrStats): DsrResult {
  const { perPeriodSharpe: sr, skewness: skew, excessKurtosis: kurt, nObservations: n, nTrials: N } = stats;

  // Degenerate inputs.
  if (n < 2 || N < 1) {
    return { dsr: 0, expectedMaxSharpe: 0, sharpeStdErr: 0, verdict: 'noise' };
  }

  // Variance of the SR estimator with skew/kurt adjustment.
  // Bailey-LdP 2014 (after Mardia/Lo 2002):
  //   σ²(SR) = (1 − skew·SR + (kurt_raw − 1)/4 · SR²) / (n − 1)
  // Our `excessKurtosis` = kurt_raw − 3, so (kurt_raw − 1) = excessKurtosis + 2.
  const srVar = (1 - skew * sr + ((kurt + 2) / 4) * sr * sr) / (n - 1);
  const sigmaSR = Math.sqrt(Math.max(srVar, 1e-12));

  // Expected max SR across N trials (Bailey-LdP 2014 eq. 6).
  const euler = 0.5772156649015329;
  let expectedMax = 0;
  if (N > 1) {
    const z1 = inverseNormalCDF(1 - 1 / N);
    const z2 = inverseNormalCDF(1 - 1 / (N * Math.E));
    expectedMax = sigmaSR * ((1 - euler) * z1 + euler * z2);
  } else {
    // Single trial → no multiple-testing penalty.
    expectedMax = 0;
  }

  // DSR.
  const dsr = sigmaSR > 0 ? normalCDF((sr - expectedMax) / sigmaSR) : 0;

  return {
    dsr,
    expectedMaxSharpe: expectedMax,
    sharpeStdErr: sigmaSR,
    verdict: dsrVerdict(dsr),
  };
}

/**
 * Bucket the DSR into a human-readable verdict.
 *
 *   ≥ 0.95 → genuine   (strategy has real edge)
 *   ≥ 0.80 → likely    (probably real edge, worth paper-trading)
 *   ≥ 0.50 → inconclusive
 *   < 0.50 → noise     (fix signal quality first — no RM can save noise)
 */
export function dsrVerdict(dsr: number): DsrResult['verdict'] {
  if (dsr >= 0.95) return 'genuine';
  if (dsr >= 0.8) return 'likely';
  if (dsr >= 0.5) return 'inconclusive';
  return 'noise';
}
