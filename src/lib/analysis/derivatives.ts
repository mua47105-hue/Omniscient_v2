// Pure-TS interpretation helpers for derivatives analytics.
// Zero React/DOM dependencies — safe to import from server routes + clients.

export type DerivativeSignal = 'bullish' | 'bearish' | 'neutral';

export interface FundingInterpretation {
  label: string;
  signal: DerivativeSignal;
  advice: string;
  /** Tailwind text color class, e.g. 'text-emerald-500' */
  color: string;
  /** Hex color for recharts/charts, e.g. '#10b981' */
  hex: string;
}

export interface LongShortInterpretation {
  label: string;
  signal: DerivativeSignal;
  advice: string;
  longPct: number; // 0..100
  shortPct: number; // 0..100
}

export interface TakerInterpretation {
  label: string;
  signal: DerivativeSignal;
  /** 'Buy' | 'Sell' | 'Balanced' */
  pressure: string;
  advice: string;
  buyPct: number; // 0..100
  sellPct: number; // 0..100
}

export interface FundingColor {
  /** rgba string for cell background */
  rgba: string;
  /** 0..1 alpha intensity based on |rate| magnitude */
  alpha: number;
  /** readable text color (white for dark backgrounds, zinc-200 for light) */
  text: string;
}

// Color palette (NO indigo / NO blue)
const C = {
  emerald: { r: 16, g: 185, b: 129 },
  teal: { r: 20, g: 184, b: 166 },
  zinc: { r: 63, g: 63, b: 70 },
  rose: { r: 244, g: 63, b: 94 },
  orange: { r: 249, g: 115, b: 22 },
  amber: { r: 245, g: 158, b: 11 },
};

