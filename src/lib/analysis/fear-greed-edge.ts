// E8 — Asymmetric Fear & Greed Regime Filter
//
// Source: "OMNISCIENT — Field Guide to Real Edge (Vol. 2)", Suggestion E8.
// Evidence: ScienceDirect 2024 (Finance Research Letters) — U-shaped relationship
// between F&G and crypto price. Milk Road: 14d extreme greed streaks → 200% avg
// 90d forward return (MOMENTUM continuation, NOT mean reversion). 14d extreme
// fear streaks → only 9% avg 90d forward return (weak bounce).
//
// This is the OPPOSITE of equities — in crypto bull markets, extreme greed is a
// momentum-continuation signal, NOT a sell signal.
//
// Asymmetric edge:
//   Extreme Greed (>80) + 14d streak → MOMENTUM_LONG (not mean-revert)
//   Extreme Fear (<15) + 5d streak    → MEAN_REVERT_LONG (capitulation buy)
//   Extreme Fear (<20) + 14d streak   → MEAN_REVERT_LONG (prolonged fear)
//
// Counter-argument: F&G is 60% just transformed price data (vol + momentum
// components) — partially circular. Milk Road's stat is from one bull cycle.
// Mitigation: use as a CONFIRMATION signal with streak ≥ 3 (filters noise),
// not as primary. Pair with the macro-v2 regime filter.
//
// ponytail: reuses the existing getFearGreed() from macro.ts (already fetches
// history). Just computes streaks + asymmetric edge. Zero new API calls.

import { getFearGreed } from '@/lib/market/macro';

export interface FearGreedSignal {
  currentValue: number;
  streakDays: number;
  regime: 'EXTREME_FEAR' | 'FEAR' | 'NEUTRAL' | 'GREED' | 'EXTREME_GREED';
  edge: 'MOMENTUM_LONG' | 'MEAN_REVERT_LONG' | 'MEAN_REVERT_SHORT' | 'NEUTRAL';
  conviction: number; // 0-100
  rationale: string;
}

/**
 * Compute the asymmetric Fear & Greed signal from the alternative.me history.
 * Free, no key. Returns NEUTRAL if the history is too short for a streak.
 */
export async function computeFearGreedSignal(): Promise<FearGreedSignal> {
  // Fetch 180 days of history (alternative.me supports ?limit=N).
  const fg = await getFearGreed(180);
  const history = fg.history.map((h) => h.value);
  const current = fg.value;

  const regime: FearGreedSignal['regime'] =
    current < 20 ? 'EXTREME_FEAR' :
    current < 40 ? 'FEAR' :
    current < 60 ? 'NEUTRAL' :
    current < 80 ? 'GREED' : 'EXTREME_GREED';

  // Count consecutive days in the same extreme zone (backward from latest).
  let streak = 0;
  const inExtremeFear = current < 20;
  const inExtremeGreed = current > 80;
  for (let i = history.length - 1; i >= 0; i--) {
    const v = history[i];
    if (inExtremeFear && v < 20) streak++;
    else if (inExtremeGreed && v > 80) streak++;
    else break;
  }

  // ASYMMETRIC EDGE (from Milk Road data + ScienceDirect U-shape).
  let edge: FearGreedSignal['edge'] = 'NEUTRAL';
  let conviction = 0;
  let rationale = `${regime} (${current}), streak ${streak}d`;

  if (current > 80 && streak >= 14) {
    edge = 'MOMENTUM_LONG';
    conviction = 80;
    rationale = `extreme greed + 14d streak → momentum continuation (Milk Road: 200% avg 90d fwd)`;
  } else if (current > 80 && streak >= 3) {
    edge = 'MOMENTUM_LONG';
    conviction = Math.min(70, 40 + streak * 3);
    rationale = `extreme greed + ${streak}d streak → momentum long`;
  } else if (current < 15 && streak >= 5) {
    edge = 'MEAN_REVERT_LONG';
    conviction = 60;
    rationale = `extreme fear + ${streak}d streak → capitulation buy`;
  } else if (current < 20 && streak >= 14) {
    edge = 'MEAN_REVERT_LONG';
    conviction = 70;
    rationale = `prolonged extreme fear + 14d streak → mean-revert long`;
  }

  return { currentValue: current, streakDays: streak, regime, edge, conviction, rationale };
}
