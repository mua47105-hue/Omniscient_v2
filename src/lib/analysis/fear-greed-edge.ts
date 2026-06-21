/**
 * E8 — Asymmetric Fear & Greed edge.
 *
 * The classic use of the CNN/alternative.me Fear & Greed index is symmetric:
 * extreme fear → buy, extreme greed → sell (mean reversion in both tails).
 * Empirically (Milk Road backtest, ScienceDirect 2023 behavioral-finance
 * study), the edge is **asymmetric**:
 *
 *   - Extreme **greed** that persists for ≥14 days tends to KEEP climbing
 *     (momentum, not mean reversion). Late buyers capitulate into the rally.
 *   - Extreme **fear** is the opposite: 5+ days of extreme fear is a reliable
 *     mean-reversion buy (markets over-react to the downside).
 *
 * Reuses the existing `getFearGreed()` from `@/lib/market/macro` so we share
 * the upstream cache. We ask for 180 days of history so the streak detector
 * has enough data.
 *
 * Surfaced in the `EdgeSourcesCard` on /brain alongside E4 derivatives regime.
 */

import { getFearGreed } from '@/lib/market/macro';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXTREME_GREED = 75;
const EXTREME_FEAR = 25;
const GREED_STREAK_MOMENTUM = 14; // 14 days of extreme greed → momentum-long
const FEAR_STREAK_MEANREVERT = 5; // 5 days of extreme fear → mean-revert-long
const FEAR_STREAK_STRONG = 14; // 14 days → stronger conviction

const HISTORY_LIMIT = 180;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FearGreedEdge =
  | 'MOMENTUM_LONG'
  | 'MEAN_REVERT_LONG'
  | 'MEAN_REVERT_SHORT'
  | 'NONE';

export type FearGreedRegime =
  | 'extreme-fear'
  | 'fear'
  | 'neutral'
  | 'greed'
  | 'extreme-greed';

export interface FearGreedSignal {
  currentValue: number;
  streakDays: number;
  streakZone: 'extreme-fear' | 'extreme-greed' | 'none';
  regime: FearGreedRegime;
  edge: FearGreedEdge;
  conviction: number; // 0..100
  rationale: string;
  historyLen: number;
  /** ISO ts of the latest sample. */
  asOf?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function regimeFromValue(v: number): FearGreedRegime {
  if (v <= EXTREME_FEAR) return 'extreme-fear';
  if (v < 45) return 'fear';
  if (v <= 55) return 'neutral';
  if (v < EXTREME_GREED) return 'greed';
  return 'extreme-greed';
}

/**
 * Count consecutive trailing days the series has spent in the same extreme
 * zone (≤25 or ≥75). Returns {days, zone}.
 */
function computeStreak(values: number[]): {
  days: number;
  zone: 'extreme-fear' | 'extreme-greed' | 'none';
} {
  if (values.length === 0) return { days: 0, zone: 'none' };
  const latest = values[0];
  if (latest >= EXTREME_GREED) {
    let days = 1;
    for (let i = 1; i < values.length; i++) {
      if (values[i] >= EXTREME_GREED) days++;
      else break;
    }
    return { days, zone: 'extreme-greed' };
  }
  if (latest <= EXTREME_FEAR) {
    let days = 1;
    for (let i = 1; i < values.length; i++) {
      if (values[i] <= EXTREME_FEAR) days++;
      else break;
    }
    return { days, zone: 'extreme-fear' };
  }
  return { days: 0, zone: 'none' };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Compute the asymmetric Fear & Greed signal. Caches implicitly via
 * `getFearGreed()` upstream.
 */
export async function computeFearGreedSignal(): Promise<FearGreedSignal> {
  // Best-effort fetch; degrade gracefully on failure.
  let raw: unknown = null;
  try {
    raw = await getFearGreed(HISTORY_LIMIT);
  } catch {
    raw = null;
  }

  // Normalise to a most-recent-first array of numeric values.
  const values = extractValues(raw);

  if (values.length === 0) {
    return {
      currentValue: 50,
      streakDays: 0,
      streakZone: 'none',
      regime: 'neutral',
      edge: 'NONE',
      conviction: 0,
      rationale: 'F&G unavailable',
      historyLen: 0,
    };
  }

  const current = values[0];
  const regime = regimeFromValue(current);
  const { days: streakDays, zone: streakZone } = computeStreak(values);

  // Asymmetric edge logic.
  let edge: FearGreedEdge = 'NONE';
  let conviction = 0;
  let rationale = `F&G=${current} (${regime}), streak=${streakDays}d in ${streakZone}`;

  if (streakZone === 'extreme-greed' && streakDays >= GREED_STREAK_MOMENTUM) {
    edge = 'MOMENTUM_LONG';
    conviction = Math.min(80, 55 + streakDays); // 14d→69, 25d→80
    rationale = `Extreme greed (${current}) persisted ${streakDays}d → momentum-long (late buyers capitulating)`;
  } else if (streakZone === 'extreme-fear' && streakDays >= FEAR_STREAK_STRONG) {
    edge = 'MEAN_REVERT_LONG';
    conviction = Math.min(80, 60 + (streakDays - FEAR_STREAK_STRONG) * 2);
    rationale = `Extreme fear (${current}) persisted ${streakDays}d → mean-revert-long (deep capitulation)`;
  } else if (streakZone === 'extreme-fear' && streakDays >= FEAR_STREAK_MEANREVERT) {
    edge = 'MEAN_REVERT_LONG';
    conviction = 55 + (streakDays - FEAR_STREAK_MEANREVERT) * 3;
    rationale = `Extreme fear (${current}) persisted ${streakDays}d → mean-revert-long (oversold bounce)`;
  }

  // Optional: contrarian short on extreme greed without momentum confirmation.
  if (streakZone === 'extreme-greed' && streakDays < GREED_STREAK_MOMENTUM && streakDays >= 3) {
    // Surface as a softer MEAN_REVERT_SHORT signal — callers can opt in.
    edge = 'MEAN_REVERT_SHORT';
    conviction = 40 + streakDays;
    rationale = `Extreme greed (${current}) ${streakDays}d (<${GREED_STREAK_MOMENTUM}d threshold) → mean-revert-short (cautious)`;
  }

  return {
    currentValue: current,
    streakDays,
    streakZone,
    regime,
    edge,
    conviction,
    rationale,
    historyLen: values.length,
    asOf: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Robust extraction — handle either the raw alternative.me payload or the
// normalised shape returned by `getFearGreed()`.
// ---------------------------------------------------------------------------

function extractValues(raw: unknown): number[] {
  if (!raw) return [];

  // Case 1: array of {value} objects (already normalised by macro.ts).
  if (Array.isArray(raw)) {
    return raw
      .map((entry: any) => parseValue(entry?.value))
      .filter((v: number) => Number.isFinite(v));
  }

  // Case 2: alternative.me raw shape — { data: [{value: "47", ...}, ...] }
  const data = (raw as any)?.data;
  if (Array.isArray(data)) {
    return data
      .map((entry: any) => parseValue(entry?.value))
      .filter((v: number) => Number.isFinite(v));
  }

  // Case 3: single latest object — { value: 47 }
  const single = parseValue((raw as any)?.value);
  if (Number.isFinite(single)) return [single];

  return [];
}

function parseValue(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}
