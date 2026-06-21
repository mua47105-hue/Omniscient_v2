// E9 — Triple-Barrier Labeling
//
// Source: "OMNISCIENT — Field Guide to Real Edge (Vol. 2)", Suggestion E9.
// Evidence: López de Prado, "Advances in Financial Machine Learning" (2018),
// Ch. 3. Hudson & Thames confirms synergy with meta-labeling.
//
// What: replace fixed-24h grading with THREE barriers — profit-taking (+ATR),
// stop-loss (-ATR), time-out (N bars). The FIRST barrier touched determines
// the label. This reflects actual trade outcomes far better than fixed-horizon
// "did price go up in 24h".
//
// Labels:  1 = profit (TP touched), -1 = loss (SL touched), 0 = timeout.
// The label drives grading + backtest expectancy. Pair with the Deflated
// Sharpe Ratio (deflated-sharpe.ts) to reject overfit strategies.
//
// ponytail: pure function, no deps. Order of barrier checks matters: in a
// single bar both SL and TP could be touched — check SL first (worst case,
// conservative), then TP. This matches López de Prado's recommendation.

export interface TripleBarrierConfig {
  takeProfitAtr: number; // e.g. 2.0 → +2×ATR
  stopLossAtr: number;   // e.g. 1.5 → -1.5×ATR
  timeoutBars: number;   // e.g. 3 → exit at close of bar entry+3 if neither hit
  side: 'long' | 'short';
}

export const DEFAULT_TB_CONFIG: TripleBarrierConfig = {
  takeProfitAtr: 2.0,
  stopLossAtr: 1.5,
  timeoutBars: 3,
  side: 'long',
};

export interface TripleBarrierLabel {
  label: 1 | 0 | -1;     // 1=profit, 0=timeout, -1=loss
  exitBar: number;        // index into klines where exit occurred
  exitPrice: number;      // price at exit (barrier price or close)
  exitReason: 'take_profit' | 'stop_loss' | 'timeout';
  returnPct: number;      // signed % return of the trade (long: (exit-entry)/entry)
  returnR: number;        // return in R multiples (1R = risk = |entry - SL|)
}

/**
 * Label a single trade using the triple-barrier method.
 *
 * @param entryPrice  price at entry (bar `entryIndex` close)
 * @param atr         ATR at entry (defines barrier distances)
 * @param klines      the full candle series (we look ahead from entryIndex)
 * @param entryIndex  bar index of entry
 * @param config      barrier config
 */
export function tripleBarrierLabel(
  entryPrice: number,
  atr: number,
  klines: { high: number; low: number; close: number }[],
  entryIndex: number,
  config: Partial<TripleBarrierConfig> = {},
): TripleBarrierLabel {
  const cfg = { ...DEFAULT_TB_CONFIG, ...config };
  const long = cfg.side === 'long';

  // Barrier prices.
  const tp = long ? entryPrice + atr * cfg.takeProfitAtr : entryPrice - atr * cfg.takeProfitAtr;
  const sl = long ? entryPrice - atr * cfg.stopLossAtr : entryPrice + atr * cfg.stopLossAtr;
  const risk = Math.abs(entryPrice - sl); // 1R

  const last = Math.min(entryIndex + 1 + cfg.timeoutBars, klines.length);

  for (let i = entryIndex + 1; i < last; i++) {
    const bar = klines[i];
    if (!bar) break;
    // Check SL first (conservative — if both touched in one bar, assume the
    // worst case stopped you out first).
    if (long) {
      if (bar.low <= sl) {
        return { label: -1, exitBar: i, exitPrice: sl, exitReason: 'stop_loss', returnPct: (sl - entryPrice) / entryPrice * 100, returnR: risk > 0 ? (sl - entryPrice) / risk : 0 };
      }
      if (bar.high >= tp) {
        return { label: 1, exitBar: i, exitPrice: tp, exitReason: 'take_profit', returnPct: (tp - entryPrice) / entryPrice * 100, returnR: risk > 0 ? (tp - entryPrice) / risk : 0 };
      }
    } else {
      if (bar.high >= sl) {
        return { label: -1, exitBar: i, exitPrice: sl, exitReason: 'stop_loss', returnPct: (entryPrice - sl) / entryPrice * 100, returnR: risk > 0 ? (entryPrice - sl) / risk : 0 };
      }
      if (bar.low <= tp) {
        return { label: 1, exitBar: i, exitPrice: tp, exitReason: 'take_profit', returnPct: (entryPrice - tp) / entryPrice * 100, returnR: risk > 0 ? (entryPrice - tp) / risk : 0 };
      }
    }
  }

  // Timeout — exit at close of the last considered bar.
  const exitBar = Math.min(entryIndex + cfg.timeoutBars, klines.length - 1);
  const exitPrice = klines[exitBar]?.close ?? entryPrice;
  const returnPct = long
    ? (exitPrice - entryPrice) / entryPrice * 100
    : (entryPrice - exitPrice) / entryPrice * 100;
  return {
    label: 0,
    exitBar,
    exitPrice,
    exitReason: 'timeout',
    returnPct,
    returnR: risk > 0 ? (long ? (exitPrice - entryPrice) / risk : (entryPrice - exitPrice) / risk) : 0,
  };
}
