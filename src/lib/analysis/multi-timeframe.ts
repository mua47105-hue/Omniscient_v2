// Multi-timeframe analysis — pure TypeScript confluence engine.
// Combines indicator readings from 1h / 4h / 1d / 1w into one weighted
// confluence score, a verdict label, an agreement matrix, rule-based
// insights, and an entry/exit suggestion derived from nearest
// support/resistance.

import type { Kline, TechnicalIndicators } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type TimeframeKey = '1h' | '4h' | '1d' | '1w';

export const TIMEFRAME_ORDER: TimeframeKey[] = ['1h', '4h', '1d', '1w'];

export const TIMEFRAME_WEIGHTS: Record<TimeframeKey, number> = {
  '1h': 0.15,
  '4h': 0.25,
  '1d': 0.35,
  '1w': 0.25,
};

export const TIMEFRAME_LABELS: Record<TimeframeKey, string> = {
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
  '1w': '1W',
};

export interface TimeframeAnalysis {
  interval: TimeframeKey;
  klines: Kline[]; // last 50, for the mini chart
  indicators: TechnicalIndicators;
}

export type Verdict =
  | 'STRONG_BULLISH'
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'STRONG_BEARISH';

export type CellSignal = 'bullish' | 'bearish' | 'neutral';

export interface ConfluenceResult {
  score: number; // -100..100
  verdict: Verdict;
  agreementCount: number; // how many of the 4 timeframes agree on direction (0..4)
  agreementDirection: CellSignal; // the dominant direction
  agreementBar: { interval: TimeframeKey; vote: CellSignal; score: number; weight: number }[];
}

export interface AgreementMatrixRow {
  indicator: string;
  hint: string;
  values: Record<TimeframeKey, CellSignal>;
}

export type InsightType = 'opportunity' | 'caution' | 'warning' | 'info';

export interface Insight {
  id: string;
  type: InsightType;
  icon: string; // lucide icon name (rendered by client)
  title: string;
  message: string;
  timeframes: TimeframeKey[];
  confidence: number; // 1..5 dots
}

export interface EntrySuggestion {
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  target: number;
  rr: number; // reward:risk ratio (e.g. 2.5)
  rationale: string;
  stopSource: TimeframeKey;
  targetSource: TimeframeKey;
}

// ---------------------------------------------------------------------------
// Per-indicator cell classification (used by the agreement matrix)
// ---------------------------------------------------------------------------
function rsiSignal(rsi: number): CellSignal {
  if (rsi < 30) return 'bullish'; // oversold → bounce
  if (rsi > 70) return 'bearish'; // overbought → pullback
  return 'neutral';
}

function macdSignal(ind: TechnicalIndicators): CellSignal {
  if (ind.macd.histogram > 0) return 'bullish';
  if (ind.macd.histogram < 0) return 'bearish';
  return 'neutral';
}

function emaCrossSignal(ind: TechnicalIndicators): CellSignal {
  if (ind.ema20 > ind.ema50) return 'bullish';
  if (ind.ema20 < ind.ema50) return 'bearish';
  return 'neutral';
}

function priceVsEma200Signal(ind: TechnicalIndicators, lastPrice: number): CellSignal {
  if (lastPrice > ind.ema200) return 'bullish';
  if (lastPrice < ind.ema200) return 'bearish';
  return 'neutral';
}

function bollingerSignal(ind: TechnicalIndicators, lastPrice: number): CellSignal {
  const { upper, lower } = ind.bollinger;
  if (lastPrice > upper) return 'bearish'; // overbought band
  if (lastPrice < lower) return 'bullish'; // oversold band
  return 'neutral';
}

function vwapSignal(ind: TechnicalIndicators, lastPrice: number): CellSignal {
  if (lastPrice > ind.vwap) return 'bullish';
  if (lastPrice < ind.vwap) return 'bearish';
  return 'neutral';
}

function trendSignal(ind: TechnicalIndicators): CellSignal {
  if (ind.trend === 'bullish') return 'bullish';
  if (ind.trend === 'bearish') return 'bearish';
  return 'neutral';
}