function rgba(c: { r: number; g: number; b: number }, alpha: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

/**
 * Interpret a funding rate (decimal — e.g. 0.0001 = 0.01%).
 * Positive funding = longs pay shorts → overcrowded longs (bearish caution).
 * Negative funding = shorts pay longs → overcrowded shorts (bullish signal).
 * Binance typical range ±0.05% (±0.0005); extremes ±0.1% (±0.001) or higher.
 */
export function interpretFundingRate(rate: number): FundingInterpretation {
  const pct = rate * 100; // 0.0001 → 0.01%

  if (rate >= 0.00075) {
    return {
      label: 'Extremely Positive',
      signal: 'bearish',
      advice:
        'Funding is extremely positive — longs are paying shorts heavily. Long positioning is overcrowded and a long squeeze / pullback is likely. Caution on further upside.',
      color: 'text-rose-500',
      hex: '#f43f5e',
    };
  }
  if (rate >= 0.0003) {
    return {
      label: 'Positive',
      signal: 'bearish',
      advice:
        'Positive funding — longs are paying shorts. Overcrowded long positioning suggests caution for further upside; consider trimming exposure.',
      color: 'text-rose-400',
      hex: '#fb7185',
    };
  }
  if (rate > -0.00005) {
    return {
      label: 'Neutral',
      signal: 'neutral',
      advice:
        'Funding is roughly neutral — neither side is paying the other meaningfully. Positioning is balanced; fund your view from other signals.',
      color: 'text-zinc-400',
      hex: '#a1a1aa',
    };
  }
  if (rate > -0.0003) {
    return {
      label: 'Negative',
      signal: 'bullish',
      advice:
        'Negative funding — shorts are paying longs. Short positioning is building; contrarian bullish bias as crowded shorts may squeeze.',
      color: 'text-emerald-400',
      hex: '#34d399',
    };
  }
  return {
    label: 'Extremely Negative',
    signal: 'bullish',
    advice:
      'Funding is extremely negative — shorts are paying longs heavily. Short positioning is overcrowded and a short squeeze is likely. Contrarian bullish.',
    color: 'text-emerald-500',
    hex: '#10b981',
  };
}

/**
 * Color for a heatmap cell. Scale: deep emerald (very negative) → zinc (neutral) → deep rose (very positive).
 * Alpha scales with |rate| magnitude so small rates fade into the background.
 */
export function fundingRateColor(rate: number): FundingColor {
  const abs = Math.abs(rate);
  // Map |rate| to alpha — typical ±0.0005 → 0.5 alpha, extremes ±0.0015 → 0.9
  const alpha = Math.min(0.92, 0.18 + abs * 1400);
  // Pick color based on sign + magnitude
  let base: { r: number; g: number; b: number };
  if (rate > 0.0001) {
    // Bullish overcrowding → rose; scale toward deeper rose at higher magnitudes
    base = rate > 0.0005 ? C.rose : C.rose;
  } else if (rate < -0.0001) {
    // Bearish overcrowding → emerald (bullish contrarian)
    base = rate < -0.0005 ? C.emerald : C.emerald;
  } else {
    base = C.zinc;
  }
  // White text for stronger backgrounds, lighter text for neutral
  const text = alpha > 0.45 ? 'text-white' : 'text-zinc-200 dark:text-zinc-200';
  return { rgba: rgba(base, alpha), alpha, text };
}

/**
 * Interpret top trader long/short ratio.
 * ratio > 1 = more longs, ratio < 1 = more shorts.
 */
export function interpretLongShortRatio(ratio: number): LongShortInterpretation {
  // longAccount + shortAccount = 1 (Binance returns both)
  // derive from ratio: long = ratio/(1+ratio), short = 1/(1+ratio)
  const longPct = (ratio / (1 + ratio)) * 100;
  const shortPct = (1 / (1 + ratio)) * 100;

  if (ratio >= 1.5) {
    return {
      label: 'Heavily Long',
      signal: 'bearish',
      advice: `Top traders are heavily net LONG (${ratio.toFixed(2)}). Smart money is crowded long — risk of a long squeeze if support breaks. Tighten stops.`,
      longPct,
      shortPct,
    };
  }
  if (ratio >= 1.1) {
    return {
      label: 'Net Long',
      signal: 'bullish',
      advice: `Top traders are net LONG (${ratio.toFixed(2)}) — smart money is bullish. Follow the trend but watch for over-extension.`,
      longPct,
      shortPct,
    };
  }
  if (ratio > 0.9) {
    return {
      label: 'Balanced',
      signal: 'neutral',
      advice: `Top trader positioning is roughly balanced (${ratio.toFixed(2)}). No strong directional bias from smart money.`,
      longPct,
      shortPct,
    };
  }
  if (ratio > 0.67) {
    return {
      label: 'Net Short',
      signal: 'bearish',
      advice: `Top traders are net SHORT (${ratio.toFixed(2)}) — smart money is bearish. Consider reducing long exposure.`,
      longPct,
      shortPct,
    };
  }
  return {
    label: 'Heavily Short',
    signal: 'bullish',
    advice: `Top traders are heavily net SHORT (${ratio.toFixed(2)}). Smart money is crowded short — contrarian bullish bias as shorts may squeeze.`,
    longPct,
    shortPct,
  };
}

/**
 * Interpret taker buy vs sell volume.
 * Buy > Sell = bullish pressure (takers lifting the ask).
 */
export function interpretTakerVolume(buyVol: number, sellVol: number): TakerInterpretation {
  const total = buyVol + sellVol;
  const buyPct = total > 0 ? (buyVol / total) * 100 : 50;
  const sellPct = total > 0 ? (sellVol / total) * 100 : 50;
  const diff = buyVol - sellVol;
  const ratio = total > 0 ? diff / total : 0; // -1..1

  if (ratio > 0.15) {
    return {
      label: 'Strong Buy Dominance',
      signal: 'bullish',
      pressure: 'Buy',
      advice: `Taker buy volume dominates (${buyPct.toFixed(1)}% buy). Aggressive market-buying suggests strong bullish pressure.`,
      buyPct,
      sellPct,
    };
  }
  if (ratio > 0.04) {
    return {
      label: 'Buy Dominance',
      signal: 'bullish',
      pressure: 'Buy',
      advice: `Takers are net buyers (${buyPct.toFixed(1)}% buy). Mild bullish pressure from aggressive buyers.`,
      buyPct,
      sellPct,
    };
  }
  if (ratio > -0.04) {
    return {
      label: 'Balanced',
      signal: 'neutral',
      pressure: 'Balanced',
      advice: `Taker buy/sell volume is roughly balanced. No aggressive directional pressure.`,
      buyPct,
      sellPct,
    };
  }
  if (ratio > -0.15) {
    return {
      label: 'Sell Dominance',
      signal: 'bearish',
      pressure: 'Sell',
      advice: `Takers are net sellers (${sellPct.toFixed(1)}% sell). Mild bearish pressure from aggressive sellers.`,
      buyPct,
      sellPct,
    };
  }
  return {
    label: 'Strong Sell Dominance',
    signal: 'bearish',
    pressure: 'Sell',
    advice: `Taker sell volume dominates (${sellPct.toFixed(1)}% sell). Aggressive market-selling suggests strong bearish pressure.`,
    buyPct,
    sellPct,
  };
}

/**
 * Combined signal from funding + L/S + taker for a single asset.
 * Returns -100..100 score (negative = bearish, positive = bullish).
 */
export function combinedDerivativesScore(opts: {
  fundingRate: number;
  longShortRatio?: number;
  buyVol?: number;
  sellVol?: number;
}): number {
  let score = 0;
  // Funding: contrarian. Positive funding → bearish bias (subtract).
  // Map ±0.001 → ∓30
  score += -Math.max(-1, Math.min(1, opts.fundingRate / 0.001)) * 30;

  if (typeof opts.longShortRatio === 'number' && opts.longShortRatio > 0) {
    // L/S ratio: smart money direction. >1 bullish, <1 bearish.
    // Map 0.5..2 → -35..+35 (log scale)
    const r = Math.log(opts.longShortRatio) / Math.log(2); // -1..1 around ratio=1
    score += Math.max(-1, Math.min(1, r)) * 35;
  }

  if (typeof opts.buyVol === 'number' && typeof opts.sellVol === 'number') {
    const total = opts.buyVol + opts.sellVol;
    if (total > 0) {
      const r = (opts.buyVol - opts.sellVol) / total; // -1..1
      score += r * 35;
    }
  }

  return Math.max(-100, Math.min(100, score));
}

// --- Formatting helpers (shared with client) ---

export function fmtFundingPct(rate: number, digits = 4): string {
  const pct = rate * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(digits)}%`;
}

export function fmtUsd(v: number, digits = 2): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(digits)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(digits)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function fmtCompact(v: number, digits = 2): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(digits)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(digits)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

/**
 * Format a countdown to next funding time (epoch ms).
 * Returns { hours, minutes, seconds, label, urgency }
 */
export function fundingCountdown(nextFunding: number, now = Date.now()): {
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
  label: string;
  urgency: 'far' | 'near' | 'imminent';
} {
  const totalMs = Math.max(0, nextFunding - now);
  const totalSec = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const label = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  let urgency: 'far' | 'near' | 'imminent' = 'far';
  if (hours < 1) urgency = 'imminent';
  else if (hours < 4) urgency = 'near';
  return { hours, minutes, seconds, totalMs, label, urgency };
}
