/**
 * blockchain.info on-chain data client.
 *
 * Pulls the free `/q/` plain-text endpoints:
 *
 *   - /q/24hrtransactioncount  → BTC transactions in the last 24h
 *   - /q/hashrate              → current network hashrate (EH/s estimate)
 *   - /q/getdifficulty         → current difficulty
 *
 * Maintains a 24-sample ring buffer of hashrate observations (one per fetch,
 * so ~24 ticks at a 15-min cache = 6 hours of history) and exposes
 * `getOnchainTrend()` to compute the rising/falling/flat direction. The
 * consensus layer (analysis/consensus.ts) consumes that trend as the
 * "onchain-trend" layer.
 *
 * Cache: 15 minutes. The hashrate ring buffer survives cache evictions
 * (lives on globalThis), so even when the cached snapshot expires the
 * trend detector keeps its history.
 */

import https from 'node:https';

const BASE = 'https://blockchain.info';
const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6_000;
const MAX_HISTORY = 24;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OnChainStats {
  transactionCount24h: number;
  hashrate: number; // EH/s (blockchain.info reports TH/s — divided by 1e6)
  difficulty: number;
  asOf: number;
}

export type OnchainDirection = 'rising' | 'falling' | 'flat';

export interface OnchainTrend {
  direction: OnchainDirection;
  pctChange: number;
  sampleCount: number;
  current: number | null;
  oldest: number | null;
}

// ---------------------------------------------------------------------------
// Global state (ring buffer + cache)
// ---------------------------------------------------------------------------

interface OnchainGlobal {
  __OMNISCIENT_ONCHAIN_CACHE__?: { at: number; value: OnChainStats };
  __OMNISCIENT_ONCHAIN_HISTORY__?: number[]; // hashrate ring buffer (newest last)
}

function g(): OnchainGlobal {
  return globalThis as unknown as OnchainGlobal;
}

function history(): number[] {
  if (!Array.isArray(g().__OMNISCIENT_ONCHAIN_HISTORY__)) {
    g().__OMNISCIENT_ONCHAIN_HISTORY__ = [];
  }
  return g().__OMNISCIENT_ONCHAIN_HISTORY__!;
}

function pushHistory(value: number): void {
  const h = history();
  h.push(value);
  while (h.length > MAX_HISTORY) h.shift();
}

// ---------------------------------------------------------------------------
// HTTP (plain-text endpoint)
// ---------------------------------------------------------------------------

function httpsGetText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'OMNISCIENT/1.0 (+onchain-client)', Accept: 'text/plain,*/*' },
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpsGetText(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchNumber(path: string): Promise<number> {
  const text = await httpsGetText(`${BASE}${path}`);
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the three blockchain.info stats. 15-min cache. Each successful fetch
 * appends the current hashrate to the ring buffer.
 */
export async function getOnChainStats(): Promise<OnChainStats> {
  const cached = g().__OMNISCIENT_ONCHAIN_CACHE__;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  // Fetch the three endpoints in parallel; degrade gracefully on partial failure.
  const [tx24, hashrate, difficulty] = await Promise.all([
    fetchNumber('/q/24hrtransactioncount').catch(() => 0),
    fetchNumber('/q/hashrate').catch(() => 0),
    fetchNumber('/q/getdifficulty').catch(() => 0),
  ]);

  // blockchain.info reports hashrate in TH/s. Convert to EH/s for readability.
  const hashrateEH = hashrate / 1e6;

  const stats: OnChainStats = {
    transactionCount24h: tx24,
    hashrate: hashrateEH,
    difficulty,
    asOf: Date.now(),
  };

  if (hashrateEH > 0) pushHistory(hashrateEH);

  g().__OMNISCIENT_ONCHAIN_CACHE__ = { at: Date.now(), value: stats };
  return stats;
}

/**
 * Compute the BTC hashrate trend from the ring buffer.
 *
 *   direction = 'rising' | 'falling' | 'flat'
 *
 * Direction requires ≥3 samples (below that, returning a flat trend would
 * mislead callers — better to flag insufficient data via `sampleCount`).
 * The threshold for "rising"/"falling" is ±2% (avoids noise).
 */
export function getOnchainTrend(): OnchainTrend {
  const h = history();
  if (h.length < 3) {
    return {
      direction: 'flat',
      pctChange: 0,
      sampleCount: h.length,
      current: h.length > 0 ? h[h.length - 1] : null,
      oldest: h.length > 0 ? h[0] : null,
    };
  }

  const oldest = h[0];
  const current = h[h.length - 1];
  const pctChange = oldest > 0 ? ((current - oldest) / oldest) * 100 : 0;

  let direction: OnchainDirection = 'flat';
  if (pctChange > 2) direction = 'rising';
  else if (pctChange < -2) direction = 'falling';

  return { direction, pctChange, sampleCount: h.length, current, oldest };
}

/**
 * Direct accessor for the ring buffer (used by tests + the consensus layer's
 * onchain-trend layer to log samples).
 */
export function getHashrateHistory(): number[] {
  return history().slice();
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function __clearOnChainCacheForTests(): void {
  g().__OMNISCIENT_ONCHAIN_CACHE__ = undefined;
  g().__OMNISCIENT_ONCHAIN_HISTORY__ = [];
}
