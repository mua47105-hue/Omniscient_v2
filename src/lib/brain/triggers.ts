/**
 * Lazy Brain — cross-asset triggers.
 *
 * When BTC or ETH turns volatile (or posts a high noteworthiness score), the
 * correlated altcoin complex typically follows within minutes. This module
 * force-runs those followers so the brain doesn't wait for the next scheduled
 * cadence tick to re-evaluate them.
 *
 * Storm-guard: skip followers that were analyzed <2min ago. Without this, a
 * volatile BTC could re-queue the entire alt book on every tick and burn the
 * token budget.
 */

import { allWatch, forceRun, recordTrigger, getConfig } from './state';

const STORM_GUARD_MS = 2 * 60 * 1000; // 2 minutes

// BTC / ETH are the leaders; everything else is a follower.
const LEADERS = ['BTCUSDT', 'ETHUSDT'];

// Correlated alt book — the symbols most likely to move when BTC/ETH move.
// Symbols are Binance-style spot pairs.
const FOLLOWERS: Record<string, string[]> = {
  BTCUSDT: [
    'ETHUSDT',
    'SOLUSDT',
    'BNBUSDT',
    'XRPUSDT',
    'ADAUSDT',
    'DOGEUSDT',
    'AVAXUSDT',
    'LINKUSDT',
    'MATICUSDT',
    'LTCUSDT',
  ],
  ETHUSDT: [
    'SOLUSDT',
    'AVAXUSDT',
    'MATICUSDT',
    'LINKUSDT',
    'ARBUSDT',
    'OPUSDT',
    'UNIUSDT',
    'AAVEUSDT',
    'MKRUSDT',
    'LDOUSDT',
  ],
};

export interface CrossAssetTriggerResult {
  triggered: boolean;
  leaders: Array<{ symbol: string; reason: string }>;
  queued: Array<{ symbol: string; leader: string }>;
  skippedByStormGuard: string[];
}

/**
 * Inspect BTC/ETH watch entries. If either is volatile or has a
 * noteworthiness ≥ `highNoteworthiness` threshold, queue its follower set via
 * `forceRun(symbol, 'cross-asset')`. Storm-guard skips followers analyzed
 * within the last 2 minutes.
 */
export function checkCrossAssetTriggers(): CrossAssetTriggerResult {
  const cfg = getConfig();
  const watches = new Map(allWatch().map((w) => [w.symbol, w]));
  const now = Date.now();

  const leaders: CrossAssetTriggerResult['leaders'] = [];
  const queued: CrossAssetTriggerResult['queued'] = [];
  const skippedByStormGuard: string[] = [];
  const queuedSet = new Set<string>();

  for (const leader of LEADERS) {
    const w = watches.get(leader);
    if (!w) continue;

    const isVolatile = w.regime === 'volatile';
    const isHighNote = w.lastNoteworthiness >= cfg.highNoteworthiness;
    if (!isVolatile && !isHighNote) continue;

    const reason = isVolatile
      ? `volatile:${leader}(nw=${w.lastNoteworthiness})`
      : `high-nw:${leader}(${w.lastNoteworthiness})`;
    leaders.push({ symbol: leader, reason });

    const followers = FOLLOWERS[leader] ?? [];
    for (const f of followers) {
      if (f === leader) continue;
      if (queuedSet.has(f)) continue;

      // Storm-guard: skip followers analyzed <2min ago.
      const fw = watches.get(f);
      const lastAnalyzed = fw?.lastAnalyzedAt ?? 0;
      if (lastAnalyzed > 0 && now - lastAnalyzed < STORM_GUARD_MS) {
        skippedByStormGuard.push(f);
        continue;
      }

      forceRun(f, 'cross-asset');
      queuedSet.add(f);
      queued.push({ symbol: f, leader });
    }
  }

  if (queued.length > 0) {
    recordTrigger('cross-asset');
  }

  return {
    triggered: queued.length > 0,
    leaders,
    queued,
    skippedByStormGuard,
  };
}
