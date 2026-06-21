// News-event triggers — deepen autonomy with zero LLM tokens.
//
// Scans recent crypto-news RSS titles for market-moving keywords (hack, ETF,
// regulation, ban, SEC, partnership, listing, …) and queues any mentioned
// assets for re-analysis on the next tick. This is the "news-event trigger"
// from the user's deeper-autonomy ask — and unlike self-tuning (needs 24h
// grades) it can fire the moment breaking news lands.
//
// Free + tokenless: RSS + a keyword lexicon. No LLM, no API key. Seen-article
// dedup lives in the brain state so the same headline doesn't re-trigger.
//
// Coarse by design: a keyword gate, not an NLP model. Good enough to catch
// "SEC sues Binance" or "BlackRock ETF approved" and wake the brain up.

import https from 'node:https';
import { forceRun, recordAction, recordTrigger } from '@/lib/brain/state';

const UA = 'Mozilla/5.0 (compatible; OMNISCIENT/1.0)';

// Market-moving keyword patterns. Each has a weight (how strongly it suggests
// the news is actionable) and a polarity hint (bullish/bearish/neutral).
const KEYWORDS: { re: RegExp; weight: number; polarity: 'bull' | 'bear' | 'neutral' }[] = [
  { re: /\b(hack|exploit|drained|breach|stolen|lost funds)\b/i, weight: 3, polarity: 'bear' },
  { re: /\b(SEC|lawsuit|sue|sued|regulat|ban|blocked|crackdown|enforcement)\b/i, weight: 3, polarity: 'bear' },
  { re: /\b(ETF|approved|approval|spot etf|institutional|blackrock|fidelity)\b/i, weight: 3, polarity: 'bull' },
  { re: /\b(partnership|partners|collab|integration|adopts|adopting)\b/i, weight: 2, polarity: 'bull' },
  { re: /\b(listing|listed|launches|launching|mainnet|upgrade|fork|airdrop)\b/i, weight: 2, polarity: 'bull' },
  { re: /\b(liquidat|cascade|crash|plunge|dump|collapse|capitulation)\b/i, weight: 3, polarity: 'bear' },
  { re: /\b(surge|soar|pump|rally|breakout|all-time high|ATH)\b/i, weight: 2, polarity: 'bull' },
  { re: /\b(delisting|delisted|shutdown|shuts down|cease)\b/i, weight: 3, polarity: 'bear' },
  { re: /\b(funding|raise|raises|series [a-z]|investment|backed by)\b/i, weight: 1, polarity: 'bull' },
];

// Map asset symbols → the token names/tickers that, if mentioned, tag the asset.
const ASSET_TOKENS: { symbol: string; names: string[] }[] = [
  { symbol: 'BTCUSDT', names: ['bitcoin', 'btc', '₿'] },
  { symbol: 'ETHUSDT', names: ['ethereum', 'eth', 'ether'] },
  { symbol: 'SOLUSDT', names: ['solana', 'sol'] },
  { symbol: 'BNBUSDT', names: ['bnb', 'binance coin'] },
  { symbol: 'XRPUSDT', names: ['xrp', 'ripple'] },
  { symbol: 'ADAUSDT', names: ['cardano', 'ada'] },
  { symbol: 'DOGEUSDT', names: ['doge', 'dogecoin'] },
  { symbol: 'AVAXUSDT', names: ['avax', 'avalanche'] },
  { symbol: 'LINKUSDT', names: ['chainlink', 'link'] },
  { symbol: 'MATICUSDT', names: ['matic', 'polygon'] },
  { symbol: 'POLUSDT', names: ['pol', 'polygon'] },
];

// Seen-article dedup — persists in-memory on globalThis so we don't re-trigger
// the same headline every tick. Capped to avoid unbounded growth.
const g = globalThis as unknown as { __omniscientSeenNews?: Set<string> };
function seenSet(): Set<string> {
  if (!g.__omniscientSeenNews) g.__omniscientSeenNews = new Set();
  return g.__omniscientSeenNews;
}
const MAX_SEEN = 500;

interface RssItem { title: string; url: string; date: string | null }

// RSS feed cache — 5 min TTL. Lets checkNewsTriggers run every tick (60s)
// for sub-minute breaking-news response without re-fetching feeds constantly.
// The seen-article dedup (in brain state) prevents re-triggering within the
// cache window. ponytail: a Map cache is the minimum that works here.
const rssCache = new Map<string, { items: RssItem[]; ts: number }>();
const RSS_CACHE_TTL = 5 * 60 * 1000;

