// On-chain BTC data — free, no key, from blockchain.info /q endpoints.
//
// Adds a genuine on-chain layer to the free stack: transaction count, hashrate,
// difficulty. These are slow-moving fundamentals that contextualize the
// technical/sentiment layers — e.g. rising hashrate = miner confidence,
// spiking tx count = network demand. Zero tokens, zero API key.
//
// Cached 15 min — on-chain fundamentals don't move fast enough to warrant
// more frequent fetches, and this respects blockchain.info's free rate limit.

import https from 'node:https';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function get(url: string, timeoutMs = 10000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'text/plain,application/json' }, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

const cache = new Map<string, { data: any; ts: number }>();
const TTL = 15 * 60 * 1000;
function cached<T>(key: string): T | null {
  const c = cache.get(key);
  return c && Date.now() - c.ts < TTL ? (c.data as T) : null;
}
function store(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

export interface OnChainStats {
  txCount24h: number;        // BTC transactions in the last 24h
  hashRate: number;          // TH/s (network hashrate)
  difficulty: number;        // mining difficulty
  avgTxValue24h?: number;    // optional: average transaction value (satoshis)
  fetchedAt: number;
}

/**
 * Fetch BTC on-chain fundamentals. Each /q endpoint returns a plain number,
 * so we fire them in parallel. Returns what it can — partial data is more
 * useful than none, and each field degrades independently.
 */
export async function getOnChainStats(): Promise<OnChainStats> {
  const cachedStats = cached<OnChainStats>('onchain');
  if (cachedStats) return cachedStats;

  const [txRes, hrRes, diffRes] = await Promise.allSettled([
    get('https://blockchain.info/q/24hrtransactioncount'),
    get('https://blockchain.info/q/hashrate'),
    get('https://blockchain.info/q/getdifficulty'),
  ]);

  const txCount24h = txRes.status === 'fulfilled' && txRes.value.status === 200 ? parseFloat(txRes.value.text) || 0 : 0;
  const hashRate = hrRes.status === 'fulfilled' && hrRes.value.status === 200 ? parseFloat(hrRes.value.text) || 0 : 0;
  const difficulty = diffRes.status === 'fulfilled' && diffRes.value.status === 200 ? parseFloat(diffRes.value.text) || 0 : 0;

  if (txCount24h === 0 && hashRate === 0 && difficulty === 0) {
    throw new Error('All blockchain.info endpoints failed');
  }

  const out: OnChainStats = { txCount24h, hashRate, difficulty, fetchedAt: Date.now() };
  store('onchain', out);
  // Accumulate the hashrate sample for trend detection (used by the consensus
  // fundamental layer). Capped ring buffer — keeps the last 24 samples.
  if (hashRate > 0) {
    hashrateHistory.push({ ts: Date.now(), hashRate });
    if (hashrateHistory.length > 24) hashrateHistory.shift();
  }
  return out;
}

// --- Hashrate trend tracker ---
// Accumulates hashrate samples over time so the consensus fundamental layer
// can detect "miner confidence rising/falling". Each getOnChainStats() call
// (15-min cache) appends a sample; after a few samples the trend is meaningful.
interface HashrateSample { ts: number; hashRate: number }
const hashrateHistory: HashrateSample[] = [];

export interface OnchainTrend {
  direction: 'rising' | 'falling' | 'flat';
  pctChange: number; // % change oldest→newest in the window
  sampleCount: number;
  current: number;
}

/**
 * Compute the hashrate trend over the accumulated samples. Returns 'flat' until
 * there are enough samples (≥3) to call a direction. The pctChange is the
 * oldest-vs-newest delta in the window — a genuine fundamental signal: rising
 * hashrate = miners committing capital = bullish on the network's future.
 */
export function getOnchainTrend(): OnchainTrend {
  const n = hashrateHistory.length;
  if (n < 3) return { direction: 'flat', pctChange: 0, sampleCount: n, current: hashrateHistory[n - 1]?.hashRate ?? 0 };
  const oldest = hashrateHistory[0].hashRate;
  const newest = hashrateHistory[n - 1].hashRate;
  const pctChange = oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0;
  // >3% change over the window = a real move; below that = flat (noise).
  const direction: OnchainTrend['direction'] = pctChange > 3 ? 'rising' : pctChange < -3 ? 'falling' : 'flat';
  return { direction, pctChange: Math.round(pctChange * 10) / 10, sampleCount: n, current: newest };
}
