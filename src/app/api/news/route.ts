// News API — fetches from multiple free sources:
// 1. RSS feeds (CoinDesk, Cointelegraph, Decrypt) — completely free, no API key
// 2. z-ai web_search — for broader coverage across topics
// Results are merged, deduplicated, and sorted by date.
import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import https from 'node:https';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface NewsItem {
  title: string;
  url: string;
  snippet: string;
  source: string;
  date: string | null;
}

// ---------------------------------------------------------------------------
// RSS feeds — completely free, no API key required.
// These provide real-time structured news with titles, URLs, dates, and
// descriptions directly from the source.
// ---------------------------------------------------------------------------
const RSS_FEEDS: { url: string; source: string; topics: string[] }[] = [
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk', topics: ['crypto', 'all'] },
  { url: 'https://cointelegraph.com/rss', source: 'Cointelegraph', topics: ['crypto', 'all'] },
  { url: 'https://decrypt.co/feed', source: 'Decrypt', topics: ['crypto', 'all'] },
  { url: 'https://www.theblock.co/rss.xml', source: 'The Block', topics: ['crypto', 'all'] },
];

/** Fetch an RSS feed via node:https and parse items from the XML. */
function fetchRssFeed(feedUrl: string, sourceName: string): Promise<NewsItem[]> {
  return new Promise((resolve) => {
    const urlObj = new URL(feedUrl);
    const req = https.get(
      {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OMNISCIENT/1.0)' },
        timeout: 8000,
      },
      (res) => {
        // Follow redirects (301/302)
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirect = res.headers.location;
          if (redirect) {
            fetchRssFeed(redirect, sourceName).then(resolve).catch(() => resolve([]));
            return;
          }
        }
        let xml = '';
        res.on('data', (chunk) => (xml += chunk));
        res.on('end', () => {
          try {
            const items = parseRssXml(xml, sourceName);
            resolve(items);
          } catch {
            resolve([]);
          }
        });
      },
    );
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

/** Parse RSS XML and extract <item> elements. Handles both RSS 2.0 and Atom. */
function parseRssXml(xml: string, sourceName: string): NewsItem[] {
  const items: NewsItem[] = [];
  // Match <item> blocks (RSS 2.0)
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 20) {
    const block = match[0];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link') || extractAttr(block, 'link', 'href');
    const description = extractTag(block, 'description') || extractTag(block, 'summary');
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'dc:date');
    if (title && link) {
      // Clean HTML from description
      const cleanDesc = description
        ? description.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim().slice(0, 300)
        : '';
      const date = pubDate ? parseDate(pubDate) : null;
      items.push({ title: decodeEntities(title).slice(0, 200), url: link, snippet: cleanDesc, source: sourceName, date });
    }
  }
  // Also try Atom <entry> elements
  const entryRegex = /<entry[\s\S]*?<\/entry>/gi;
  while ((match = entryRegex.exec(xml)) !== null && items.length < 20) {
    const block = match[0];
    const title = extractTag(block, 'title');
    const link = extractAttr(block, 'link', 'href') || extractTag(block, 'link');
    const summary = extractTag(block, 'summary') || extractTag(block, 'content');
    const pubDate = extractTag(block, 'published') || extractTag(block, 'updated');
    if (title && link) {
      const cleanDesc = summary
        ? summary.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim().slice(0, 300)
        : '';
      items.push({ title: decodeEntities(title).slice(0, 200), url: link, snippet: cleanDesc, source: sourceName, date: pubDate ? parseDate(pubDate) : null });
    }
  }
  return items;
}

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
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

function parseDate(s: string): string | null {
  try {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/** Deduplicate by URL (keep first occurrence). */
function dedupBy(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    if (seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
const TOPIC_QUERY: Record<string, string> = {
  crypto: 'cryptocurrency bitcoin ethereum crypto market news today',
  forex: 'forex currency market EUR USD JPY news today',
  commodities: 'gold oil silver commodities market news today',
  macro: 'macro economy inflation CPI interest rates central bank news today',
  ipo: 'IPO initial public offering listing market news today',
};

export async function GET(req: NextRequest) {
  const topic = (req.nextUrl.searchParams.get('topic') || 'crypto') as keyof typeof TOPIC_QUERY;
  const query = TOPIC_QUERY[topic] ?? TOPIC_QUERY.crypto;

  try {
    // 1. Fetch from RSS feeds (for crypto topic — feeds are crypto-focused)
    const relevantFeeds = RSS_FEEDS.filter((f) => f.topics.includes(topic) || f.topics.includes('all'));
    const rssPromises = relevantFeeds.map((f) => fetchRssFeed(f.url, f.source));
    const rssResults = await Promise.allSettled(rssPromises);
    const rssItems: NewsItem[] = [];
    for (const r of rssResults) {
      if (r.status === 'fulfilled') rssItems.push(...r.value);
    }

    // 2. Fetch from z-ai web search (for all topics)
    let searchItems: NewsItem[] = [];
    try {
      const zai = await ZAI.create();
      const raw = await zai.functions.invoke('web_search', { query, num: 15, recency_days: 1 });
      searchItems = (Array.isArray(raw) ? raw : []).map((r: any) => ({
        title: r.name || r.title || 'Untitled',
        url: r.url || '',
        snippet: r.snippet || '',
        source: r.host_name || '',
        date: r.date || null,
      }));
    } catch {
      // web search may fail — RSS items still provide news
    }

    // 3. Merge + deduplicate + sort by date (newest first)
    const all = dedupBy([...rssItems, ...searchItems]);
    all.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

    return NextResponse.json<ApiResult<NewsItem[]>>({ success: true, data: all });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e?.message || 'News search failed' },
      { status: 502 },
    );
  }
}
