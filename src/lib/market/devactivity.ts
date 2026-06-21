/**
 * GitHub developer-activity client (no API key required).
 *
 * Tracks 7-day commit counts for the canonical repos behind 5 major crypto
 * assets and computes the week-over-week delta as a fundamental-edge signal.
 *
 * The 5 repos:
 *   - bitcoin/bitcoin        → BTC
 *   - ethereum               → ETH  (org: ethereum, repo: ethereum)
 *   - solana-labs/solana     → SOL
 *   - chainlink/chainlink    → LINK
 *   - cardano-foundation/cardano-node → ADA
 *
 * Cache: 30 minutes (GitHub's anonymous rate limit is 60 req/hr — 5 repos ×
 * 3 calls per refresh = 15 calls = half the budget per refresh, refreshed
 * 2×/hr = 30 calls/hr, leaving headroom for ad-hoc /api/devactivity calls).
 *
 * Returns a normalised shape for the FreeSignalsCard + consensus layer.
 */

import https from 'node:https';

const API = 'https://api.github.com';
const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DevActivityEntry {
  asset: string; // BTC | ETH | SOL | LINK | ADA
  label: string; // "Bitcoin Core", "go-ethereum", etc.
  repo: string; // "bitcoin/bitcoin"
  stars: number;
  commits7d: number;
  commitsPrev7d: number;
  deltaPct: number; // (commits7d - commitsPrev7d) / commitsPrev7d × 100
  lastPush: string | null; // ISO date
  ok: boolean;
  error?: string;
}

export interface DevActivityResult {
  asOf: number;
  fromCache: boolean;
  entries: DevActivityEntry[];
}

// ---------------------------------------------------------------------------
// Repo registry
// ---------------------------------------------------------------------------

interface RepoDef {
  asset: string;
  label: string;
  repo: string; // "owner/name"
}

const REPOS: RepoDef[] = [
  { asset: 'BTC', label: 'Bitcoin Core', repo: 'bitcoin/bitcoin' },
  { asset: 'ETH', label: 'go-ethereum', repo: 'ethereum/go-ethereum' },
  { asset: 'SOL', label: 'Solana', repo: 'solana-labs/solana' },
  { asset: 'LINK', label: 'Chainlink', repo: 'chainlink/chainlink' },
  { asset: 'ADA', label: 'cardano-node', repo: 'IntersectMBO/cardano-node' },
];

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface DevGlobal {
  __OMNISCIENT_DEV_ACTIVITY_CACHE__?: { at: number; value: DevActivityResult };
}

function g(): DevGlobal {
  return globalThis as unknown as DevGlobal;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function httpsGetJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'OMNISCIENT/1.0 (+dev-activity)',
          Accept: 'application/vnd.github+json',
        },
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpsGetJson(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Repo metadata (single call → stars + pushed_at)
// ---------------------------------------------------------------------------

interface RepoMeta {
  stars: number;
  pushedAt: string | null;
}

async function fetchRepoMeta(repo: string): Promise<RepoMeta> {
  const json = await httpsGetJson(`${API}/repos/${repo}`);
  return {
    stars: typeof json?.stargazers_count === 'number' ? json.stargazers_count : Number(json?.stargazers_count) || 0,
    pushedAt: typeof json?.pushed_at === 'string' ? json.pushed_at : null,
  };
}

// ---------------------------------------------------------------------------
// Commit counts (windowed)
// ---------------------------------------------------------------------------

/**
 * GitHub's commits endpoint paginates (max 100/page, max ~300 accessible).
 * For a 7-day window on a busy repo we may need to walk multiple pages — but
 * most weeks on these repos are <300 commits, so we use per_page=100 + a
 * single page walk up to 3 pages (= 300 commits ceiling).
 */
async function countCommitsInWindow(repo: string, since: string, until: string): Promise<number> {
  let count = 0;
  let page = 1;
  while (true) {
    const url = `${API}/repos/${repo}/commits?since=${since}&until=${until}&per_page=100&page=${page}`;
    const json = await httpsGetJson(url);
    if (!Array.isArray(json) || json.length === 0) break;
    count += json.length;
    if (json.length < 100) break; // last page
    page++;
    if (page > 3) break; // safety ceiling
  }
  return count;
}

// ---------------------------------------------------------------------------
// Per-repo entry
// ---------------------------------------------------------------------------

async function fetchEntry(def: RepoDef, now: number): Promise<DevActivityEntry> {
  const sinceThis = new Date(now - WEEK_MS).toISOString();
  const untilThis = new Date(now).toISOString();
  const sincePrev = new Date(now - 2 * WEEK_MS).toISOString();
  const untilPrev = new Date(now - WEEK_MS).toISOString();

  try {
    const [meta, c7, cPrev] = await Promise.all([
      fetchRepoMeta(def.repo),
      countCommitsInWindow(def.repo, sinceThis, untilThis),
      countCommitsInWindow(def.repo, sincePrev, untilPrev),
    ]);

    const deltaPct = cPrev > 0 ? ((c7 - cPrev) / cPrev) * 100 : c7 > 0 ? 100 : 0;

    return {
      asset: def.asset,
      label: def.label,
      repo: def.repo,
      stars: meta.stars,
      commits7d: c7,
      commitsPrev7d: cPrev,
      deltaPct,
      lastPush: meta.pushedAt,
      ok: true,
    };
  } catch (e) {
    return {
      asset: def.asset,
      label: def.label,
      repo: def.repo,
      stars: 0,
      commits7d: 0,
      commitsPrev7d: 0,
      deltaPct: 0,
      lastPush: null,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getDevActivity(): Promise<DevActivityResult> {
  const cached = g().__OMNISCIENT_DEV_ACTIVITY_CACHE__;
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return { ...cached.value, fromCache: true };
  }

  // Sequential repo fetches — parallel would burn 15 calls in a single
  // second and trip the anonymous rate-limiter. Sequential with Promise.all
  // on the inner per-repo calls keeps us under 1 call/sec/repo.
  const entries: DevActivityEntry[] = [];
  for (const def of REPOS) {
    entries.push(await fetchEntry(def, now));
  }

  const result: DevActivityResult = {
    asOf: now,
    fromCache: false,
    entries,
  };

  g().__OMNISCIENT_DEV_ACTIVITY_CACHE__ = { at: now, value: result };
  return result;
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function __clearDevActivityCacheForTests(): void {
  g().__OMNISCIENT_DEV_ACTIVITY_CACHE__ = undefined;
}
