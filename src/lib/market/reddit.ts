// Reddit free sentiment client — no API key, public JSON endpoints.
//
// Fetches hot posts from a subreddit and scores them with a pure bullish/
// bearish word-count lexicon. Zero LLM tokens. This adds a free social-
// sentiment data source to the stack — the kind of signal that complements
// the technical + orderbook layers without spending any budget.
//
// Reddit's public .json endpoints are rate-limited (~60 req/min anonymous);
// we cache 15 min and fetch at most ~25 hot posts per call.

import https from 'node:https';

const UA = 'OMNISCIENT/1.0 (market-intel; +https://omniscient.app)';

function get(url: string, timeoutMs = 10000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: timeoutMs }, (res) => {
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

// Compact crypto trading lexicon. Deliberately small — this is a coarse
// sentiment gate, not a fine-grained NLP model. Tuned for crypto subs.
const BULL = ['bull', 'bullish', 'moon', 'pump', 'surge', 'rally', 'breakout', 'accumulate', 'buy', 'long', 'support', 'recovery', 'growth', 'adoption', 'institutional', 'etf', ' ATH', 'breakout', 'green', 'holding strong', 'accumulate'];
const BEAR = ['bear', 'bearish', 'dump', 'crash', 'sell', 'short', 'resistance', 'reject', 'liquidation', 'capitulation', 'hack', 'ban', 'regulation', 'fraud', 'scam', 'delist', 'red', 'bleed', 'fear', 'panic', 'collapse', 'down', 'drop'];

export interface RedditPost {
  title: string;
  score: number;
  numComments: number;
  createdUtc: number;
  url: string;
}

export interface RedditSentiment {
  subreddit: string;
  postsAnalyzed: number;
  bullishHits: number;
  bearishHits: number;
  score: number; // -100..100 (bullish - bearish, scaled)
  label: 'bullish' | 'bearish' | 'neutral';
  topPosts: RedditPost[];
  fetchedAt: number;
}

/** Score a subreddit's hot feed. Pure word-count, no LLM. */
export async function getRedditSentiment(subreddit: string, limit = 25): Promise<RedditSentiment> {
  const sub = subreddit.toLowerCase().replace(/^r\//, '');
  const key = `reddit:${sub}:${limit}`;
  const cachedRes = cached<RedditSentiment>(key);
  if (cachedRes) return cachedRes;

  const { status, text } = await get(`https://www.reddit.com/r/${sub}/hot.json?limit=${limit}`);
  if (status !== 200) throw new Error(`Reddit ${sub} ${status}`);
  const data = JSON.parse(text);
  const children: any[] = data?.data?.children ?? [];
  const posts: RedditPost[] = children
    .filter((c) => c?.data && !c.data.stickied)
    .map((c) => ({
      title: c.data.title ?? '',
      score: c.data.score ?? 0,
      numComments: c.data.num_comments ?? 0,
      createdUtc: c.data.created_utc ?? 0,
      url: `https://reddit.com${c.data.permalink ?? ''}`,
    }));

  let bull = 0;
  let bear = 0;
  for (const p of posts) {
    const t = p.title.toLowerCase();
    if (BULL.some((w) => t.includes(w))) bull++;
    if (BEAR.some((w) => t.includes(w))) bear++;
  }
  const total = bull + bear;
  // Score: net bullish fraction × 100. If no hits, neutral.
  const score = total > 0 ? Math.round(((bull - bear) / total) * 100) : 0;
  const label: RedditSentiment['label'] = score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral';

  const out: RedditSentiment = {
    subreddit: sub,
    postsAnalyzed: posts.length,
    bullishHits: bull,
    bearishHits: bear,
    score,
    label,
    topPosts: posts.slice(0, 8),
    fetchedAt: Date.now(),
  };
  store(key, out);
  return out;
}

/** Sentiment across several crypto subs at once, aggregated. */
export async function getCryptoSocialSentiment(): Promise<{
  aggregate: RedditSentiment;
  perSub: RedditSentiment[];
}> {
  const subs = ['cryptocurrency', 'bitcoin', 'ethtrader'];
  const perSub = await Promise.allSettled(subs.map((s) => getRedditSentiment(s, 25)));
  const ok = perSub.filter((r): r is PromiseFulfilledResult<RedditSentiment> => r.status === 'fulfilled').map((r) => r.value);
  if (ok.length === 0) throw new Error('All Reddit subreddits failed');
  const totalBull = ok.reduce((s, r) => s + r.bullishHits, 0);
  const totalBear = ok.reduce((s, r) => s + r.bearishHits, 0);
  const total = totalBull + totalBear;
  const score = total > 0 ? Math.round(((totalBull - totalBear) / total) * 100) : 0;
  return {
    aggregate: {
      subreddit: 'crypto-aggregate',
      postsAnalyzed: ok.reduce((s, r) => s + r.postsAnalyzed, 0),
      bullishHits: totalBull,
      bearishHits: totalBear,
      score,
      label: score > 15 ? 'bullish' : score < -15 ? 'bearish' : 'neutral',
      topPosts: ok.flatMap((r) => r.topPosts).sort((a, b) => b.score - a.score).slice(0, 8),
      fetchedAt: Date.now(),
    },
    perSub: ok,
  };
}
