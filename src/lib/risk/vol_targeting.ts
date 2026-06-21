/**
 * E1 — Vol-targeting position sizing (Moreira-Muir 2017).
 *
 * Target a constant ex-ante volatility by scaling exposure inversely to
 * realised volatility. The classic formulation:
 *
 *     notional = (equity × targetVol) / max(realisedVol, volFloor)
 *
 * Capped at `maxNotionalPct` of equity so a volatility collapse doesn't
 * produce a 50x leveraged position. Falls back to a 2% fixed size when there
 * are fewer than 10 bars — the realised-vol estimate is too noisy below that.
 *
 * Evidence: Moreira & Muir (2017), "Volatility-Managed Portfolios" —
 * +0.15 to +0.30 Sharpe across equity/bond/FX universes. We apply it to
 * crypto, which has 3-5× the realised vol of equities and benefits more.
 *
 * Integration: called once per signal in the scheduler tick. The result is
 * stamped into the Signal rationale as `[vol-target:X% rv:Y%]` for the
 * UI badge.
 */

import type { Kline } from '@/lib/types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface VolTargetConfig {
  /** Target annualised volatility (e.g. 0.6 = 60% per annum). */
  targetVolPct: number;
  /** Lookback window in bars for the realised-vol estimate. */
  lookback: number;
  /** Floor on the realised-vol denominator (avoids 1/0 explosion). */
  minVolFloor: number;
  /** Cap on the resulting notional, as a fraction of equity (e.g. 1.0 = 100%). */
  maxNotionalPct: number;
  /** Bars per year — 365×24=8760 for hourly, 365 for daily, etc. */
  barsPerYear: number;
  /** Fixed fractional size used when there are fewer than minBars. */
  fallbackSizePct: number;
  /** Minimum bars required to compute realised vol. */
  minBars: number;
}

export const DEFAULT_VOL_TARGET_CONFIG: VolTargetConfig = {
  targetVolPct: 0.6, // 60% per annum target — crypto-appropriate
  lookback: 30, // 30 bars
  minVolFloor: 0.15, // 15% per annum floor (don't lever when vol collapses)
  maxNotionalPct: 1.0, // cap at 100% of equity (no leverage)
  barsPerYear: 365, // daily bars by default; override for intraday
  fallbackSizePct: 0.02, // 2% fixed when insufficient data
  minBars: 10,
};

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface VolTargetResult {
  /** Notional in quote currency (e.g. USDT). */
  notional: number;
  /** Realised annualised vol estimate (0..1). 0 when fallback used. */
  realizedVol: number;
  /** Position size as a fraction of equity (notional / equity). */
  sizePct: number;
  /** Human-readable explanation for the rationale tag. */
  rationale: string;
  /** True when the fallback fixed-size path was taken. */
  fallback: boolean;
}

// ---------------------------------------------------------------------------
// Math helpers (pure, no deps)
// ---------------------------------------------------------------------------

function logReturns(klines: Kline[]): number[] {
  const rs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const a = klines[i - 1].close;
    const b = klines[i].close;
    if (a > 0 && b > 0) rs.push(Math.log(b / a));
  }
  return rs;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function sampleStdDev(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (n - 1));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the vol-targeted notional for a new position.
 *
 *   notional = (equity × targetVolPct) / max(realisedVol, minVolFloor)
 *   notional = min(notional, equity × maxNotionalPct)
 *
 * @param equity   Account equity in quote currency.
 * @param klines   Recent OHLCV bars (most recent last).
 * @param config   Override defaults as needed (barsPerYear matters for intraday).
 */
export function volTargetSize(
  equity: number,
  klines: Kline[],
  config: Partial<VolTargetConfig> = {},
): VolTargetResult {
  const cfg: VolTargetConfig = { ...DEFAULT_VOL_TARGET_CONFIG, ...config };

  if (equity <= 0) {
    return {
      notional: 0,
      realizedVol: 0,
      sizePct: 0,
      rationale: 'equity<=0',
      fallback: true,
    };
  }

  // Insufficient bars → fixed fallback.
  if (!klines || klines.length < cfg.minBars) {
    const notional = equity * cfg.fallbackSizePct;
    return {
      notional,
      realizedVol: 0,
      sizePct: cfg.fallbackSizePct,
      rationale: `vol-target:${(cfg.fallbackSizePct * 100).toFixed(1)}% rv:n/a (insufficient bars)`,
      fallback: true,
    };
  }

  // Use only the most recent `lookback` bars.
  const window = klines.slice(-cfg.lookback);
  const rs = logReturns(window);

  // Per-bar std dev → annualised vol.
  const perBarVol = sampleStdDev(rs);
  const realisedVol = perBarVol * Math.sqrt(cfg.barsPerYear);

  // Don't lever into a vol collapse.
  const denom = Math.max(realisedVol, cfg.minVolFloor);
  let notional = (equity * cfg.targetVolPct) / denom;
  const cap = equity * cfg.maxNotionalPct;
  if (notional > cap) notional = cap;

  const sizePct = notional / equity;
  const rationale = `vol-target:${(sizePct * 100).toFixed(1)}% rv:${(realisedVol * 100).toFixed(1)}%`;

  return {
    notional,
    realizedVol: realisedVol,
    sizePct,
    rationale,
    fallback: false,
  };
}
