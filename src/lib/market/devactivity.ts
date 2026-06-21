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
  lastPush: string | null; // ISO
}

/**
 * Fetch dev activity for the flagship repos. Each repo needs 2 calls (repo info
 * + recent commits), fired in parallel per repo. Returns what it can — partial
 * data is more useful than none, and each repo degrades independently.
 */
export async function getDevActivity(): Promise<RepoActivity[]> {
  const cachedArr = cached<RepoActivity[]>('devactivity');
  if (cachedArr) return cachedArr;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const results = await Promise.allSettled(
    REPOS.map(async (r): Promise<RepoActivity> => {
      const [info, commits] = await Promise.all([
        getJson(`https://api.github.com/repos/${r.repo}`),
        // per_page=100 is enough for a week of any healthy repo; if there are
        // more, we cap at 100 (the count is still a strong signal).
        getJson(`https://api.github.com/repos/${r.repo}/commits?since=${since}&per_page=100`),
      ]);
      return {
        asset: r.asset,
        label: r.label,
        repo: r.repo,
        stars: info.stargazers_count ?? 0,
        commits7d: Array.isArray(commits) ? commits.length : 0,
        lastPush: info.pushed_at ?? null,
      };
    }),
  );
  const out: RepoActivity[] = [];
  for (const r of results) if (r.status === 'fulfilled') out.push(r.value);
  if (out.length === 0) throw new Error('All GitHub repos failed');
  store('devactivity', out);
  return out;
}
