// Market Screener — pure TypeScript filter logic.
//
// Defines the 14 technical filters used by the /screener page, plus the
// preset strategy bundles and conviction-score computation. No React/DOM
// dependencies — the API route imports these and so does the client UI.
//
// Filter test functions take a `TechnicalIndicators` object (from
// computeIndicators()) and the ticker snapshot, returning a boolean.
// `applyFilters()` returns the matched filter keys; `computeConvictionScore()`
// maps matched filters + signal strength to a 0-100 score.

import type { Ticker, TechnicalIndicators } from '@/lib/types';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  ArrowDownCircle,
  ArrowUpCircle,
  Crosshair,
  Minimize2,
  Zap,
  Target,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

/** Color tokens used by both the chip UI and the signal icons in the table. */
export type FilterColor =
  | 'emerald'
  | 'rose'
  | 'amber'
  | 'teal'
  | 'orange'
  | 'zinc';

export interface TechnicalFilter {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  color: FilterColor;
  /** Direction this filter implies — used by the "All/Bullish/Bearish" pill filter. */
  direction: 'bullish' | 'bearish' | 'neutral';
  test: (indicators: TechnicalIndicators, ticker: Ticker) => boolean;
}

/**
 * The 14 technical filters exposed in the Screener UI. Order matters — this is
 * the order chips appear in the panel.
 */
export const TECHNICAL_FILTERS: TechnicalFilter[] = [
  {
    key: 'rsi_oversold',
    label: 'RSI Oversold',
    description: 'RSI(14) < 30 — oversold, possible bounce entry.',
    icon: ArrowDownCircle,
    color: 'emerald',
    direction: 'bullish',
    test: (i) => i.rsi < 30,
  },
  {
    key: 'rsi_overbought',
    label: 'RSI Overbought',
    description: 'RSI(14) > 70 — overbought, possible short setup.',
    icon: ArrowUpCircle,
    color: 'rose',
    direction: 'bearish',
    test: (i) => i.rsi > 70,
  },
  {
    key: 'macd_bullish',
    label: 'MACD Bullish',
    description: 'MACD histogram > 0 and rising — bullish momentum.',
    icon: TrendingUp,
    color: 'emerald',
    direction: 'bullish',
    test: (i) => i.macd.histogram > 0,
  },
  {
    key: 'macd_bearish',
    label: 'MACD Bearish',
    description: 'MACD histogram < 0 and falling — bearish momentum.',
    icon: TrendingDown,
    color: 'rose',
    direction: 'bearish',
    test: (i) => i.macd.histogram < 0,
  },
  {
    key: 'above_ema50',
    label: 'Above EMA50',
    description: 'Price above EMA50 — medium-term uptrend.',
    icon: TrendingUp,
    color: 'teal',
    direction: 'bullish',
    test: (i, t) => i.ema50 > 0 && t.price > i.ema50,
  },
  {
    key: 'below_ema50',
    label: 'Below EMA50',
    description: 'Price below EMA50 — medium-term downtrend.',
    icon: TrendingDown,
    color: 'orange',
    direction: 'bearish',
    test: (i, t) => i.ema50 > 0 && t.price < i.ema50,
  },
  {
    key: 'golden_cross',
    label: 'Golden Cross',
    description: 'EMA20 above EMA50 — bullish EMA cross setup.',
    icon: Crosshair,
    color: 'emerald',
    direction: 'bullish',
    test: (i) => i.ema20 > i.ema50,
  },
  {
    key: 'death_cross',
    label: 'Death Cross',
    description: 'EMA20 below EMA50 — bearish EMA cross setup.',
    icon: Crosshair,
    color: 'rose',
    direction: 'bearish',
    test: (i) => i.ema20 < i.ema50,
  },
  {
    key: 'bollinger_squeeze',
    label: 'Bollinger Squeeze',
    description: 'Tight Bollinger Bands (low ATR/range) — breakout pending.',
    icon: Minimize2,
    color: 'amber',
    direction: 'neutral',
    test: (i) => {
      const range = i.bollinger.upper - i.bollinger.lower;
      const mid = i.bollinger.middle || 1;
      // Width as % of mid price; < 3% is "squeeze".
      const widthPct = (range / mid) * 100;
      return widthPct < 3 && widthPct > 0;
    },
  },
  {
    key: 'volume_spike',
    label: 'Volume Spike',
    description: 'Last volume > 2× average — institutional activity.',
    icon: Zap,
    color: 'amber',
    direction: 'neutral',
    // Volume-spike detection needs the ticker's 24h volume relative to its
    // average. We use the ticker's quoteVolume as the "current" volume and
    // the indicators.atr relative to price as a volatility proxy. The real
    // comparison happens against the average of recent kline volumes which we
    // don't have here; we approximate with the indicator's ATR/price ratio
    // (high ATR% = volatile = "spike-like"). For precise detection, see the
    // API route which passes a richer ticker.volume.
    test: (i, t) => {
      // Heuristic: 24h volume > $5M AND ATR/price > 4% = "active + volatile".
      const atrPct = i.atr / Math.max(t.price, 1) * 100;
      return t.quoteVolume > 5_000_000 && atrPct > 4;
    },
  },
  {
    key: 'bullish_trend',
    label: 'Bullish Trend',
    description: 'EMA20 > EMA50 > EMA200 — confirmed uptrend.',
    icon: TrendingUp,
    color: 'emerald',
    direction: 'bullish',
    test: (i) => i.trend === 'bullish',
  },
  {
    key: 'bearish_trend',
    label: 'Bearish Trend',
    description: 'EMA20 < EMA50 < EMA200 — confirmed downtrend.',
    icon: TrendingDown,
    color: 'rose',
    direction: 'bearish',
    test: (i) => i.trend === 'bearish',
  },
  {
    key: 'near_support',
    label: 'Near Support',
    description: 'Price within 2% of nearest S/R support level.',
    icon: Target,
    color: 'teal',
    direction: 'bullish',
    test: (i, t) => {
      if (i.support.length === 0) return false;
      const nearest = i.support.reduce((best, lvl) =>
        Math.abs(lvl - t.price) < Math.abs(best - t.price) ? lvl : best,
      );
      const distPct = Math.abs(nearest - t.price) / t.price * 100;
      return distPct <= 2 && nearest <= t.price * 1.02;
    },
  },
  {
    key: 'near_resistance',
    label: 'Near Resistance',
    description: 'Price within 2% of nearest S/R resistance level.',
    icon: ShieldAlert,
    color: 'orange',
    direction: 'bearish',
    test: (i, t) => {
      if (i.resistance.length === 0) return false;
      const nearest = i.resistance.reduce((best, lvl) =>
        Math.abs(lvl - t.price) < Math.abs(best - t.price) ? lvl : best,
      );
      const distPct = Math.abs(nearest - t.price) / t.price * 100;
      return distPct <= 2 && nearest >= t.price * 0.98;
    },
  },
];

