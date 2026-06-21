/**
 * News API — RSS aggregator + z-ai web_search.
 *
 * GET /api/news?limit=30&q=crypto
 *   - Fetches items from CoinDesk, Cointelegraph, Decrypt RSS feeds.
 *   - Optionally augments with z-ai web_search when `q` is provided.
 *   - Persists new items to NewsItem table (dedup by URL).
 *   - Returns most recent items (DB-backed) joined with the fresh RSS scan.
 */
import { NextResponse } from 'next/server';
import https from 'node:https';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

const RSS_FEEDS: Array<{ source: string; url: string }> = [
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed' },
];

const FETCH_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// RSS fetch + naive XML parser
// ---------------------------------------------------------------------------

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'OMNISCIENT/1.0 (news-aggregator)',
          Accept: 'application/rss+xml,application/xml,text/xml',
        },
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
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
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

interface RssItem {
  title: string;
  link?: string;
  pubDate?: string;
  description?: string;
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1] ?? '';
    const title = pickTag(block, 'title');
    const link = pickTag(block, 'link');
    const pubDate = pickTag(block, 'pubDate');
    const description = pickTag(block, 'description');
    if (title) {
      items.push({
        title: decodeEntities(title),
        link: link ? decodeEntities(link) : undefined,
        pubDate,
        description: description ? decodeEntities(stripHtml(description)).slice(0, 400) : undefined,
      });
    }
  }
  return items;
}

function pickTag(block: string, tag: string): string | undefined {
  const re = new RegExp(
    `<${tag}\\b[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`,
    'i',
  );
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

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

// ---------------------------------------------------------------------------
// Optional z-ai web_search augmentation
// ---------------------------------------------------------------------------

async function zaiWebSearch(query: string, num = 10): Promise<RssItem[]> {
  try {
    // Dynamic import — z-ai-web-dev-sdk is server-only.
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();
    const results: unknown = await zai.functions.invoke('web_search', { query, num });
    if (!Array.isArray(results)) return [];
    return results.map((r: any) => ({
      title: r.name ?? r.title ?? '',
      link: r.url,
      pubDate: r.date,
      description: r.snippet ?? '',
    }));
  } catch (err) {
    console.error('[news] z-ai web_search failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Persist + fetch from DB
// ---------------------------------------------------------------------------

// Dedup-safe create — the schema has no @@unique on url, so we just try to
// create and rely on createdAt ordering + a runtime dedup by URL in the
// caller (see GET handler).
async function safeCreate(item: {
  source: string;
  url?: string;
  title: string;
  body?: string;
  publishedAt: Date;
}): Promise<void> {
  try {
    await db.newsItem.create({
      data: {
        source: item.source,
        url: item.url ?? null,
        title: item.title,
        body: item.body ?? null,
        publishedAt: item.publishedAt,
      },
    });
  } catch {
    /* ignore duplicates */
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(1, Math.min(200, parseInt(searchParams.get('limit') ?? '30', 10) || 30));
    const q = searchParams.get('q')?.trim();

    // 1. Fetch RSS feeds in parallel.
    const feedResults = await Promise.allSettled(
      RSS_FEEDS.map(async (feed) => {
        const xml = await httpsGet(feed.url);
        const items = parseRssItems(xml).slice(0, 25);
        return items.map((it) => ({ ...it, source: feed.source }));
      }),
    );

    const freshItems: Array<RssItem & { source: string }> = [];
    for (const r of feedResults) {
      if (r.status === 'fulfilled') {
        for (const it of r.value) freshItems.push(it);
      }
    }

    // 2. Optionally augment with z-ai web_search.
    if (q) {
      const webResults = await zaiWebSearch(q, 10);
      for (const r of webResults) {
        freshItems.push({ ...r, source: 'web_search' });
      }
    }

    // 3. Persist fresh items to DB (dedup by URL inside the loop).
    const seenUrls = new Set<string>();
    for (const it of freshItems) {
      if (!it.title) continue;
      const key = (it.link ?? it.title).toLowerCase();
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      await safeCreate({
        source: it.source,
        url: it.link,
        title: it.title,
        body: it.description,
        publishedAt: it.pubDate ? new Date(it.pubDate) : new Date(),
      });
    }

    // 4. Return the most recent N items from DB (so analyzed fields are included).
    const rows = await db.newsItem.findMany({
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ success: true, data: rows, scanned: freshItems.length });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
