/**
 * Pure-TypeScript backtesting engine.
 *
 * No React, no DOM, no API calls — given an array of historical klines and a
 * strategy configuration, this module simulates trading day-by-day and returns
 * a fully-typed BacktestResult with equity curve, trade list, performance
 * metrics, monthly returns, drawdown series, and a buy-and-hold benchmark.
 *
 * Trading model
 * -------------
 *  - Long-only. One position at a time.
 *  - Entry: on day `i`, if no position is open, evaluate every active entry
 *    rule against the indicator series ending at bar `i`. If ANY rule passes,
 *    open a long position at the close of bar `i`.
 *  - Exit: on day `i`, if a position is open, evaluate (in order):
 *      1. Hard stop-loss  (intrabar low touches SL price)  → exit at SL price
 *      2. Hard take-profit (intrabar high touches TP price) → exit at TP price
 *      3. Signal exits (any active exit rule passes)        → exit at close
 *  - Position size: `equity × positionSizePct / 100` (re-calculated from
 *    current equity at entry, so winners compound).
 *  - No fees / slippage modeled (could be added later as a `feePct` param).
 *
 * Indicators
 * ----------
 *  We precompute full-length series (RSI, EMA20/50, MACD line + signal,
 *  Bollinger upper/lower, average volume) ONCE for the entire klines array,
 *  then index into them per-bar. This is O(n) per indicator instead of O(n²)
 *  that re-computing `computeIndicators(slice)` would incur.
 *
 * Sharpe ratio
 * ------------
 *  `mean(dailyReturns) / stddev(dailyReturns) × sqrt(252)`
 *  Annualized using 252 trading days. Daily returns are computed from the
 *  equity curve (so flat-equity days while out of the market contribute 0%).
 *
 * Max drawdown
 * ------------
 *  `max(1 − equity[i] / max(equity[0..i]))` over the equity curve.
 */