function fetchRssUncached(feedUrl: string): Promise<RssItem[]> {
  return new Promise((resolve) => {
    const u = new URL(feedUrl);
    const req = https.get(
      { hostname: u.hostname, port: 443, path: u.pathname + u.search, headers: { 'User-Agent': UA }, timeout: 8000 },
      (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location;
          if (loc) { fetchRssUncached(loc).then(resolve).catch(() => resolve([])); return; }
        }
        let xml = '';
        res.on('data', (c) => (xml += c));
        res.on('end', () => {
          try { resolve(parseRss(xml)); } catch { resolve([]); }
        });
      },
    );
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

/** Cached RSS fetch — returns the cached items if fresh (< 5 min), else re-fetches. */
function fetchRss(feedUrl: string): Promise<RssItem[]> {
  const cached = rssCache.get(feedUrl);
  if (cached && Date.now() - cached.ts < RSS_CACHE_TTL) {
    return Promise.resolve(cached.items);
  }
  return fetchRssUncached(feedUrl).then((items) => {
    rssCache.set(feedUrl, { items, ts: Date.now() });
    return items;
  });
}

function parseRss(xml: string): RssItem[] {
  const out: RssItem[] = [];
  const re = /<item[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && out.length < 15) {
    const b = m[0];
    const title = (b.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    const link = (b.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || b.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] || '').trim();
    const pub = (b.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] || '').trim();
    if (title && link) out.push({ title: decode(title), url: link, date: pub || null });
  }
  return out;
}
function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export interface NewsTriggerResult {
  triggered: boolean;
  matchedHeadlines: { title: string; url: string; polarity: string; weight: number; assets: string[] }[];
  queuedAssets: string[];
}

/**
 * Scan recent crypto-news RSS for market-moving headlines. Queues mentioned
 * assets for re-analysis + records a visible action. Only fires on headlines
 * published in the last `maxAgeMs` (default 1h) that haven't been seen before.
 */
export async function checkNewsTriggers(maxAgeMs = 60 * 60 * 1000): Promise<NewsTriggerResult> {
  const feeds = [
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
    'https://decrypt.co/feed',
  ];
  const results = await Promise.allSettled(feeds.map(fetchRss));
  const all: RssItem[] = [];
  for (const r of results) if (r.status === 'fulfilled') all.push(...r.value);

  const seen = seenSet();
  const now = Date.now();
  const matched: NewsTriggerResult['matchedHeadlines'] = [];
  const queuedAssets = new Set<string>();

  for (const item of all) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    // Age filter — only fresh headlines can trigger.
    if (item.date) {
      const t = new Date(item.date).getTime();
      if (isNaN(t) || now - t > maxAgeMs) continue;
    }

    // Keyword scan — sum weights of all matching patterns.
    let weight = 0;
    let polarity = 'neutral';
    for (const kw of KEYWORDS) {
      if (kw.re.test(item.title)) {
        weight += kw.weight;
        if (polarity === 'neutral') polarity = kw.polarity;
        else if (polarity !== kw.polarity) polarity = 'mixed';
      }
    }
    if (weight < 2) continue; // below threshold — not actionable

    // Asset tagging — which tracked assets does the headline mention?
    const lower = item.title.toLowerCase();
    const assets: string[] = [];
    for (const a of ASSET_TOKENS) {
      if (a.names.some((n) => lower.includes(n))) {
        assets.push(a.symbol);
        queuedAssets.add(a.symbol);
      }
    }
    if (assets.length === 0) continue; // no tracked asset mentioned — skip

    matched.push({ title: item.title, url: item.url, polarity, weight, assets });
  }

  // Cap the seen-set to avoid unbounded growth over long sessions.
  if (seen.size > MAX_SEEN) {
    const arr = Array.from(seen).slice(0, seen.size - MAX_SEEN);
    for (const s of arr) seen.delete(s);
  }

  // Queue mentioned assets for re-analysis + record a visible action.
  if (queuedAssets.size > 0) {
    const symbols = Array.from(queuedAssets);
    for (const s of symbols) forceRun(s, 'news');
    recordTrigger('news');
    recordAction({
      symbol: 'NEWS→TRIGGER',
      action: 'news-event',
      tier: 0,
      reason: `${matched.length} headline(s) → ${symbols.length} assets queued (${polarity(matched)})`,
      conviction: Math.min(100, matched.reduce((s, m) => s + m.weight, 0) * 10),
    });
  }

  return { triggered: queuedAssets.size > 0, matchedHeadlines: matched, queuedAssets: Array.from(queuedAssets) };
}

function polarity(matched: NewsTriggerResult['matchedHeadlines']): string {
  const bull = matched.filter((m) => m.polarity === 'bull').length;
  const bear = matched.filter((m) => m.polarity === 'bear').length;
  return bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'mixed';
}
