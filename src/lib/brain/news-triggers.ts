/**
 * Lazy Brain — news-event triggers.
 *
 * Every tick, scan three crypto RSS feeds (CoinDesk, Cointelegraph, Decrypt)
 * for breaking headlines. A small keyword lexicon (weight + polarity) flags
 * high-impact stories. Mentioned assets are tagged via the ASSET_TOKENS map
 * and force-queued for analysis with source 'news'.
 *
 * Performance: a 5-minute cache wraps the whole scan so the 60s scheduler
 * tick doesn't hammer the feeds. A 500-entry FIFO dedup ring buffer tracks
 * seen article URLs so the same story doesn't re-fire triggers across ticks.
 *
 * Network: uses `node:https` (not `fetch`) to bypass Next.js's fetch
 * patching + Cloudflare bot detection — same pattern as the LLM router.
 */

import https from 'node:https';
import { forceRun, recordTrigger } from './state';

// ---------------------------------------------------------------------------
// RSS sources
// ---------------------------------------------------------------------------

const RSS_FEEDS: Array<{ source: string; url: string }> = [
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed' },
];

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 8_000;
const MAX_SEEN = 500;

// ---------------------------------------------------------------------------
// Asset token map — keyword → Binance spot symbol
// ---------------------------------------------------------------------------

const ASSET_TOKENS: Array<{ tokens: string[]; symbol: string }> = [
  { tokens: ['bitcoin', 'btc'], symbol: 'BTCUSDT' },
  { tokens: ['ethereum', 'ether', 'eth'], symbol: 'ETHUSDT' },
  { tokens: ['solana', 'sol'], symbol: 'SOLUSDT' },
  { tokens: ['binance coin', 'bnb'], symbol: 'BNBUSDT' },
  { tokens: ['ripple', 'xrp'], symbol: 'XRPUSDT' },
  { tokens: ['cardano', 'ada'], symbol: 'ADAUSDT' },
  { tokens: ['dogecoin', 'doge'], symbol: 'DOGEUSDT' },
  { tokens: ['avalanche', 'avax'], symbol: 'AVAXUSDT' },
  { tokens: ['chainlink', 'link'], symbol: 'LINKUSDT' },
  { tokens: ['polygon', 'matic'], symbol: 'MATICUSDT' },
  { tokens: ['litecoin', 'ltc'], symbol: 'LTCUSDT' },
  { tokens: ['polkadot', 'dot'], symbol: 'DOTUSDT' },
  { tokens: ['uniswap', 'uni'], symbol: 'UNIUSDT' },
  { tokens: ['arbitrum', 'arb'], symbol: 'ARBUSDT' },
  { tokens: ['optimism', 'op'], symbol: 'OPUSDT' },
  { tokens: ['shiba inu', 'shib'], symbol: 'SHIBUSDT' },
  { tokens: ['tron', 'trx'], symbol: 'TRXUSDT' },
  { tokens: ['aptos', 'apt'], symbol: 'APTUSDT' },
  { tokens: ['near protocol', 'near'], symbol: 'NEARUSDT' },
  { tokens: ['cosmos', 'atom'], symbol: 'ATOMUSDT' },
  { tokens: ['filecoin', 'fil'], symbol: 'FILUSDT' },
  { tokens: ['hedera', 'hbar'], symbol: 'HBARUSDT' },
  { tokens: ['injective', 'inj'], symbol: 'INJUSDT' },
  { tokens: ['sui', 'sui'], symbol: 'SUIUSDT' },
  { tokens: ['pepe', 'pepe'], symbol: 'PEPEUSDT' },
];

// ---------------------------------------------------------------------------
// Keyword lexicon — weight × polarity
// ---------------------------------------------------------------------------

interface KeywordDef {
  word: string;
  weight: number; // 1..3
  polarity: 'positive' | 'negative' | 'neutral';
}

