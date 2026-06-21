// E1 — Volatility-Targeting Position Sizing
//
// Source: "OMNISCIENT — Field Guide to Real Edge (Vol. 2)", Suggestion E1.
// Evidence: Moreira & Muir (2017, JF) vol-targeting raises market Sharpe
// 0.43→0.53; Barroso & Santa-Clara (2015, JFE) inverse-vol scaling DOUBLES
// momentum Sharpe (0.8→1.4) and eliminates momentum crashes; Lempérière et al.
// (CFM, 2014, arXiv:1404.3274) confirmed robust across 200 years + asset
// classes. Crypto vol clustering is STRONGER than equities → edge ≥ as large.
//
// What: size positions INVERSELY to recent realized volatility so each
// position risks a constant fraction of equity vol per bar.
//   notional = (equity × targetVolPct) / realizedVol
// Realized vol = stdev of log returns over `lookback` bars, annualized per-bar.
// A hard cap (maxNotionalPct) prevents blow-up when vol≈0; a floor
// (minVolFloor) prevents division issues.
//
// Counter-argument (from the document): hurts short mean-reversion (low-vol
// regime → size up just before a vol spike) + adds turnover cost. Mitigation:
// backtest net of fees; pick targetVolPct/lookback so turnover doesn't eat the
// gain. We expose the realized vol + size % so callers can log + tune.
//
// ponytail: pure function, no deps, no side effects. The edge is in the math —
// it must be exactly right.

export interface VolTargetConfig {
  /** Target equity-vol per bar per position, as a fraction. e.g. 0.005 = 0.5%. */
  targetVolPct: number;
  /** Lookback bars for realized-vol estimation. e.g. 20 (~3 days on 4h). */
  lookback: number;
  /** Hard cap on notional as a fraction of equity. e.g. 0.25 = 25%. */
  maxNotionalPct: number;
  /** Floor on realized vol to prevent blow-up when vol≈0. e.g. 0.001 = 0.1%. */
  minVolFloor: number;
}

export const DEFAULT_VOL_TARGET_CONFIG: VolTargetConfig = {
  targetVolPct: 0.005, // 0.5% equity vol per 4h bar — conservative for crypto
  lookback: 20,        // ~3 days on 4h bars
  maxNotionalPct: 0.25, // never more than 25% of equity in one position
  minVolFloor: 0.001,
};

export interface VolTargetResult {
  /** Dollar notional to deploy. */
  notional: number;
  /** Realized per-bar vol (stdev of log returns), floored. */
  realizedVol: number;
  /** notional / equity — the position size as a fraction of equity. */
  sizePct: number;
  /** Why the size was chosen (for logging / UI). */
  rationale: string;
}

/**
 * Size a position inversely to recent realized volatility.
 *
 * @param equity  current account equity in USD
 * @param klines  recent candles (needs close + open for log returns)
 * @param config  vol-target parameters
 */
export function volTargetSize(
  equity: number,
  klines: { close: number; open: number }[],
  config: Partial<VolTargetConfig> = {},
): VolTargetResult {
  const cfg = { ...DEFAULT_VOL_TARGET_CONFIG, ...config };

  // Insufficient data → fall back to a conservative fixed 2% (the document's
  // own fallback). Don't refuse to trade; just don't over-bet on unknown vol.
  if (!klines || klines.length < 10) {
    return {
      notional: equity * 0.02,
      realizedVol: 0,
      sizePct: 0.02,
      rationale: 'insufficient-history → conservative 2% fixed',
    };
  }

  const slice = klines.slice(-cfg.lookback);
  const logReturns: number[] = [];
  for (const k of slice) {
    if (k.close > 0 && k.open > 0 && isFinite(k.close) && isFinite(k.open)) {
      logReturns.push(Math.log(k.close / k.open));
    }
  }
  if (logReturns.length < 10) {
    return { notional: equity * 0.02, realizedVol: 0, sizePct: 0.02, rationale: 'insufficient-valid-bars → 2% fixed' };
  }

  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);
  const realizedVol = Math.max(Math.sqrt(variance), cfg.minVolFloor);

  // notional × realizedVol ≈ equity × targetVol  →  notional = equity × target / vol
  const notionalRaw = (equity * cfg.targetVolPct) / realizedVol;
  const notionalCap = equity * cfg.maxNotionalPct;
  const notional = Math.min(notionalRaw, notionalCap);
  const sizePct = notional / equity;
  const capped = notionalRaw > notionalCap;

  return {
    notional,
    realizedVol,
    sizePct,
    rationale: `vol-target ${(cfg.targetVolPct * 100).toFixed(2)}% / rv ${(realizedVol * 100).toFixed(2)}%${capped ? ' (capped)' : ''}`,
  };
}
