/**
 * Reddit sentiment via word-count lexicon.
 *
 * Reddit's JSON API is hit-or-miss from server-side IPs (it 403s datacenter
 * ranges aggressively). This module is built to degrade gracefully — on any
 * HTTP error it returns a zero-sentiment result with `available=false` so the
 * `FreeSignalsCard` UI can render a "Reddit unavailable" tile instead of
 * crashing the page.
 *
 * Algorithm:
 *   1. Fetch /r/{subreddit}/hot.json?limit=50
 *   2. Concatenate the title + body of every post
 *   3. Count bull-word and bear-word occurrences with word boundaries
 *   4. sentiment = (bull − bear) / (bull + bear)   ∈ [−1, +1]
 *
 * Cache: 15 minutes per subreddit. Aggregator `getCryptoSocialSentiment()`
 * fan-outs across r/CryptoCurrency, r/Bitcoin, and r/ethereum.
 */

import https from 'node:https';

const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6_000;
const POST_LIMIT = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedditSentiment {
  subreddit: string;
  available: boolean;
  sentiment: number; // -1..+1
  bullCount: number;
  bearCount: number;
  postCount: number;
  sampleTextLength: number;
  error?: string;
  asOf: number;
}

export interface CryptoSocialSentiment {
  available: boolean;
  aggregatedSentiment: number; // -1..+1
  bullCount: number;
  bearCount: number;
  perSub: RedditSentiment[];
  asOf: number;
}

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

const BULL_WORDS = [
  'bull', 'bullish', 'long', 'buy', 'buying', 'bought', 'support', 'hold', 'holding',
  'pump', 'pumping', 'moon', 'mooning', 'rocket', 'breakout', 'accumulate',
  'accumulation', 'undervalued', 'ath', 'all-time high', 'surge', 'surging',
  'rally', 'green', 'wicks up', 'bid', 'demand',
];

const BEAR_WORDS = [
  'bear', 'bearish', 'short', 'sell', 'selling', 'sold', 'resistance', 'dump',
  'dumping', 'crash', 'crashing', 'decline', 'overbought', 'distribution',
  'overvalued', 'atl', 'all-time low', 'plunge', 'plunging', 'selloff', 'red',
  'wick down', 'ask', 'supply', 'rekt', 'liquidated',
];

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  at: number;
  value: T;
}

interface RedditGlobal {
  __OMNISCIENT_REDDIT_CACHE__?: Map<string, CacheEntry<unknown>>;
}

function cacheMap(): Map<string, CacheEntry<unknown>> {
  const g = globalThis as unknown as RedditGlobal;
  if (!(g.__OMNISCIENT_REDDIT_CACHE__ instanceof Map)) {
    g.__OMNISCIENT_REDDIT_CACHE__ = new Map();
  }
  return g.__OMNISCIENT_REDDIT_CACHE__!;
}

function cached<T>(key: string): T | null {
  const e = cacheMap().get(key) as CacheEntry<T> | undefined;
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    cacheMap().delete(key);
    return null;
  }
  return e.value;
}

function setCached<T>(key: string, value: T): T {
  cacheMap().set(key, { at: Date.now(), value });
  return value;
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
          // Reddit needs a real-looking UA to avoid 403s on datacenter IPs.
          'User-Agent': 'OMNISCIENT/1.0 (+reddit-sentiment; +https://omniscient.app)',
          Accept: 'application/json',
        },
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpsGetJson(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`HTTP ${res.statusCode}`));
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
// Lexicon counting
// ---------------------------------------------------------------------------

function countWords(text: string, words: string[]): number {
  if (!text) return 0;
  const lower = text.toLowerCase();

  // Split single-word lexicon (no spaces/hyphens) — set lookup is exact-match.
  const single = words.filter((w) => !/[\s-]/.test(w));
  const multi = words.filter((w) => /[\s-]/.test(w));
  const singleSet = new Set(single);

  const tokens = lower.split(/[^a-z]+/);
  let count = 0;
  for (const t of tokens) {
    if (singleSet.has(t)) count++;
  }

  // Multi-word phrases — count non-overlapping substring occurrences.
  for (const w of multi) {
    let idx = 0;
    while ((idx = lower.indexOf(w, idx)) !== -1) {
      count++;
      idx += w.length;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute sentiment for a single subreddit. Degrades gracefully on network
 * errors (returns `available: false`).
 */
export async function getRedditSentiment(subreddit: string): Promise<RedditSentiment> {
  const key = `sub:${subreddit.toLowerCase()}`;
  const hit = cached<RedditSentiment>(key);
  if (hit) return hit;

  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot.json?limit=${POST_LIMIT}`;
  try {
    const json = await httpsGetJson(url);
    const posts = json?.data?.children ?? [];
    let text = '';
    let postCount = 0;
    for (const p of posts) {
      const d = p?.data ?? {};
      if (d.title) text += ` ${d.title}`;
      if (d.selftext) text += ` ${d.selftext}`;
      postCount++;
    }

    const bullCount = countWords(text, BULL_WORDS);
    const bearCount = countWords(text, BEAR_WORDS);
    const total = bullCount + bearCount;
    const sentiment = total > 0 ? (bullCount - bearCount) / total : 0;

    const result: RedditSentiment = {
      subreddit,
      available: true,
      sentiment,
      bullCount,
      bearCount,
      postCount,
      sampleTextLength: text.length,
      asOf: Date.now(),
    };
    return setCached(key, result);
  } catch (e) {
    const result: RedditSentiment = {
      subreddit,
      available: false,
      sentiment: 0,
      bullCount: 0,
      bearCount: 0,
      postCount: 0,
      sampleTextLength: 0,
      error: e instanceof Error ? e.message : String(e),
      asOf: Date.now(),
    };
    // Cache failures too — but only briefly, so retries can succeed.
    cacheMap().set(key, { at: Date.now() - CACHE_TTL_MS + 60_000, value: result });
    return result;
  }
}

/**
 * Aggregate sentiment across the three main crypto subreddits.
 * Returns a single aggregatedSentiment in [-1, +1] (sum-weighted) plus the
 * per-sub breakdown for the UI.
 */
export async function getCryptoSocialSentiment(): Promise<CryptoSocialSentiment> {
  const subs = ['CryptoCurrency', 'Bitcoin', 'ethereum'];
  const perSub = await Promise.all(subs.map((s) => getRedditSentiment(s)));

  let bull = 0;
  let bear = 0;
  let anyAvailable = false;
  for (const s of perSub) {
    if (!s.available) continue;
    anyAvailable = true;
    bull += s.bullCount;
    bear += s.bearCount;
  }

  const total = bull + bear;
  const aggregatedSentiment = total > 0 ? (bull - bear) / total : 0;

  return {
    available: anyAvailable,
    aggregatedSentiment,
    bullCount: bull,
    bearCount: bear,
    perSub,
    asOf: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function __clearRedditCacheForTests(): void {
  cacheMap().clear();
}