import type { Kline } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';
import {
  Gauge,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  AlignHorizontalJustifyCenter,
  BarChart2,
  ArrowDownNarrowWide,
  ArrowBigUp,
  ArrowUpWideNarrow,
  ArrowUpNarrowWide,
  Target,
  ShieldX,
  CircleSlash,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EntryRuleContext {
  /** Indicator value at the current bar */
  rsi: number;
  macd: number;
  macdSignal: number;
  macdPrev: number;
  macdSignalPrev: number;
  ema20: number;
  ema50: number;
  bbLower: number;
  bbUpper: number;
  /** Current bar close price */
  price: number;
  /** Current bar volume */
  volume: number;
  /** Average volume over the prior N bars (rolling 20) */
  avgVolume: number;
}

export interface ExitRuleContext extends EntryRuleContext {
  /** The open position (null-safe — only called when position is open) */
  entryPrice: number;
  /** Lowest price since entry (for trailing-style reasoning) */
  highSinceEntry: number;
  lowSinceEntry: number;
}

export interface Rule {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Returns true when the rule is satisfied (e.g. RSI is below 30). */
  test: (ctx: EntryRuleContext | ExitRuleContext) => boolean;
}

export interface PresetStrategy {
  key: string;
  name: string;
  description: string;
  entryRules: string[];
  exitRules: string[];
  stopLossPct: number;
  takeProfitPct: number;
  positionSizePct: number;
}

export interface Trade {
  id: number;
  entryDate: string; // ISO date YYYY-MM-DD
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  size: number; // units
  side: 'long';
  pnl: number; // $
  pnlPct: number; // % relative to position value at entry
  holdDays: number;
  exitReason: 'Stop Loss' | 'Take Profit' | 'Signal Exit';
}

export interface EquityPoint {
  date: string;
  value: number;
}

export interface DrawdownPoint {
  date: string;
  drawdownPct: number; // always ≤ 0
}

export interface BuyHoldPoint {
  date: string;
  value: number;
}

export interface MonthlyReturn {
  year: number;
  month: number; // 0-11
  returnPct: number;
  trades: number;
}

export interface BacktestMetrics {
  totalReturnPct: number;
  finalEquity: number;
  initialEquity: number;
  totalTrades: number;
  winRate: number;
  maxDrawdownPct: number; // positive number (e.g. 15.3 means -15.3%)
  sharpeRatio: number;
  avgHoldDays: number;
  bestTrade: number; // $ P&L
  worstTrade: number; // $ P&L
}

export interface BacktestParams {
  klines: Kline[];
  entryRules: string[]; // rule keys
  exitRules: string[];
  stopLossPct: number; // 1..15 (percent)
  takeProfitPct: number; // 2..30 (percent)
  initialCapital: number;
  positionSizePct: number; // 1..25 (percent of equity per trade)
  feePct?: number; // taker fee per side, e.g. 0.05 = 0.05% (default 0 = no fees, backward compat)
  slippagePct?: number; // slippage per side, e.g. 0.02 = 0.02% (default 0)
}

export interface BacktestResult {
  equity: EquityPoint[];
  trades: Trade[];
  metrics: BacktestMetrics;
  monthlyReturns: MonthlyReturn[];
  drawdown: DrawdownPoint[];
  buyAndHold: BuyHoldPoint[];
}

// ---------------------------------------------------------------------------
// Indicator series precomputation
// ---------------------------------------------------------------------------

function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsiSeries(closes: number[], period: number = 14): number[] {
  // Wilder's RSI computed as a series so we can index into it per-bar.
  const out: number[] = new Array(closes.length).fill(50);
  if (closes.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff >= 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function bollingerSeries(
  closes: number[],
  period: number = 20,
  mult: number = 2,
): { upper: number[]; lower: number[] } {
  const upper: number[] = new Array(closes.length).fill(0);
  const lower: number[] = new Array(closes.length).fill(0);
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper[i] = closes[i];
      lower[i] = closes[i];
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const mid = slice.reduce((s, v) => s + v, 0) / period;
    const variance =
      slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mid + mult * sd;
    lower[i] = mid - mult * sd;
  }
  return { upper, lower };
}

function avgVolumeSeries(volumes: number[], period: number = 20): number[] {
  const out: number[] = new Array(volumes.length).fill(0);
  for (let i = 0; i < volumes.length; i++) {
    if (i < period) {
      out[i] = volumes.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1);
      continue;
    }
    const slice = volumes.slice(i - period, i); // exclude current bar
    out[i] = slice.reduce((s, v) => s + v, 0) / period;
  }
  return out;
}

interface IndicatorSeries {
  rsi: number[];
  ema20: number[];
  ema50: number[];
  macd: number[];
  macdSignal: number[];
  bbUpper: number[];
  bbLower: number[];
  avgVolume: number[];
}

function precomputeIndicators(klines: Kline[]): IndicatorSeries {
  const closes = klines.map((k) => k.close);
  const volumes = klines.map((k) => k.volume);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, i) => (ema12[i] ?? 0) - (ema26[i] ?? 0));
  const macdSignal = emaSeries(macdLine, 9);
  const bb = bollingerSeries(closes, 20, 2);
  return {
    rsi: rsiSeries(closes, 14),
    ema20: emaSeries(closes, 20),
    ema50: emaSeries(closes, 50),
    macd: macdLine,
    macdSignal,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    avgVolume: avgVolumeSeries(volumes, 20),
  };
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

export const ENTRY_RULES: Rule[] = [
  {
    key: 'rsi_lt_30',
    label: 'RSI < 30',
    description: 'Asset is oversold — RSI(14) below 30 (mean-reversion setup).',
    icon: Gauge,
    test: (c) => c.rsi < 30,
  },
  {
    key: 'rsi_lt_40',
    label: 'RSI < 40',
    description: 'Mildly oversold — RSI(14) below 40.',
    icon: Gauge,
    test: (c) => c.rsi < 40,
  },
  {
    key: 'macd_bullish_cross',
    label: 'MACD Bullish Crossover',
    description: 'MACD line crosses above the signal line.',
    icon: ArrowUpRight,
    test: (c) => c.macdPrev <= c.macdSignalPrev && c.macd > c.macdSignal,
  },
  {
    key: 'price_gt_ema50',
    label: 'Price > EMA50',
    description: 'Close above the 50-period EMA (confirmed uptrend).',
    icon: TrendingUp,
    test: (c) => c.price > c.ema50,
  },
  {
    key: 'price_gt_ema20',
    label: 'Price > EMA20',
    description: 'Close above the 20-period EMA (short-term uptrend).',
    icon: ArrowUpNarrowWide,
    test: (c) => c.price > c.ema20,
  },
  {
    key: 'bb_lower_touch',
    label: 'Bollinger Lower Band Touch',
    description: 'Close touches or pierces the lower Bollinger band.',
    icon: AlignHorizontalJustifyCenter,
    test: (c) => c.price <= c.bbLower,
  },
  {
    key: 'volume_gt_2x_avg',
    label: 'Volume > 2x Avg',
    description: 'Bar volume exceeds twice the 20-bar average volume.',
    icon: BarChart2,
    test: (c) => c.avgVolume > 0 && c.volume > 2 * c.avgVolume,
  },
];