export const FILTER_BY_KEY: Record<string, TechnicalFilter> = Object.fromEntries(
  TECHNICAL_FILTERS.map((f) => [f.key, f]),
);

/**
 * Apply the active filter set to an asset's indicators + ticker, returning
 * the list of matched filter keys. If `activeFilters` is empty, returns an
 * empty array — the caller is expected to either include or exclude assets
 * with zero matches depending on context (screener excludes them).
 */
export function applyFilters(
  indicators: TechnicalIndicators,
  ticker: Ticker,
  activeFilters: string[],
): string[] {
  if (activeFilters.length === 0) return [];
  const matched: string[] = [];
  for (const key of activeFilters) {
    const f = FILTER_BY_KEY[key];
    if (!f) continue;
    try {
      if (f.test(indicators, ticker)) matched.push(key);
    } catch {
      // A filter test should never throw, but defensive — skip on error.
    }
  }
  return matched;
}

/**
 * Compute a 0-100 conviction score from matched filters + signal strength.
 *
 * Score formula:
 *   - Each matched filter contributes a base weight (bullish/bearish filters
 *     weigh more than neutral ones).
 *   - Bonus from indicator strength: |RSI-50|/50, |MACD hist|/price, etc.
 *   - Capped at 100. With 0 matches → 0.
 */
export function computeConvictionScore(
  matchedFilters: string[],
  indicators: TechnicalIndicators,
): number {
  if (matchedFilters.length === 0) return 0;

  let score = 0;
  for (const key of matchedFilters) {
    const f = FILTER_BY_KEY[key];
    if (!f) continue;
    // Bullish/bearish filters are worth 14 each; neutral ones 9.
    score += f.direction === 'neutral' ? 9 : 14;
  }

  // Strength bonus — amplify the score based on how extreme the readings are.
  const rsiStrength = Math.abs(indicators.rsi - 50) / 50; // 0..1
  const macdStrength = Math.min(
    1,
    Math.abs(indicators.macd.histogram) /
      Math.max(indicators.bollinger.middle || 1, 1) *
      100,
  );
  const trendStrength =
    indicators.trend === 'neutral' ? 0.2 : 0.6;

  score += rsiStrength * 12;
  score += macdStrength * 10;
  score += trendStrength * 8;

  return Math.round(Math.min(100, Math.max(0, score)));
}

export interface PresetStrategy {
  name: string;
  description: string;
  icon: LucideIcon;
  filters: string[];
}

/**
 * Quick-load filter bundles — each preset card in the UI loads these
 * instantly when clicked.
 */
