/**
 * Macro data — Yahoo Finance chart fetcher, Fear & Greed, CoinGecko global,
 * er-api forex fallback.
 *
 *  - Native `node:https` for ALL external calls — bypasses Next.js fetch
 *    patching (which adds Cloudflare-fingerprintable headers) and gives us
 *    control over timeouts.
 *  - 5-min cache on Yahoo quotes.
 */
import https from 'node:https';
import type { ApiResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// httpsGet — promise wrapper with timeout
// ---------------------------------------------------------------------------

function httpsGetJson(url: string, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect.
          res.resume();
          httpsGetJson(res.headers.location, timeoutMs).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`JSON parse failed for ${url}: ${(err as Error).message}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  ts: number;
  value: T;
}

const macroCache = new Map<string, CacheEntry<unknown>>();
const MACRO_TTL = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const hit = macroCache.get(key);
  if (hit && Date.now() - hit.ts < MACRO_TTL) return hit.value as T;
  return null;
}

function setCached<T>(key: string, value: T): void {
  macroCache.set(key, { ts: Date.now(), value });
}

// ---------------------------------------------------------------------------
// Yahoo Finance chart fetcher
// ---------------------------------------------------------------------------

export interface YahooQuote {
  symbol: string;
  price: number;
  change?: number;
  changePercent?: number;
  previousClose?: number;
  currency?: string;
  fetchedAt: number;
}

/**
 * Fetch a quote from Yahoo Finance chart API.
 * Symbol examples: ^GSPC (S&P 500), ^DJI, ^IXIC, ^VIX, GC=F (gold),
 * CL=F (crude), EURUSD=X, BTC-USD.
 */
export async function getMacroQuote(symbol: string): Promise<YahooQuote | null> {
  const key = `yahoo:${symbol}`;
  const cached = getCached<YahooQuote>(key);
  if (cached) return cached;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?interval=1d&range=5d`;
    const data = await httpsGetJson(url);
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta || {};
    const closes: number[] = result.indicators?.quote?.[0]?.close?.filter(
      (v: number | null) => v != null,
    ) || [];
    const price = meta.regularMarketPrice ?? (closes.length ? closes[closes.length - 1] : NaN);
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? (closes.length > 1 ? closes[closes.length - 2] : undefined);
    const change = prev != null ? price - prev : undefined;
    const changePercent = prev && prev !== 0 ? (change! / prev) * 100 : undefined;
    const q: YahooQuote = {
      symbol,
      price,
      change,
      changePercent,
      previousClose: prev,
      currency: meta.currency,
      fetchedAt: Date.now(),
    };
    setCached(key, q);
    return q;
  } catch (err) {
    console.error('[macro] getMacroQuote failed for', symbol, err);
    return null;
  }
}

export async function getMacroQuotes(symbols: string[]): Promise<YahooQuote[]> {
  const out = await Promise.all(symbols.map((s) => getMacroQuote(s)));
  return out.filter((q): q is YahooQuote => q !== null);
}

// ---------------------------------------------------------------------------
// Fear & Greed Index (alternative.me)
// ---------------------------------------------------------------------------

export interface FearGreedEntry {
  value: number; // 0..100
  classification: string;
  timestamp: number; // seconds
}

export async function getFearGreed(limit = 1): Promise<FearGreedEntry[]> {
  const key = `fg:${limit}`;
  const cached = getCached<FearGreedEntry[]>(key);
  if (cached) return cached;

  try {
    const url = `https://api.alternative.me/fng/?limit=${limit}`;
    const data = await httpsGetJson(url);
    const arr = Array.isArray(data?.data) ? data.data : [];
    const out: FearGreedEntry[] = arr.map((d: any) => ({
      value: parseInt(d.value, 10),
      classification: d.value_classification,
      timestamp: parseInt(d.timestamp, 10),
    }));
    if (out.length) setCached(key, out);
    return out;
  } catch (err) {
    console.error('[macro] getFearGreed failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// CoinGecko global stats
// ---------------------------------------------------------------------------

export interface GlobalCryptoStats {
  totalMarketCapUsd?: number;
  totalVolumeUsd?: number;
  marketCapChangePercent24h?: number;
  btcDominancePercent?: number;
  ethDominancePercent?: number;
  activeCryptocurrencies?: number;
  fetchedAt: number;
}

export async function getGlobalCryptoStats(): Promise<GlobalCryptoStats | null> {
  const key = 'cg:global';
  const cached = getCached<GlobalCryptoStats>(key);
  if (cached) return cached;

  try {
    const url = 'https://api.coingecko.com/api/v3/global';
    const data = await httpsGetJson(url);
    const d = data?.data;
    if (!d) return null;
    const stats: GlobalCryptoStats = {
      totalMarketCapUsd: d.total_market_cap?.usd,
      totalVolumeUsd: d.total_volume?.usd,
      marketCapChangePercent24h: d.market_cap_change_percentage_24h_usd,
      btcDominancePercent: d.market_cap_percentage?.btc,
      ethDominancePercent: d.market_cap_percentage?.eth,
      activeCryptocurrencies: d.active_cryptocurrencies,
      fetchedAt: Date.now(),
    };
    setCached(key, stats);
    return stats;
  } catch (err) {
    console.error('[macro] getGlobalCryptoStats failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// er-api forex fallback
// ---------------------------------------------------------------------------

export interface ForexQuote {
  base: string;
  quote: string;
  rate: number;
  fetchedAt: number;
}

export async function getForexRate(base: string, quote: string): Promise<ForexQuote | null> {
  const pair = `${base.toUpperCase()}_${quote.toUpperCase()}`;
  const key = `er:${pair}`;
  const cached = getCached<ForexQuote>(key);
  if (cached) return cached;

  try {
    const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(base.toUpperCase())}`;
    const data = await httpsGetJson(url);
    const rate = data?.rates?.[quote.toUpperCase()];
    if (typeof rate !== 'number') return null;
    const fq: ForexQuote = {
      base: base.toUpperCase(),
      quote: quote.toUpperCase(),
      rate,
      fetchedAt: Date.now(),
    };
    setCached(key, fq);
    return fq;
  } catch (err) {
    console.error('[macro] getForexRate failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Convenience envelope (for API routes)
// ---------------------------------------------------------------------------

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function err<T = unknown>(error: string): ApiResult<T> {
  return { ok: false, error };
}