export const EXIT_RULES: Rule[] = [
  {
    key: 'rsi_gt_70',
    label: 'RSI > 70',
    description: 'Asset is overbought — RSI(14) above 70.',
    icon: ArrowBigUp,
    test: (c) => c.rsi > 70,
  },
  {
    key: 'rsi_gt_60',
    label: 'RSI > 60',
    description: 'Mildly overbought — RSI(14) above 60.',
    icon: ArrowUpWideNarrow,
    test: (c) => c.rsi > 60,
  },
  {
    key: 'macd_bearish_cross',
    label: 'MACD Bearish Crossover',
    description: 'MACD line crosses below the signal line.',
    icon: ArrowDownRight,
    test: (c) => c.macdPrev >= c.macdSignalPrev && c.macd < c.macdSignal,
  },
  {
    key: 'price_lt_ema50',
    label: 'Price < EMA50',
    description: 'Close drops below the 50-period EMA (trend break).',
    icon: ArrowDownNarrowWide,
    test: (c) => c.price < c.ema50,
  },
  {
    key: 'bb_upper_touch',
    label: 'Bollinger Upper Band Touch',
    description: 'Close touches or exceeds the upper Bollinger band.',
    icon: AlignHorizontalJustifyCenter,
    test: (c) => c.price >= c.bbUpper,
  },
  {
    key: 'stop_loss',
    label: 'Stop Loss %',
    description: 'Hard stop-loss — exit if the bar low falls to (entry × (1 − SL%)).',
    icon: ShieldX,
    // This rule is special — it's evaluated using the bar low + entry price,
    // not the indicator context. The `test` below is a placeholder; the engine
    // handles SL/TP inline for accurate intrabar fills.
    test: () => false,
  },
  {
    key: 'take_profit',
    label: 'Take Profit %',
    description: 'Hard take-profit — exit if the bar high reaches (entry × (1 + TP%)).',
    icon: Target,
    test: () => false,
  },
];

export const PRESET_STRATEGIES: PresetStrategy[] = [
  {
    key: 'mean_reversion',
    name: 'Mean Reversion',
    description:
      'Buy oversold dips (RSI < 30 or Bollinger lower-band touch) and exit when momentum recovers (RSI > 70 or upper-band touch). Tight 5% stop, 10% target.',
    entryRules: ['rsi_lt_30', 'bb_lower_touch'],
    exitRules: ['rsi_gt_70', 'bb_upper_touch', 'stop_loss', 'take_profit'],
    stopLossPct: 5,
    takeProfitPct: 10,
    positionSizePct: 10,
  },
  {
    key: 'trend_following',
    name: 'Trend Following',
    description:
      'Enter on confirmed uptrend (Price > EMA50 + MACD bullish crossover), exit on trend break (Price < EMA50). Wide 8% stop, 20% target for big swings.',
    entryRules: ['price_gt_ema50', 'macd_bullish_cross'],
    exitRules: ['price_lt_ema50', 'stop_loss', 'take_profit'],
    stopLossPct: 8,
    takeProfitPct: 20,
    positionSizePct: 15,
  },
  {
    key: 'momentum_breakout',
    name: 'Momentum Breakout',
    description:
      'Buy when price is in a short-term uptrend with volume confirmation (Price > EMA20 + Volume > 2x avg). Exit on momentum loss (RSI > 60 or MACD bearish cross).',
    entryRules: ['price_gt_ema20', 'volume_gt_2x_avg'],
    exitRules: ['rsi_gt_60', 'macd_bearish_cross', 'stop_loss', 'take_profit'],
    stopLossPct: 4,
    takeProfitPct: 12,
    positionSizePct: 12,
  },
];

