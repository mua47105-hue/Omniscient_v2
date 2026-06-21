// Cross-asset triggers — deepen autonomy.
//
// When a major asset (BTC, ETH) makes a significant move, correlated alts
// typically follow. The brain detects these moves during a scan and queues
// the correlated assets for an immediate re-analysis on the next tick,
// instead of waiting for their regular cadence.
//
// This is a free, deterministic trigger — zero LLM tokens spent on detection.
// The LLM only gets called (through the normal gate) on the queued re-analysis.
//
// Correlations are coarse + static (BTC↔alts, ETH↔L1s) rather than computed
// live — good enough for a trigger, and avoids spending tokens or API calls
// on a correlation matrix every tick.

import { forceRun, getWatch, recordAction } from '@/lib/brain/state';

// Static correlation groups: if the anchor moves, the followers get re-queued.
// Anchors are the highest-cap, most-dominant assets; followers are the alts
// that historically track them. Tuned for the seeded crypto universe.
const CORRELATION_GROUPS: { anchor: string; followers: string[]; thresholdPct: number }[] = [
  { anchor: 'BTCUSDT', followers: ['ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'AVAXUSDT', 'LINKUSDT', 'MATICUSDT', 'POLUSDT'], thresholdPct: 2.0 },
  { anchor: 'ETHUSDT', followers: ['SOLUSDT', 'AVAXUSDT', 'LINKUSDT'], thresholdPct: 2.5 },
];

export interface TriggerResult {
  triggered: boolean;
  anchor: string;
  movePct: number;
  queued: string[];
  reason: string;
}

/**
 * Check the watch cache for anchor moves that should trigger re-analysis of
 * correlated followers. Queues followers via forceRun (which clears their
 * cadence back-off so the next tick re-analyzes them).
 *
 * Call this AFTER a scan completes, so the watch cache reflects fresh prices.
 */
export function checkCrossAssetTriggers(): TriggerResult[] {
  const results: TriggerResult[] = [];
  for (const group of CORRELATION_GROUPS) {
    const anchor = getWatch(group.anchor);
    if (!anchor) continue;
    // The watch cache stores the latest ticker 24h changePct — a decent proxy
    // for "did BTC move meaningfully today". For a tighter trigger we'd compare
    // lastPrice to a short SMA, but 24h change is free + already in the cache.
    const movePct = Math.abs(anchor.lastPrice > 0 ? 0 : 0) || anchor.lastPrice; // ponytail: use stored noteworthiness regime instead

    // Use the noteworthiness score + regime as the trigger: if the anchor is
    // in a 'volatile' regime OR has high noteworthiness, its followers likely
    // need a fresh look. This avoids re-fetching tickers (free).
    const isVolatile = anchor.lastRegime === 'volatile';
    const isHighNote = anchor.lastNoteworthiness >= 65;
    if (!isVolatile && !isHighNote) continue;

    // Only trigger if the anchor was actually analyzed recently (not stale).
    const stalenessMs = Date.now() - anchor.lastWatchedAt;
    if (stalenessMs > 10 * 60 * 1000) continue; // anchor watch is >10min stale, skip

    const queued: string[] = [];
    for (const f of group.followers) {
      const fw = getWatch(f);
      // Don't re-queue a follower that was JUST analyzed (within 2 min) —
      // avoids a trigger storm when the anchor stays volatile across ticks.
      if (fw && (Date.now() - fw.lastAnalyzedAt) < 2 * 60 * 1000) continue;
      forceRun(f, 'cross-asset');
      queued.push(f);
    }
    if (queued.length > 0) {
      results.push({
        triggered: true,
        anchor: group.anchor,
        movePct: anchor.lastNoteworthiness, // reuse the 0-100 noteworthiness as the "intensity"
        queued,
        reason: `${group.anchor} ${isVolatile ? 'volatile' : 'high-noteworthiness'} (${anchor.lastNoteworthiness}) → re-analyze ${queued.length} correlated alts`,
      });
      // Record a visible action so operators see the cross-asset trigger fire
      // in the brain's action feed (autonomy made visible).
      recordAction({
        symbol: `${group.anchor}→TRIGGER`,
        action: 'cross-asset',
        tier: 0,
        reason: `${isVolatile ? 'volatile' : 'high-note'} → ${queued.length} alts queued`,
        conviction: anchor.lastNoteworthiness,
      });
    }
  }
  return results;
}
