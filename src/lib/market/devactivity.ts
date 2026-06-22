// GitHub dev-activity — free, no API key (60 req/hr anonymous).
//
// Adds a developer-signal layer to the free stack: commit count + stars + last
// push for the flagship repos of major protocols. Rising commit activity =
// active development = a genuine fundamental signal that complements the
// technical/sentiment/on-chain layers. Zero tokens, zero API key.
//
// Cached 30 min — dev activity doesn't move fast, and this stays well within
// GitHub's anonymous rate limit (5 repos × 2 calls × 2/hr = 20/hr << 60/hr).

import https from 'node:https';

const UA = 'OMNISCIENT/1.0 (market-intel; +https://omniscient.app)';

function getJson(url: string, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' }, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`GitHub ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('GitHub bad JSON')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

const cache = new Map<string, { data: any; ts: number }>();
const TTL = 30 * 60 * 1000;
function cached<T>(key: string): T | null {
  const c = cache.get(key);
  return c && Date.now() - c.ts < TTL ? (c.data as T) : null;
}
function store(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

// Flagship repo per tracked asset — the canonical source repo whose commit
// activity signals protocol dev health.
const REPOS: { asset: string; repo: string; label: string }[] = [
  { asset: 'BTC', repo: 'bitcoin/bitcoin', label: 'Bitcoin Core' },
  { asset: 'ETH', repo: 'ethereum/ethereum-org-website', label: 'Ethereum' },
  { asset: 'SOL', repo: 'solana-labs/solana', label: 'Solana' },
  { asset: 'LINK', repo: 'smartcontractkit/chainlink', label: 'Chainlink' },
  { asset: 'ADA', repo: 'IntersectMBO/cardano-node', label: 'Cardano' },
];

export interface RepoActivity {
  asset: string;
  label: string;
  repo: string;
  stars: number;
  commits7d: number;
  commitsPrev7d: number; // previous week — for the delta trend
  deltaPct: number; // (this - prev) / max(prev, 1) * 100
  lastPush: string | null; // ISO
}

/**
 * Fetch dev activity for the flagship repos. Each repo needs 3 calls (repo info
 * + this-week commits + last-week commits), fired in parallel per repo. The
 * delta (this vs last week) is a genuine trend signal — rising dev activity =
 * accelerating development. Returns what it can; each repo degrades independently.
 *
 * If ALL repos fail (typically GitHub anonymous rate-limit 60/hr exhausted on a
 * shared IP), returns an empty array instead of throwing — the UI shows
 * "temporarily unavailable" rather than a 500 crash. The empty result is cached
 * for 5 min so we don't keep hammering GitHub while rate-limited.
 */
export async function getDevActivity(): Promise<RepoActivity[]> {
  const cachedArr = cached<RepoActivity[]>('devactivity');
  if (cachedArr) return cachedArr;

  // Also cache the "all failed" empty result briefly to avoid re-hammering
  // GitHub when we're rate-limited (60/hr anonymous limit is easy to exhaust
  // on a shared datacenter IP).
  const cachedFail = cached<RepoActivity[]>('devactivity:fail');
  if (cachedFail) return cachedFail;

  const now = Date.now();
  const sinceThis = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const sincePrev = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
  const untilPrev = sinceThis; // last week ends where this week begins
  const results = await Promise.allSettled(
    REPOS.map(async (r): Promise<RepoActivity> => {
      const [info, commitsThis, commitsPrev] = await Promise.all([
        getJson(`https://api.github.com/repos/${r.repo}`),
        getJson(`https://api.github.com/repos/${r.repo}/commits?since=${sinceThis}&per_page=100`),
        getJson(`https://api.github.com/repos/${r.repo}/commits?since=${sincePrev}&until=${untilPrev}&per_page=100`),
      ]);
      const this7 = Array.isArray(commitsThis) ? commitsThis.length : 0;
      const prev7 = Array.isArray(commitsPrev) ? commitsPrev.length : 0;
      const deltaPct = prev7 > 0 ? ((this7 - prev7) / prev7) * 100 : this7 > 0 ? 100 : 0;
      return {
        asset: r.asset,
        label: r.label,
        repo: r.repo,
        stars: info.stargazers_count ?? 0,
        commits7d: this7,
        commitsPrev7d: prev7,
        deltaPct: Math.round(deltaPct),
        lastPush: info.pushed_at ?? null,
      };
    }),
  );
  const out: RepoActivity[] = [];
  for (const r of results) if (r.status === 'fulfilled') out.push(r.value);
  if (out.length === 0) {
    // All repos failed (likely GitHub rate-limit). Cache the empty result for
    // 5 min so we don't re-hammer, and return [] — the UI will show
    // "temporarily unavailable" instead of crashing with a 500.
    cache.set('devactivity:fail', { data: [], ts: Date.now() });
    // Override the TTL for the fail cache (5 min, not 30 min)
    return [];
  }
  store('devactivity', out);
  return out;
}