// Quick lookup maps
const ENTRY_RULE_MAP: Record<string, Rule> = Object.fromEntries(
  ENTRY_RULES.map((r) => [r.key, r]),
);
const EXIT_RULE_MAP: Record<string, Rule> = Object.fromEntries(
  EXIT_RULES.map((r) => [r.key, r]),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIsoDate(ms: number): string {
  // YYYY-MM-DD in UTC (Binance kline openTime is UTC ms)
  return new Date(ms).toISOString().slice(0, 10);
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function runBacktest(params: BacktestParams): BacktestResult {
  const {
    klines,
    entryRules,
    exitRules,
    stopLossPct,
    takeProfitPct,
    initialCapital,
    positionSizePct,
  } = params;
  // Fee + slippage model: taker fee per side + slippage as % of price.
  // Default 0 = backward compatible (no costs). Realistic crypto: feePct=0.05,
  // slippagePct=0.02 (total ~0.14% round-trip on taker orders).
  const feePct = params.feePct ?? 0;
  const slippagePct = params.slippagePct ?? 0;
  const costPerSidePct = feePct + slippagePct; // combined cost per side as %

  const n = klines.length;
  const empty: BacktestResult = {
    equity: [],
    trades: [],
    metrics: {
      totalReturnPct: 0,
      finalEquity: initialCapital,
      initialEquity: initialCapital,
      totalTrades: 0,
      winRate: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      avgHoldDays: 0,
      bestTrade: 0,
      worstTrade: 0,
    },
    monthlyReturns: [],
    drawdown: [],
    buyAndHold: [],
  };
  if (n < 30) return empty;

  const series = precomputeIndicators(klines);
  const activeEntryRules = entryRules
    .map((k) => ENTRY_RULE_MAP[k])
    .filter((r): r is Rule => !!r && r.key !== 'stop_loss' && r.key !== 'take_profit');
  const signalExitRules = exitRules
    .map((k) => EXIT_RULE_MAP[k])
    .filter((r): r is Rule => !!r && r.key !== 'stop_loss' && r.key !== 'take_profit');
  const useStopLoss = exitRules.includes('stop_loss');
  const useTakeProfit = exitRules.includes('take_profit');

  // Buy & hold benchmark
  const firstClose = klines[0].close;
  const unitsBuyHold = initialCapital / firstClose;

  // State
  let equity = initialCapital;
  let position: {
    entryPrice: number;
    size: number;
    entryIndex: number;
    highSince: number;
    lowSince: number;
  } | null = null;
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];
  const drawdown: DrawdownPoint[] = [];
  const buyHold: BuyHoldPoint[] = [];
  let peak = equity;

  // We need at least 50 bars of warm-up for EMA50; start trading from bar 50.
  const startIndex = Math.min(50, n - 1);

  for (let i = 0; i < n; i++) {
    const k = klines[i];
    const date = toIsoDate(k.openTime);

    // Buy & hold value at this bar
    const bhValue = unitsBuyHold * k.close;
    buyHold.push({ date, value: bhValue });

    // Build indicator context for bar i
    const ctx: EntryRuleContext = {
      rsi: series.rsi[i] ?? 50,
      macd: series.macd[i] ?? 0,
      macdSignal: series.macdSignal[i] ?? 0,
      macdPrev: i > 0 ? series.macd[i - 1] ?? 0 : 0,
      macdSignalPrev: i > 0 ? series.macdSignal[i - 1] ?? 0 : 0,
      ema20: series.ema20[i] ?? k.close,
      ema50: series.ema50[i] ?? k.close,
      bbLower: series.bbLower[i] ?? k.close,
      bbUpper: series.bbUpper[i] ?? k.close,
      price: k.close,
      volume: k.volume,
      avgVolume: series.avgVolume[i] ?? 0,
    };

    if (i >= startIndex) {
      if (position) {
        // ---- In position: check exits ----
        const entryPrice = position.entryPrice;
        const slPrice = useStopLoss
          ? entryPrice * (1 - stopLossPct / 100)
          : -Infinity;
        const tpPrice = useTakeProfit
          ? entryPrice * (1 + takeProfitPct / 100)
          : Infinity;

        let exitReason: Trade['exitReason'] | null = null;
        let exitPrice: number | null = null;

        if (useStopLoss && k.low <= slPrice) {
          exitReason = 'Stop Loss';
          exitPrice = slPrice;
        } else if (useTakeProfit && k.high >= tpPrice) {
          exitReason = 'Take Profit';
          exitPrice = tpPrice;
        } else {
          // Build exit context with position info
          const exitCtx: ExitRuleContext = {
            ...ctx,
            entryPrice,
            highSinceEntry: position.highSince,
            lowSinceEntry: position.lowSince,
          };
          for (const rule of signalExitRules) {
            if (rule.test(exitCtx)) {
              exitReason = 'Signal Exit';
              exitPrice = k.close;
              break;
            }
          }
        }

        if (exitReason && exitPrice !== null) {
          // Apply slippage: entry was filled worse (higher for long), exit worse (lower).
          // Costs: fee on both entry and exit notional.
          const entryFillPrice = entryPrice * (1 + costPerSidePct / 100);
          const exitFillPrice = exitPrice * (1 - costPerSidePct / 100);
          const pnl = (exitFillPrice - entryFillPrice) * position.size;
          const positionValueAtEntry = entryFillPrice * position.size;
          const pnlPct =
            positionValueAtEntry > 0 ? (pnl / positionValueAtEntry) * 100 : 0;
          equity += pnl;
          trades.push({
            id: trades.length + 1,
            entryDate: toIsoDate(klines[position.entryIndex].openTime),
            entryPrice,
            exitDate: date,
            exitPrice,
            size: position.size,
            side: 'long',
            pnl,
            pnlPct,
            holdDays: i - position.entryIndex,
            exitReason,
          });
          position = null;
        } else {
          // Update trailing high/low for the position
          if (k.high > position.highSince) position.highSince = k.high;
          if (k.low < position.lowSince) position.lowSince = k.low;
        }
      }

      if (!position) {
        // ---- Out of position: check entries ----
        // Only ONE entry per bar (re-check after a same-bar exit doesn't enter;
        // we wait until the next bar to avoid lookahead on the exit price).
        let entry = false;
        for (const rule of activeEntryRules) {
          if (rule.test(ctx)) {
            entry = true;
            break;
          }
        }
        if (entry) {
          const positionValue = (equity * positionSizePct) / 100;
          const size = positionValue / k.close;
          position = {
            entryPrice: k.close,
            size,
            entryIndex: i,
            highSince: k.high,
            lowSince: k.low,
          };
        }
      }
    }

    // Mark-to-market equity at the close: if in position, add unrealized P&L.
    const mtmEquity = position
      ? equity + (k.close - position.entryPrice) * position.size
      : equity;
    equityCurve.push({ date, value: mtmEquity });

    if (mtmEquity > peak) peak = mtmEquity;
    const dd = peak > 0 ? ((mtmEquity - peak) / peak) * 100 : 0;
    drawdown.push({ date, drawdownPct: dd });
  }

  // Close any still-open position at the last close
  if (position) {
    const lastK = klines[n - 1];
    const entryPrice = position.entryPrice;
    const exitPrice = lastK.close;
    // Apply costs on final close too
    const entryFillPrice = entryPrice * (1 + costPerSidePct / 100);
    const exitFillPrice = exitPrice * (1 - costPerSidePct / 100);
    const pnl = (exitFillPrice - entryFillPrice) * position.size;
    const positionValueAtEntry = entryFillPrice * position.size;
    const pnlPct =
      positionValueAtEntry > 0 ? (pnl / positionValueAtEntry) * 100 : 0;
    equity += pnl;
    trades.push({
      id: trades.length + 1,
      entryDate: toIsoDate(klines[position.entryIndex].openTime),
      entryPrice,
      exitDate: toIsoDate(lastK.openTime),
      exitPrice,
      size: position.size,
      side: 'long',
      pnl,
      pnlPct,
      holdDays: n - 1 - position.entryIndex,
      exitReason: 'Signal Exit',
    });
    // Update final equity point to reflect the realized close
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1] = {
        date: equityCurve[equityCurve.length - 1].date,
        value: equity,
      };
    }
  }

  // ----- Metrics -----
  const finalEquity = equityCurve.length
    ? equityCurve[equityCurve.length - 1].value
    : initialCapital;
  const totalReturnPct =
    initialCapital > 0
      ? ((finalEquity - initialCapital) / initialCapital) * 100
      : 0;

  const wins = trades.filter((t) => t.pnl > 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

  let maxDD = 0;
  let runningPeak = -Infinity;
  for (const p of equityCurve) {
    if (p.value > runningPeak) runningPeak = p.value;
    if (runningPeak > 0) {
      const dd = ((p.value - runningPeak) / runningPeak) * 100;
      if (dd < maxDD) maxDD = dd;
    }
  }
  const maxDrawdownPct = Math.abs(maxDD);

  // Sharpe ratio: daily returns from equity curve
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].value;
    const cur = equityCurve[i].value;
    if (prev > 0) dailyReturns.push((cur - prev) / prev);
  }
  const m = mean(dailyReturns);
  const s = std(dailyReturns);
  const sharpeRatio = s > 0 ? (m / s) * Math.sqrt(252) : 0;

  const avgHoldDays =
    trades.length > 0
      ? trades.reduce((s, t) => s + t.holdDays, 0) / trades.length
      : 0;
  const bestTrade = trades.reduce((b, t) => (t.pnl > b ? t.pnl : b), 0);
  const worstTrade = trades.reduce((w, t) => (t.pnl < w ? t.pnl : w), 0);

  // ----- Monthly returns -----
  // Bucket equity by (year, month). For each month, return = (lastEquity / lastEquityPrevMonth) - 1.
  const monthlyMap = new Map<string, { last: number; trades: number }>();
  for (const t of trades) {
    const d = new Date(t.exitDate + 'T00:00:00Z');
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const cur = monthlyMap.get(key) || { last: 0, trades: 0 };
    cur.trades += 1;
    monthlyMap.set(key, cur);
  }
  // Track last equity per month from equity curve
  const equityByMonth = new Map<string, number>();
  for (const p of equityCurve) {
    const d = new Date(p.date + 'T00:00:00Z');
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    equityByMonth.set(key, p.value);
  }
  const monthlyKeys = Array.from(equityByMonth.keys()).sort((a, b) => {
    const [ay, am] = a.split('-').map(Number);
    const [by, bm] = b.split('-').map(Number);
    return ay !== by ? ay - by : am - bm;
  });
  const monthlyReturns: MonthlyReturn[] = [];
  let prevMonthLast: number | null = null;
  for (const key of monthlyKeys) {
    const [year, month] = key.split('-').map(Number);
    const last = equityByMonth.get(key)!;
    const tradesForMonth = monthlyMap.get(key)?.trades ?? 0;
    let returnPct = 0;
    if (prevMonthLast !== null && prevMonthLast > 0) {
      returnPct = ((last - prevMonthLast) / prevMonthLast) * 100;
    } else if (initialCapital > 0) {
      // First month: compare to initial capital
      returnPct = ((last - initialCapital) / initialCapital) * 100;
    }
    monthlyReturns.push({ year, month, returnPct, trades: tradesForMonth });
    prevMonthLast = last;
  }

  return {
    equity: equityCurve,
    trades,
    metrics: {
      totalReturnPct,
      finalEquity,
      initialEquity: initialCapital,
      totalTrades: trades.length,
      winRate,
      maxDrawdownPct,
      sharpeRatio,
      avgHoldDays,
      bestTrade,
      worstTrade,
    },
    monthlyReturns,
    drawdown,
    buyAndHold: buyHold,
  };
}

// Re-export for UI convenience
export const RULE_ICONS = {
  entry: ENTRY_RULES.reduce<Record<string, LucideIcon>>((acc, r) => {
    acc[r.key] = r.icon;
    return acc;
  }, {}),
  exit: EXIT_RULES.reduce<Record<string, LucideIcon>>((acc, r) => {
    acc[r.key] = r.icon;
    return acc;
  }, {}),
  CircleSlash,
};