const KEYWORDS: KeywordDef[] = [
  { word: 'hack', weight: 3, polarity: 'negative' },
  { word: 'exploit', weight: 3, polarity: 'negative' },
  { word: 'breach', weight: 3, polarity: 'negative' },
  { word: 'rugpull', weight: 3, polarity: 'negative' },
  { word: 'rug pull', weight: 3, polarity: 'negative' },
  { word: 'ban', weight: 3, polarity: 'negative' },
  { word: 'crash', weight: 3, polarity: 'negative' },
  { word: 'dump', weight: 2, polarity: 'negative' },
  { word: 'lawsuit', weight: 2, polarity: 'negative' },
  { word: 'reject', weight: 2, polarity: 'negative' },
  { word: 'delist', weight: 2, polarity: 'negative' },
  { word: 'sec', weight: 2, polarity: 'neutral' },
  { word: 'sec charges', weight: 3, polarity: 'negative' },
  { word: 'etf', weight: 2, polarity: 'positive' },
  { word: 'approval', weight: 2, polarity: 'positive' },
  { word: 'approved', weight: 2, polarity: 'positive' },
  { word: 'listing', weight: 2, polarity: 'positive' },
  { word: 'listed', weight: 2, polarity: 'positive' },
  { word: 'surge', weight: 2, polarity: 'positive' },
  { word: 'pump', weight: 2, polarity: 'positive' },
  { word: 'rally', weight: 2, polarity: 'positive' },
  { word: 'partnership', weight: 1, polarity: 'positive' },
  { word: 'upgrade', weight: 1, polarity: 'positive' },
  { word: 'mainnet', weight: 1, polarity: 'positive' },
  { word: 'airdrop', weight: 1, polarity: 'positive' },
  { word: 'regulation', weight: 1, polarity: 'neutral' },
  { word: 'regulator', weight: 1, polarity: 'neutral' },
];

const HIGH_IMPACT_WEIGHT = 2; // weight ≥ this triggers a force-run

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MatchedHeadline {
  source: string;
  title: string;
  url?: string;
  publishedAt?: string;
  assets: string[];
  matchedKeywords: Array<{ word: string; weight: number; polarity: string }>;
  impactScore: number; // sum of keyword weights
  polarity: 'positive' | 'negative' | 'neutral';
}

export interface NewsTriggerResult {
  triggered: boolean;
  matchedHeadlines: MatchedHeadline[];
  queuedAssets: string[];
  fromCache: boolean;
  scanned: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Cache + dedup ring buffer (module-scoped, survives hot reload via globalThis)
// ---------------------------------------------------------------------------

interface NewsCache {
  at: number;
  result: NewsTriggerResult;
}

interface NewsGlobal {
  __OMNISCIENT_NEWS_CACHE__?: NewsCache;
  __OMNISCIENT_NEWS_SEEN__?: string[];
}

function g(): NewsGlobal {
  return globalThis as unknown as NewsGlobal;
}

function seenSet(): string[] {
  if (!g().__OMNISCIENT_NEWS_SEEN__) g().__OMNISCIENT_NEWS_SEEN__ = [];
  return g().__OMNISCIENT_NEWS_SEEN__!;
}

function markSeen(key: string): boolean {
  const seen = seenSet();
  if (seen.includes(key)) return false;
  seen.push(key);
  while (seen.length > MAX_SEEN) seen.shift();
  return true;
}

// ---------------------------------------------------------------------------
// RSS fetch + naive XML item parser
// ---------------------------------------------------------------------------

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'OMNISCIENT/1.0 (lazy-brain-news-trigger)',
          Accept: 'application/rss+xml,application/xml,text/xml',
        },
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow a single redirect.
          httpsGet(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

interface RssItem {
  title: string;
  link?: string;
  pubDate?: string;
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  // Match <item>...</item> blocks (case-insensitive, dotall)
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1] ?? '';
    const title = pickTag(block, 'title');
    const link = pickTag(block, 'link');
    const pubDate = pickTag(block, 'pubDate');
    if (title) items.push({ title: decodeEntities(title), link, pubDate });
  }
  return items;
}

