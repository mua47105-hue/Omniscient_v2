/**
 * CoinGecko free public API client — trending + top markets.
 *
 * Uses native `node:https` (not `fetch`) to bypass Next.js fetch patching +
 * Cloudflare bot detection — same pattern as the LLM router and Deribit
 * client. 5-minute cache to stay well under CoinGecko's free-tier rate limit
 * (~30 req/min).
 */

import https from 'node:https';

const BASE = 'https://api.coingecko.com';
const API_V3 = `${BASE}/api/v3`;
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrendingCoin {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number | null;
  thumb?: string;
  priceBtc?: number;
}

export interface TopMarket {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  currentPrice: number;
  marketCap: number;
  totalVolume: number;
  priceChangePercentage24h: number;
  marketCapRank: number;
  high24h?: number;
  low24h?: number;
  circulatingSupply?: number;
  ath?: number;
  athChangePercentage?: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  at: number;
  value: T;
}

interface CGGlobal {
  __OMNISCIENT_COINGECKO_CACHE__?: Map<string, CacheEntry<unknown>>;
}

function cacheMap(): Map<string, CacheEntry<unknown>> {
  const g = globalThis as unknown as CGGlobal;
  if (!(g.__OMNISCIENT_COINGECKO_CACHE__ instanceof Map)) {
    g.__OMNISCIENT_COINGECKO_CACHE__ = new Map();
  }
  return g.__OMNISCIENT_COINGECKO_CACHE__!;
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
          'User-Agent': 'OMNISCIENT/1.0 (+coingecko-client)',
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
// Public API
// ---------------------------------------------------------------------------

/**
 * Trending coins (last 24h). Cached 5 min.
 */
export async function getTrending(): Promise<TrendingCoin[]> {
  const key = 'trending';
  const hit = cached<TrendingCoin[]>(key);
  if (hit) return hit;

  const json = await httpsGetJson(`${API_V3}/search/trending`);
  const coins = (json?.coins ?? []).map((c: any) => {
    const item = c?.item ?? {};
    return {
      id: item.id ?? '',
      symbol: (item.symbol ?? '').toString().toUpperCase(),
      name: item.name ?? '',
      marketCapRank: typeof item.market_cap_rank === 'number' ? item.market_cap_rank : null,
      thumb: item.thumb,
      priceBtc: num(item.price_btc),
    } as TrendingCoin;
  });

  return setCached(key, coins);
}

/**
 * Top N markets by market cap. Cached 5 min.
 */
export async function getTopMarkets(limit: number = 10): Promise<TopMarket[]> {
  const key = `top:${limit}`;
  const hit = cached<TopMarket[]>(key);
  if (hit) return hit;

  const url = `${API_V3}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`;
  const json = await httpsGetJson(url);
  const arr = Array.isArray(json) ? json : [];
  const out: TopMarket[] = arr.map((c: any) => ({
    id: c.id ?? '',
    symbol: (c.symbol ?? '').toString().toUpperCase(),
    name: c.name ?? '',
    image: c.image,
    currentPrice: num(c.current_price) ?? 0,
    marketCap: num(c.market_cap) ?? 0,
    totalVolume: num(c.total_volume) ?? 0,
    priceChangePercentage24h: num(c.price_change_percentage_24h) ?? 0,
    marketCapRank: num(c.market_cap_rank) ?? 0,
    high24h: num(c.high_24h),
    low24h: num(c.low_24h),
    circulatingSupply: num(c.circulating_supply),
    ath: num(c.ath),
    athChangePercentage: num(c.ath_change_percentage),
  }));

  return setCached(key, out);
}

function num(x: unknown): number | undefined {
  if (typeof x === 'number') return x;
  if (typeof x === 'string') {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

export function __clearCoinGeckoCacheForTests(): void {
  cacheMap().clear();
}