// Helper — what direction does the summary score lean?
function scoreDirection(score: number): CellSignal {
  if (score > 10) return 'bullish';
  if (score < -10) return 'bearish';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Confluence score (weighted average of timeframe summary scores)
// ---------------------------------------------------------------------------
export function computeConfluenceScore(timeframes: TimeframeAnalysis[]): ConfluenceResult {
  // Weights normalize across whatever timeframes were supplied (usually all 4).
  const supplied = timeframes.filter((t) => TIMEFRAME_ORDER.includes(t.interval));
  const totalWeight = supplied.reduce(
    (sum, tf) => sum + (TIMEFRAME_WEIGHTS[tf.interval] ?? 0),
    0,
  );
  const safeWeight = totalWeight > 0 ? totalWeight : 1;

  let weighted = 0;
  for (const tf of supplied) {
    const w = TIMEFRAME_WEIGHTS[tf.interval] ?? 0;
    weighted += (tf.indicators.summary.score ?? 0) * w;
  }
  const score = Math.round(weighted / safeWeight);
  const verdict = scoreToVerdict(score);

  // Agreement count: how many TFs lean the same direction as the verdict.
  const votes = supplied.map((tf) => ({
    interval: tf.interval,
    vote: scoreDirection(tf.indicators.summary.score),
    score: tf.indicators.summary.score,
    weight: TIMEFRAME_WEIGHTS[tf.interval] ?? 0,
  }));

  const dominant: CellSignal =
    votes.filter((v) => v.vote === 'bullish').length >=
    votes.filter((v) => v.vote === 'bearish').length
      ? 'bullish'
      : 'bearish';

  const agreementCount = votes.filter((v) => v.vote === dominant).length;
  const agreementDirection: CellSignal =
    agreementCount >= 3 ? dominant : 'neutral';

  // Sort the bar by canonical order
  const agreementBar = TIMEFRAME_ORDER.map((k) => {
    const v = votes.find((x) => x.interval === k);
    return (
      v ?? {
        interval: k,
        vote: 'neutral' as CellSignal,
        score: 0,
        weight: TIMEFRAME_WEIGHTS[k],
      }
    );
  });

  return { score, verdict, agreementCount, agreementDirection, agreementBar };
}

export function scoreToVerdict(score: number): Verdict {
  if (score >= 50) return 'STRONG_BULLISH';
  if (score >= 20) return 'BULLISH';
  if (score > -20) return 'NEUTRAL';
  if (score > -50) return 'BEARISH';
  return 'STRONG_BEARISH';
}

// ---------------------------------------------------------------------------
// Agreement matrix
// ---------------------------------------------------------------------------
export function buildAgreementMatrix(timeframes: TimeframeAnalysis[]): AgreementMatrixRow[] {
  const byKey = new Map<TimeframeKey, TimeframeAnalysis>();
  for (const tf of timeframes) byKey.set(tf.interval, tf);

  const get = (k: TimeframeKey) => byKey.get(k);
  const lastPrice = (k: TimeframeKey) => {
    const tf = get(k);
    if (!tf || tf.klines.length === 0) return 0;
    return tf.klines[tf.klines.length - 1].close;
  };

  return [
    {
      indicator: 'Trend',
      hint: 'EMA20/50/200 alignment — primary direction of the move.',
      values: {
        '1h': trendSignal(get('1h')?.indicators ?? defaultIndicators()),
        '4h': trendSignal(get('4h')?.indicators ?? defaultIndicators()),
        '1d': trendSignal(get('1d')?.indicators ?? defaultIndicators()),
        '1w': trendSignal(get('1w')?.indicators ?? defaultIndicators()),
      },
    },
    {
      indicator: 'RSI (14)',
      hint: 'Relative Strength Index — <30 oversold (bounce), >70 overbought (pullback).',
      values: {
        '1h': rsiSignal(get('1h')?.indicators.rsi ?? 50),
        '4h': rsiSignal(get('4h')?.indicators.rsi ?? 50),
        '1d': rsiSignal(get('1d')?.indicators.rsi ?? 50),
        '1w': rsiSignal(get('1w')?.indicators.rsi ?? 50),
      },
    },
    {
      indicator: 'MACD',
      hint: 'Moving Average Convergence Divergence — histogram >0 bullish, <0 bearish.',
      values: {
        '1h': macdSignal(get('1h')?.indicators ?? defaultIndicators()),
        '4h': macdSignal(get('4h')?.indicators ?? defaultIndicators()),
        '1d': macdSignal(get('1d')?.indicators ?? defaultIndicators()),
        '1w': macdSignal(get('1w')?.indicators ?? defaultIndicators()),
      },
    },
    {
      indicator: 'EMA20 / EMA50',
      hint: 'Short-term vs medium-term exponential moving average — golden/death cross proxy.',
      values: {
        '1h': emaCrossSignal(get('1h')?.indicators ?? defaultIndicators()),
        '4h': emaCrossSignal(get('4h')?.indicators ?? defaultIndicators()),
        '1d': emaCrossSignal(get('1d')?.indicators ?? defaultIndicators()),
        '1w': emaCrossSignal(get('1w')?.indicators ?? defaultIndicators()),
      },
    },
    {
      indicator: 'Price / EMA200',
      hint: 'Where price sits relative to the 200-period EMA — bull/bear regime filter.',
      values: {
        '1h': priceVsEma200Signal(get('1h')?.indicators ?? defaultIndicators(), lastPrice('1h')),
        '4h': priceVsEma200Signal(get('4h')?.indicators ?? defaultIndicators(), lastPrice('4h')),
        '1d': priceVsEma200Signal(get('1d')?.indicators ?? defaultIndicators(), lastPrice('1d')),
        '1w': priceVsEma200Signal(get('1w')?.indicators ?? defaultIndicators(), lastPrice('1w')),
      },
    },
    {
      indicator: 'Bollinger',
      hint: 'Position vs Bollinger Bands — outside upper = overbought, outside lower = oversold.',
      values: {
        '1h': bollingerSignal(get('1h')?.indicators ?? defaultIndicators(), lastPrice('1h')),
        '4h': bollingerSignal(get('4h')?.indicators ?? defaultIndicators(), lastPrice('4h')),
        '1d': bollingerSignal(get('1d')?.indicators ?? defaultIndicators(), lastPrice('1d')),
        '1w': bollingerSignal(get('1w')?.indicators ?? defaultIndicators(), lastPrice('1w')),
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Insights (rule-based)
// ---------------------------------------------------------------------------
export function generateInsights(timeframes: TimeframeAnalysis[]): Insight[] {
  const byKey = new Map<TimeframeKey, TimeframeAnalysis>();
  for (const tf of timeframes) byKey.set(tf.interval, tf);
  const get = (k: TimeframeKey) => byKey.get(k);

  const out: Insight[] = [];
  const push = (i: Insight) => out.push(i);

  const directions = TIMEFRAME_ORDER.map((k) => ({
    interval: k,
    tf: get(k),
    dir: scoreDirection(get(k)?.indicators.summary.score ?? 0) as CellSignal,
    rsi: get(k)?.indicators.rsi ?? 50,
    macdHist: get(k)?.indicators.macd.histogram ?? 0,
    trend: get(k)?.indicators.trend ?? 'neutral',
    priceVsEma200:
      get(k) && get(k)!.klines.length > 0
        ? get(k)!.klines[get(k)!.klines.length - 1].close > get(k)!.indicators.ema200
          ? 'above'
          : 'below'
        : 'unknown',
    emaCross:
      (get(k)?.indicators.ema20 ?? 0) > (get(k)?.indicators.ema50 ?? 0) ? 'above' : 'below',
  }));

  const bullCount = directions.filter((d) => d.dir === 'bullish').length;
  const bearCount = directions.filter((d) => d.dir === 'bearish').length;
  const neutralCount = directions.filter((d) => d.dir === 'neutral').length;

  // 1) Full agreement bullish
  if (bullCount === 4) {
    push({
      id: 'all-bullish',
      type: 'opportunity',
      icon: 'TrendingUp',
      title: 'All 4 timeframes bullish',
      message:
        '1H / 4H / 1D / 1W all lean bullish — high-confidence long setup. This is the strongest confluence signal: trend alignment across all timeframes typically precedes a continuation move.',
      timeframes: ['1h', '4h', '1d', '1w'],
      confidence: 5,
    });
  }

  // 2) Full agreement bearish
  if (bearCount === 4) {
    push({
      id: 'all-bearish',
      type: 'warning',
      icon: 'TrendingDown',
      title: 'All 4 timeframes bearish',
      message:
        '1H / 4H / 1D / 1W all lean bearish — high-confidence short setup. Trend alignment across all timeframes typically precedes further downside.',
      timeframes: ['1h', '4h', '1d', '1w'],
      confidence: 5,
    });
  }

  // 3) Short-term divergence from higher TFs
  const higherTfs = directions.filter((d) => d.interval !== '1h');
  const higherBull = higherTfs.filter((d) => d.dir === 'bullish').length;
  const higherBear = higherTfs.filter((d) => d.dir === 'bearish').length;
  const oneH = directions.find((d) => d.interval === '1h');
  if (oneH && higherBull >= 2 && oneH.dir === 'bearish') {
    push({
      id: '1h-divergence-bear',
      type: 'caution',
      icon: 'AlertTriangle',
      title: '1H diverges from higher timeframes',
      message:
        '1H is bearish while 4H/1D/1W remain bullish — likely noise or a short pullback. Wait for 1H to re-align before adding to longs.',
      timeframes: ['1h', '4h', '1d', '1w'],
      confidence: 3,
    });
  }
  if (oneH && higherBear >= 2 && oneH.dir === 'bullish') {
    push({
      id: '1h-divergence-bull',
      type: 'caution',
      icon: 'AlertTriangle',
      title: '1H diverges from higher timeframes',
      message:
        '1H is bullish while 4H/1D/1W are bearish — likely a counter-trend bounce. Avoid chasing; wait for higher-TF confirmation.',
      timeframes: ['1h', '4h', '1d', '1w'],
      confidence: 3,
    });
  }

  // 4) Weekly vs daily conflict (counter-trend bounce)
  const daily = directions.find((d) => d.interval === '1d');
  const weekly = directions.find((d) => d.interval === '1w');
  if (daily && weekly && daily.dir !== 'neutral' && daily.dir !== weekly.dir) {
    push({
      id: 'wk-vs-dly',
      type: 'caution',
      icon: 'AlertTriangle',
      title:
        weekly.dir === 'bearish' && daily.dir === 'bullish'
          ? 'Weekly bearish but daily bullish'
          : 'Weekly bullish but daily bearish',
      message:
        weekly.dir === 'bearish' && daily.dir === 'bullish'
          ? 'Counter-trend bounce on the daily within a bearish weekly regime — scale in small and keep stops tight. The weekly trend will likely reassert.'
          : 'Daily pullback within a bullish weekly regime — possible dip-buying opportunity, but wait for daily to stabilize.',
      timeframes: ['1d', '1w'],
      confidence: 3,
    });
  }

  // 5) RSI oversold on 3+ timeframes
  const oversold = directions.filter((d) => d.rsi < 30);
  if (oversold.length >= 3) {
    push({
      id: 'rsi-oversold',
      type: 'opportunity',
      icon: 'ArrowUpRight',
      title: `RSI oversold on ${oversold.length} timeframes`,
      message: `RSI < 30 on ${oversold
        .map((d) => d.interval.toUpperCase())
        .join(', ')} — multi-timeframe oversold conditions often mark reversal zones. Watch for momentum divergence for confirmation.`,
      timeframes: oversold.map((d) => d.interval),
      confidence: 4,
    });
  }

  // 6) RSI overbought on 3+ timeframes
  const overbought = directions.filter((d) => d.rsi > 70);
  if (overbought.length >= 3) {
    push({
      id: 'rsi-overbought',
      type: 'warning',
      icon: 'ArrowDownRight',
      title: `RSI overbought on ${overbought.length} timeframes`,
      message: `RSI > 70 on ${overbought
        .map((d) => d.interval.toUpperCase())
        .join(', ')} — multi-timeframe overbought conditions often precede a pullback. Consider trimming or tightening trailing stops.`,
      timeframes: overbought.map((d) => d.interval),
      confidence: 4,
    });
  }

  // 7) Price above EMA200 on all timeframes
  const aboveAll = directions.filter((d) => d.priceVsEma200 === 'above');
  if (aboveAll.length === 4) {
    push({
      id: 'ema200-above-all',
      type: 'opportunity',
      icon: 'TrendingUp',
      title: 'Price above EMA200 on all timeframes',
      message:
        'All 4 timeframes have price > EMA200 — strong uptrend regime. Buy-the-dip strategies are favored; avoid counter-trend shorts.',
      timeframes: ['1h', '4h', '1d', '1w'],
      confidence: 4,
    });
  }

  // 8) Price below EMA200 on all timeframes
  const belowAll = directions.filter((d) => d.priceVsEma200 === 'below');
  if (belowAll.length === 4) {
    push({
      id: 'ema200-below-all',
      type: 'warning',
      icon: 'TrendingDown',
      title: 'Price below EMA200 on all timeframes',
      message:
        'All 4 timeframes have price < EMA200 — strong downtrend regime. Sell-the-rip strategies favored; avoid catching falling knives.',
      timeframes: ['1h', '4h', '1d', '1w'],
      confidence: 4,
    });
  }

  // 9) MACD bullish across the board
  const macdBull = directions.filter((d) => d.macdHist > 0);
  if (macdBull.length === 4) {
    push({
      id: 'macd-bull-all',
      type: 'opportunity',
      icon: 'Activity',
      title: 'MACD bullish on all timeframes',
      message:
        'MACD histogram positive across all timeframes — momentum is unanimously bullish. Continuation likely while momentum stays aligned.',
      timeframes: ['1h', '4h', '1d', '1w'],
      confidence: 4,
    });
  }
  const macdBear = directions.filter((d) => d.macdHist < 0);
  if (macdBear.length === 4) {
    push({
      id: 'macd-bear-all',
      type: 'warning',
      icon: 'Activity',
      title: 'MACD bearish on all timeframes',
      message:
        'MACD histogram negative across all timeframes — momentum is unanimously bearish. Downside likely to continue.',
      timeframes: ['1h', '4h', '1d', '1w'],
      confidence: 4,
    });
  }

  // 10) Trend alignment (EMA stack) on the higher TFs
  const higherTrendBull = higherTfs.filter((d) => d.trend === 'bullish').length;
  const higherTrendBear = higherTfs.filter((d) => d.trend === 'bearish').length;
  if (higherTrendBull === 3) {
    push({
      id: 'higher-trend-bull',
      type: 'opportunity',
      icon: 'Layers',
      title: 'Higher-timeframe trend alignment (bullish)',
      message:
        '4H / 1D / 1W all show a bullish EMA20/50/200 stack — this is the regime to trade with. Use 1H pullbacks as entry opportunities.',
      timeframes: ['4h', '1d', '1w'],
      confidence: 4,
    });
  }
  if (higherTrendBear === 3) {
    push({
      id: 'higher-trend-bear',
      type: 'warning',
      icon: 'Layers',
      title: 'Higher-timeframe trend alignment (bearish)',
      message:
        '4H / 1D / 1W all show a bearish EMA20/50/200 stack — this is the regime to trade with. Use 1H rallies as short entry opportunities.',
      timeframes: ['4h', '1d', '1w'],
      confidence: 4,
    });
  }

  // 11) Mixed / neutral — no edge
  if (neutralCount >= 3 && out.length === 0) {
    push({
      id: 'no-edge',
      type: 'info',
      icon: 'CircleSlash',
      title: 'No clear multi-timeframe edge',
      message:
        'Most timeframes are neutral — wait for alignment to develop before committing capital. Confluence is what gives a setup an edge.',
      timeframes: ['1h', '4h', '1d', '1w'],
      confidence: 2,
    });
  }

  // If still empty, add a baseline info
  if (out.length === 0) {
    push({
      id: 'mixed-signals',
      type: 'info',
      icon: 'Info',
      title: 'Mixed multi-timeframe signals',
      message:
        'Timeframes show partial alignment. Trade smaller size or wait for clearer confluence before entering.',
      timeframes: ['1h', '4h', '1d', '1w'],
      confidence: 2,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Entry / exit suggestion
// ---------------------------------------------------------------------------
export function computeEntrySuggestion(
  timeframes: TimeframeAnalysis[],
  confluence: ConfluenceResult,
): EntrySuggestion | null {
  const byKey = new Map<TimeframeKey, TimeframeAnalysis>();
  for (const tf of timeframes) byKey.set(tf.interval, tf);

  const daily = byKey.get('1d');
  const weekly = byKey.get('1w');
  if (!daily || !weekly || daily.klines.length === 0 || weekly.klines.length === 0) return null;

  const lastPrice = daily.klines[daily.klines.length - 1].close;

  // Long setup: confluence > 50
  if (confluence.score >= 50) {
    // Stop = below nearest 1d support
    const supportLevels = [...(daily.indicators.support ?? [])].sort((a, b) => b - a); // highest first
    const stop =
      supportLevels.find((s) => s < lastPrice) ??
      (daily.indicators.support?.[0] ?? lastPrice * 0.95);
    // Target = nearest 1w resistance
    const resistanceLevels = [...(weekly.indicators.resistance ?? [])].sort((a, b) => a - b);
    const target =
      resistanceLevels.find((r) => r > lastPrice) ??
      (weekly.indicators.resistance?.[0] ?? lastPrice * 1.10);

    const risk = lastPrice - stop;
    const reward = target - lastPrice;
    const rr = risk > 0 ? reward / risk : 0;

    return {
      direction: 'long',
      entry: lastPrice,
      stop,
      target,
      rr,
      rationale: `Long bias — confluence ${confluence.score} (≥50). Stop placed below nearest 1D support, target at nearest 1W resistance.`,
      stopSource: '1d',
      targetSource: '1w',
    };
  }

  // Short setup: confluence < -50
  if (confluence.score <= -50) {
    // Stop = above nearest 1d resistance
    const resistanceLevels = [...(daily.indicators.resistance ?? [])].sort((a, b) => a - b);
    const stop =
      resistanceLevels.find((r) => r > lastPrice) ??
      (daily.indicators.resistance?.[0] ?? lastPrice * 1.05);
    // Target = nearest 1w support
    const supportLevels = [...(weekly.indicators.support ?? [])].sort((a, b) => b - a);
    const target =
      supportLevels.find((s) => s < lastPrice) ??
      (weekly.indicators.support?.[0] ?? lastPrice * 0.90);

    const risk = stop - lastPrice;
    const reward = lastPrice - target;
    const rr = risk > 0 ? reward / risk : 0;

    return {
      direction: 'short',
      entry: lastPrice,
      stop,
      target,
      rr,
      rationale: `Short bias — confluence ${confluence.score} (≤-50). Stop placed above nearest 1D resistance, target at nearest 1W support.`,
      stopSource: '1d',
      targetSource: '1w',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function defaultIndicators(): TechnicalIndicators {
  return {
    rsi: 50,
    macd: { macd: 0, signal: 0, histogram: 0 },
    ema20: 0,
    ema50: 0,
    ema200: 0,
    sma20: 0,
    bollinger: { upper: 0, middle: 0, lower: 0 },
    vwap: 0,
    atr: 0,
    support: [],
    resistance: [],
    trend: 'neutral',
    summary: { buy: 0, neutral: 0, sell: 0, score: 0 },
  };
}