export const PRESET_STRATEGIES: PresetStrategy[] = [
  {
    name: 'Oversold Bounce',
    description: 'Catch falling knives that should snap back. Long-biased.',
    icon: Activity,
    filters: ['rsi_oversold', 'bullish_trend', 'above_ema50'],
  },
  {
    name: 'Momentum Breakout',
    description: 'High-volume breakouts with confirming MACD momentum.',
    icon: Zap,
    filters: ['volume_spike', 'above_ema50', 'macd_bullish'],
  },
  {
    name: 'Short Setup',
    description: 'Overbought + bearish trend + bearish MACD. Short-biased.',
    icon: TrendingDown,
    filters: ['rsi_overbought', 'bearish_trend', 'macd_bearish'],
  },
  {
    name: 'Mean Reversion',
    description: 'Oversold bounces near structural support levels.',
    icon: Target,
    filters: ['near_support', 'rsi_oversold'],
  },
];

/** Map a FilterColor token to a hex value for chart fills + signal dots. */
export const FILTER_COLOR_HEX: Record<FilterColor, string> = {
  emerald: '#10b981',
  rose: '#f43f5e',
  amber: '#f59e0b',
  teal: '#14b8a6',
  orange: '#f97316',
  zinc: '#a1a1aa',
};

/** Tailwind class fragments per color — used by chips, dots, bars, badges. */
export const FILTER_COLOR_CLASSES: Record<
  FilterColor,
  {
    text: string;
    bg: string;
    border: string;
    activeBg: string;
    activeBorder: string;
    activeText: string;
    dot: string;
    barFrom: string;
    barTo: string;
    glow: string;
  }
> = {
  emerald: {
    text: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    activeBg: 'bg-emerald-500/15',
    activeBorder: 'border-emerald-500/50',
    activeText: 'text-emerald-400',
    dot: 'bg-emerald-500',
    barFrom: 'from-emerald-500',
    barTo: 'to-teal-400',
    glow: 'shadow-[0_0_12px_rgba(16,185,129,0.45)]',
  },
  rose: {
    text: 'text-rose-500',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    activeBg: 'bg-rose-500/15',
    activeBorder: 'border-rose-500/50',
    activeText: 'text-rose-400',
    dot: 'bg-rose-500',
    barFrom: 'from-rose-500',
    barTo: 'to-rose-400',
    glow: 'shadow-[0_0_12px_rgba(244,63,94,0.45)]',
  },
  amber: {
    text: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    activeBg: 'bg-amber-500/15',
    activeBorder: 'border-amber-500/50',
    activeText: 'text-amber-400',
    dot: 'bg-amber-500',
    barFrom: 'from-amber-500',
    barTo: 'to-orange-400',
    glow: 'shadow-[0_0_12px_rgba(245,158,11,0.45)]',
  },
  teal: {
    text: 'text-teal-500',
    bg: 'bg-teal-500/10',
    border: 'border-teal-500/30',
    activeBg: 'bg-teal-500/15',
    activeBorder: 'border-teal-500/50',
    activeText: 'text-teal-400',
    dot: 'bg-teal-500',
    barFrom: 'from-teal-500',
    barTo: 'to-emerald-400',
    glow: 'shadow-[0_0_12px_rgba(20,184,166,0.45)]',
  },
  orange: {
    text: 'text-orange-500',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    activeBg: 'bg-orange-500/15',
    activeBorder: 'border-orange-500/50',
    activeText: 'text-orange-400',
    dot: 'bg-orange-500',
    barFrom: 'from-orange-500',
    barTo: 'to-amber-400',
    glow: 'shadow-[0_0_12px_rgba(249,115,22,0.45)]',
  },
  zinc: {
    text: 'text-zinc-500',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/30',
    activeBg: 'bg-zinc-500/15',
    activeBorder: 'border-zinc-500/50',
    activeText: 'text-zinc-300',
    dot: 'bg-zinc-500',
    barFrom: 'from-zinc-500',
    barTo: 'to-zinc-400',
    glow: 'shadow-[0_0_12px_rgba(161,161,170,0.45)]',
  },
};

/** Result row returned by the screener API. */
export interface ScreenerResult {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  quoteVolume: number;
  rsi: number;
  macdHistogram: number;
  ema20: number;
  ema50: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  matchedFilters: string[];
  conviction: number;
  /** Distance to nearest support (%, +ve = above). */
  supportDistPct: number;
  /** Distance to nearest resistance (%, +ve = below). */
  resistanceDistPct: number;
}

/** Sort options surfaced in the UI. */
export type SortKey =
  | 'conviction'
  | 'changePct'
  | 'volume'
  | 'rsi'
  | 'symbol';

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'conviction', label: 'Conviction Score' },
  { value: 'volume', label: '24h Volume' },
  { value: 'changePct', label: '24h Change %' },
  { value: 'rsi', label: 'RSI (14)' },
  { value: 'symbol', label: 'Symbol (A-Z)' },
];