function pickTag(block: string, tag: string): string | undefined {
  // Try <tag>text</tag> first, then CDATA variant.
  const re = new RegExp(`<${tag}\\b[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`, 'i');
  const m = re.exec(block);
  if (!m) return undefined;
  return (m[1] ?? m[2] ?? '').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// ---------------------------------------------------------------------------
// Headline analysis
// ---------------------------------------------------------------------------

function analyzeHeadline(title: string): {
  assets: string[];
  matched: Array<{ word: string; weight: number; polarity: string }>;
  impactScore: number;
  polarity: 'positive' | 'negative' | 'neutral';
} {
  const lower = ` ${title.toLowerCase()} `;
  const assets = new Set<string>();
  for (const def of ASSET_TOKENS) {
    for (const t of def.tokens) {
      // Word-boundary match — avoid matching "eth" inside "ethereum" or "method".
      const re = new RegExp(`(^|[^a-z])${escapeRe(t)}([^a-z]|$)`, 'i');
      if (re.test(lower)) {
        assets.add(def.symbol);
        break;
      }
    }
  }

  let impactScore = 0;
  let pos = 0;
  let neg = 0;
  const matched: Array<{ word: string; weight: number; polarity: string }> = [];
  for (const kw of KEYWORDS) {
    const re = new RegExp(`(^|[^a-z])${escapeRe(kw.word)}([^a-z]|$)`, 'i');
    if (re.test(lower)) {
      impactScore += kw.weight;
      matched.push({ word: kw.word, weight: kw.weight, polarity: kw.polarity });
      if (kw.polarity === 'positive') pos += kw.weight;
      else if (kw.polarity === 'negative') neg += kw.weight;
    }
  }

  let polarity: 'positive' | 'negative' | 'neutral' = 'neutral';
  if (pos > neg) polarity = 'positive';
  else if (neg > pos) polarity = 'negative';

  return {
    assets: Array.from(assets),
    matched,
    impactScore,
    polarity,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function checkNewsTriggers(): Promise<NewsTriggerResult> {
  const cache = g().__OMNISCIENT_NEWS_CACHE__;
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return { ...cache.result, fromCache: true };
  }

  const errors: string[] = [];
  const matchedHeadlines: MatchedHeadline[] = [];
  const queuedAssetsSet = new Set<string>();
  let scanned = 0;

  await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      try {
        const xml = await httpsGet(feed.url);
        const items = parseRssItems(xml);
        for (const item of items) {
          scanned++;
          const a = analyzeHeadline(item.title);
          if (a.assets.length === 0) continue;
          if (a.impactScore < HIGH_IMPACT_WEIGHT) continue;

          const dedupKey = (item.link ?? item.title).trim().toLowerCase();
          if (!markSeen(dedupKey)) continue;

          matchedHeadlines.push({
            source: feed.source,
            title: item.title,
            url: item.link,
            publishedAt: item.pubDate,
            assets: a.assets,
            matchedKeywords: a.matched,
            impactScore: a.impactScore,
            polarity: a.polarity,
          });

          for (const sym of a.assets) queuedAssetsSet.add(sym);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${feed.source}: ${msg}`);
      }
    }),
  );

  const queuedAssets = Array.from(queuedAssetsSet);
  for (const sym of queuedAssets) {
    forceRun(sym, 'news');
  }
  if (queuedAssets.length > 0) {
    recordTrigger('news');
  }

  // Sort by impact score (desc) so the most-important headlines surface first.
  matchedHeadlines.sort((a, b) => b.impactScore - a.impactScore);

  const result: NewsTriggerResult = {
    triggered: queuedAssets.length > 0,
    matchedHeadlines,
    queuedAssets,
    fromCache: false,
    scanned,
    errors,
  };

  g().__OMNISCIENT_NEWS_CACHE__ = { at: now, result };
  return result;
}

// ---------------------------------------------------------------------------
// Test helper — clears the cache + dedup ring. NOT for production use.
// ---------------------------------------------------------------------------

export function __resetNewsCacheForTests(): void {
  const ng = g();
  ng.__OMNISCIENT_NEWS_CACHE__ = undefined;
  ng.__OMNISCIENT_NEWS_SEEN__ = [];
}
