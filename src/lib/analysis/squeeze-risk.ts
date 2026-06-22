// Squeeze risk detector — funding rate extremes + open interest analysis.
//
// WHY THIS EXISTS:
// The audit (CONTRARIAN-AUDIT-1, loophole L6) found that the consensus engine
// treats funding rate as a minor ±15 point nudge buried in the sentiment layer.
// This is dangerously weak: when funding is extremely positive (everyone is
// long and paying funding), the market is primed for a LONG SQUEEZE. When
// extremely negative (everyone short), a SHORT SQUEEZE is imminent.
//
// Binance's official extreme thresholds: +0.10% per 8h = extreme long, -0.05%
// per 8h = extreme short. At +0.05%/8h (≈+54% APR), the position is
// unsustainable (Quantjourney research).
//
// This module computes a composite squeeze risk score that combines:
//   - Funding rate extremity (how far from the 0% neutral)
//   - Funding rate percentile (vs historical — is this unusual for this asset?)
//   - Open interest trend (rising OI + extreme funding = squeeze imminent)
//
// The output is a CONTRARIAN signal: extreme positive funding → bearish
// (long squeeze risk), extreme negative funding → bullish (short squeeze risk).

export interface SqueezeSignal {
  type: 'long_squeeze_risk' | 'short_squeeze_risk';
  direction: 'long' | 'short';  // the CONTRARIAN direction
  severity: number;             // 0..1
  description: string;
  fundingRate: number;          // the raw 8h funding rate (decimal, e.g. 0.0001)
  fundingApr: number;           // annualized % (fundingRate * 3 * 365 * 100)
}

/**
 * Detect squeeze risk from funding rate + open interest data.
 *
 * @param fundingRate - 8h funding rate as a decimal (e.g. 0.0001 = 0.01%)
 * @param openInterest - current open interest in base asset (optional)
 * @param prevOpenInterest - previous period OI for trend (optional)
 * @param historicalFunding - recent funding rates for percentile calc (optional)
 */
export function detectSqueezeRisk(
  fundingRate: number,
  openInterest?: number,
  prevOpenInterest?: number,
  historicalFunding?: number[]
): SqueezeSignal | null {
  if (!Number.isFinite(fundingRate)) return null;

  const fundingApr = fundingRate * 3 * 365 * 100; // annualized %

  // Compute percentile if we have historical data
  let percentile = 50; // default: neutral
  if (historicalFunding && historicalFunding.length > 10) {
    const sorted = [...historicalFunding].sort((a, b) => a - b);
    let below = 0;
    for (const f of sorted) {
      if (f <= fundingRate) below++;
    }
    percentile = (below / sorted.length) * 100;
  }

  // OI trend: rising OI + extreme funding = squeeze more likely
  let oiTrendBoost = 0;
  if (openInterest !== undefined && prevOpenInterest !== undefined && prevOpenInterest > 0) {
    const oiChange = (openInterest - prevOpenInterest) / prevOpenInterest;
    // Rising OI (>5%) with extreme funding = positions piling up = squeeze risk higher
    if (oiChange > 0.05) oiTrendBoost = 0.2;
    // Falling OI = positions closing = squeeze risk lower
    else if (oiChange < -0.05) oiTrendBoost = -0.2;
  }

  // --- Long Squeeze Risk ---
  // When funding is very positive, longs are paying shorts. This is
  // unsustainable and eventually longs capitulate → price dumps.
  // Thresholds: >0.05%/8h = warning, >0.10%/8h = extreme (Binance official)
  if (fundingRate > 0.0005) {
    const extremity = Math.min(1, (fundingRate - 0.0005) / 0.0015); // 0 at 0.05%, 1 at 0.20%
    const percentileBoost = percentile > 90 ? 0.3 : percentile > 80 ? 0.15 : 0;
    const severity = Math.min(1, extremity * 0.6 + percentileBoost + oiTrendBoost);
    if (severity > 0.2) {
      return {
        type: 'long_squeeze_risk',
        direction: 'short',
        severity,
        description: `Long squeeze risk: funding ${(fundingRate * 100).toFixed(4)}%/8h (${fundingApr.toFixed(0)}% APR)${percentile > 80 ? `, ${percentile.toFixed(0)}th percentile` : ''}${oiTrendBoost > 0 ? ', OI rising' : ''} — overcrowded longs, squeeze imminent`,
        fundingRate,
        fundingApr,
      };
    }
  }

  // --- Short Squeeze Risk ---
  // When funding is very negative, shorts are paying longs. Eventually
  // shorts capitulate → price pumps (short squeeze).
  // Thresholds: <-0.03%/8h = warning, <-0.05%/8h = extreme
  if (fundingRate < -0.0003) {
    const extremity = Math.min(1, (Math.abs(fundingRate) - 0.0003) / 0.0012);
    const percentileBoost = percentile < 10 ? 0.3 : percentile < 20 ? 0.15 : 0;
    const severity = Math.min(1, extremity * 0.6 + percentileBoost + oiTrendBoost);
    if (severity > 0.2) {
      return {
        type: 'short_squeeze_risk',
        direction: 'long',
        severity,
        description: `Short squeeze risk: funding ${(fundingRate * 100).toFixed(4)}%/8h (${fundingApr.toFixed(0)}% APR)${percentile < 20 ? `, ${percentile.toFixed(0)}th percentile` : ''}${oiTrendBoost > 0 ? ', OI rising' : ''} — overcrowded shorts, squeeze imminent`,
        fundingRate,
        fundingApr,
      };
    }
  }

  return null;
}

/**
 * Aggregate squeeze risk into a contrarian score.
 * Simple wrapper since there's at most one squeeze signal.
 */
export function aggregateSqueezeScore(
  fundingRate?: number,
  openInterest?: number,
  prevOpenInterest?: number,
  historicalFunding?: number[]
): {
  score: number;           // -100..100 — contrarian direction
  confidence: number;      // 0..100
  signal: SqueezeSignal | null;
} {
  if (fundingRate === undefined || !Number.isFinite(fundingRate)) {
    return { score: 0, confidence: 0, signal: null };
  }

  const signal = detectSqueezeRisk(fundingRate, openInterest, prevOpenInterest, historicalFunding);
  if (!signal) {
    return { score: 0, confidence: 0, signal: null };
  }

  const score = signal.direction === 'long' ? 100 : -100;
  const confidence = Math.min(85, signal.severity * 85 + 20);

  return { score, confidence, signal };
}
