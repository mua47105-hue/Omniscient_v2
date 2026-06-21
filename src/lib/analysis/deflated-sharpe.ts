// E9 — Deflated Sharpe Ratio (DSR)
//
// Source: "OMNISCIENT — Field Guide to Real Edge (Vol. 2)", Suggestion E9.
// Evidence: Bailey & López de Prado, "The Deflated Sharpe Ratio" (2014, JPM).
//
// What: corrects an observed Sharpe for MULTIPLE TESTING. If you backtest 100
// strategies, the best one will appear to have high Sharpe by chance alone.
// DSR = Φ((SR − E[max SR under null]) / σ(SR)) — the probability the observed
// Sharpe is real (not a fluke of selection bias).
//
// Hard gate (per the document): don't deploy any strategy with DSR < 0.95.
//
// This doesn't add alpha — it PREVENTS deploying overfit strategies. Capital
// preservation. Counter-argument: the formula is sensitive to skew/kurtosis
// estimates which are noisy with small samples. Mitigation: use as a GATE,
// not the only criterion; combine with walk-forward validation.

export interface BacktestStats {
  sharpe: number;       // observed (annualized) Sharpe
  nTrades: number;      // number of trades in the backtest
  nTrials: number;      // number of strategy variants backtested (multiple-testing correction)
  skewness: number;     // return skewness
  kurtosis: number;     // return kurtosis (excess)
}

/**
 * Compute the Deflated Sharpe Ratio.
 * Returns a probability in [0, 1] that the observed Sharpe is real.
 * ≥ 0.95 → deploy; < 0.95 → likely overfit, reject.
 */
export function deflatedSharpeRatio(stats: BacktestStats): number {
  const { sharpe, nTrades, nTrials, skewness, kurtosis } = stats;
  if (nTrades < 2) return 0;

  // σ(SR) ≈ sqrt((1 − skew·SR + (kurt−1)/4 · SR²) / (n−1))
  // (Bailey-LdP 2014, eq. for the standard error of the Sharpe ratio.)
  const srVariance = (1 - skewness * sharpe + ((kurtosis - 1) / 4) * sharpe ** 2) / (nTrades - 1);
  const srStd = Math.sqrt(Math.max(srVariance, 1e-10));

  // E[max SR under null] ≈ sqrt(2·ln(nTrials)) · σ(SR)
  // (Expected maximum of nTrials draws from the null Sharpe distribution.)
  const expectedMax = Math.sqrt(2 * Math.log(Math.max(nTrials, 2))) * srStd;

  // DSR = Φ((SR − E[max]) / σ(SR))
  const z = (sharpe - expectedMax) / srStd;
  return normalCDF(z);
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 approximation). */
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** Convenience: compute skewness + (excess) kurtosis of a return series. */
export function moments(returns: number[]): { skewness: number; kurtosis: number } {
  const n = returns.length;
  if (n < 3) return { skewness: 0, kurtosis: 0 };
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  let m2 = 0, m3 = 0, m4 = 0;
  for (const r of returns) {
    const d = r - mean;
    m2 += d * d; m3 += d * d * d; m4 += d * d * d * d;
  }
  m2 /= n; m3 /= n; m4 /= n;
  const variance = m2 * n / (n - 1); // sample variance
  const sigma = Math.sqrt(Math.max(variance, 1e-12));
  const skewness = (m3 / (sigma ** 3)) * (Math.sqrt(n * (n - 1)) / (n - 2));
  // Excess kurtosis (Fisher's definition: normal = 0).
  const kurtosis = (n * (n + 1) / ((n - 1) * (n - 2) * (n - 3))) * (m4 / (sigma ** 4))
    - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return { skewness: isFinite(skewness) ? skewness : 0, kurtosis: isFinite(kurtosis) ? kurtosis : 0 };
}

/** Verdict helper for the UI / logs. */
export function dsrVerdict(dsr: number): { label: string; deploy: boolean; color: string } {
  if (dsr >= 0.95) return { label: 'APPROVED — DSR ≥ 0.95', deploy: true, color: 'text-emerald-400' };
  if (dsr >= 0.80) return { label: 'MARGINAL — 0.80 ≤ DSR < 0.95', deploy: false, color: 'text-amber-400' };
  return { label: 'REJECTED — DSR < 0.80 (likely overfit)', deploy: false, color: 'text-rose-400' };
}
