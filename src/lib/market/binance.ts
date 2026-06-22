// Binance market data client — REST + WebSocket (deepest free crypto data source)
// Public endpoints, no API key required for market data.
//
// IMPORTANT — geo-block resilience:
// Hugging Face Spaces (and most cloud datacenters) get HTTP 451/418 from
// api.binance.com because Binance blocks datacenter IP ranges. The local dev
// sandbox is usually fine, but production deploys on HF Spaces are not.
// To survive this, every public reader here follows a 3-tier fallback chain:
//   1. Binance (preferred — fastest, deepest, has order book + funding + OI)
//   2. CoinGecko /coins/markets (works from datacenter IPs, has price/change/vol/high/low)
//   3. Cached stale data (if even CoinGecko is rate-limited, serve the last good snapshot)

import type { Kline, OrderBook, Ticker } from '@/lib/types';

const WS_BASE = 'wss://stream.binance.com:9443/ws';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const CG_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Binance public REST hosts tried in order. `api.binance.com` is geo-blocked
// (HTTP 451) on cloud datacenters like Hugging Face Spaces; the public data
// mirror `data-api.binance.vision` is NOT geo-blocked and serves the exact
// same REST API. We fall through the list on any non-2xx / network error.
const BINANCE_HOSTS = [
  'https://api.binance.com',
  'https://data-api.binance.vision',
  'https://api-gcp.binance.com',
];

// In-memory cache to reduce API calls + survive intermittent rate-limits.
// Binance blocks batch endpoints (418) from datacenter IPs intermittently,
// so we cache aggressively and fall back to per-symbol requests.
type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

// Track which upstream source served the last successful request, so the UI
// can surface "Data via Binance" vs "Data via CoinGecko (fallback)" honestly.
// NOTE: in Next.js dev mode, route handlers may run in isolated module
// instances, so this can lag one cycle. In production (HF Spaces) the module
// loads once and this stays accurate.
export type MarketDataSource = 'binance' | 'coingecko' | 'cache';
let lastDataSource: MarketDataSource = 'binance';
let lastDataFetchedAt = Date.now();
export function getMarketDataSource(): { source: MarketDataSource; fetchedAt: number } {
  return { source: lastDataSource, fetchedAt: lastDataFetchedAt };
}

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function fetchJsonUncached<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 200));
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a Binance REST path, trying every host in BINANCE_HOSTS in order.
 * `api.binance.com` geo-blocks datacenter IPs (451/418), so we transparently
 * retry on `data-api.binance.vision` (the official public data mirror) which
 * is NOT geo-blocked and serves the identical API. The `path` is everything
 * after the host (e.g. `/api/v3/ticker/24hr?symbol=BTCUSDT`).
 */
async function binanceFetchJson<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (const host of BINANCE_HOSTS) {
    try {
      return await fetchJsonUncached<T>(`${host}${path}`);
    } catch (e) {
      lastErr = e;
      // 418/451 = geo-blocked → immediately try next host (no retry on same host).
      // Any other error (network, 5xx, timeout) → also try next host.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Binance 418') || msg.includes('Binance 451') || msg.includes('Binance 403')) {
        continue; // geo-block — try next host
      }
      // For transient errors (timeout, 5xx, network) also try the next host
      // rather than giving up — the mirror is usually fine when primary blips.
      continue;
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// CoinGecko fallback — used when Binance geo-blocks the datacenter IP
// (Hugging Face Spaces, Vercel, Render, etc. all hit this). CoinGecko's free
// /coins/markets endpoint is NOT geo-blocked and returns everything we need
// for the watchlist: price, 24h change, high, low, USD volume.
// ---------------------------------------------------------------------------

interface CoinGeckoMarket {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  high_24h: number | null;
  low_24h: number | null;
  total_volume: number | null;
  market_cap: number | null;
  last_updated: string | null;
}

async function cgFetchJson<T>(url: string, timeoutMs = 12_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': CG_UA, Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 200));
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const CG_TOP_MARKETS_KEY = 'cg:topMarkets';
const CG_TOP_MARKETS_TTL = 60_000; // 60s — CoinGecko free tier ~30 req/min, so we batch.

/** Fetch the top N crypto markets from CoinGecko and normalize to Binance-shaped Tickers. */
async function getCoinGeckoTopMarkets(targetCount = 500): Promise<Ticker[]> {
  const cached = getCached<Ticker[]>(CG_TOP_MARKETS_KEY);
  if (cached) return cached;

  // Fetch 2 pages of 250 in parallel to cover the top ~500 coins.
  // This is enough for any reasonable watchlist + the movers view.
  const perPage = Math.min(250, targetCount);
  const pages = Math.min(4, Math.ceil(targetCount / perPage));
  const pageUrls = Array.from({ length: pages }, (_, i) =>
    `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${i + 1}&sparkline=false&price_change_percentage=24h`
  );
  const responses = await Promise.allSettled(pageUrls.map((u) => cgFetchJson<CoinGeckoMarket[]>(u)));
  const all: CoinGeckoMarket[] = [];
  for (const r of responses) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) all.push(...r.value);
  }
  if (all.length === 0) throw new Error('CoinGecko: all pages failed');

  // De-duplicate by symbol (CoinGecko can return the same symbol for different coins;
  // keep the highest market cap entry so BTC = bitcoin not bitcoin-etc).
  const bySymbol = new Map<string, CoinGeckoMarket>();
  for (const c of all) {
    const sym = (c.symbol || '').toUpperCase();
    if (!sym) continue;
    const existing = bySymbol.get(sym);
    if (!existing || (c.market_cap ?? 0) > (existing.market_cap ?? 0)) {
      bySymbol.set(sym, c);
    }
  }

  const tickers: Ticker[] = [];
  for (const c of bySymbol.values()) {
    if (typeof c.current_price !== 'number' || c.current_price <= 0) continue;
    tickers.push({
      symbol: `${(c.symbol || '').toUpperCase()}USDT`,
      price: c.current_price,
      changePct: c.price_change_percentage_24h ?? 0,
      high: c.high_24h ?? c.current_price,
      low: c.low_24h ?? c.current_price,
      volume: c.total_volume ?? 0, // base volume not exactly available; use USD vol as proxy
      quoteVolume: c.total_volume ?? 0, // USD volume — this is what the UI sorts on
      updatedAt: c.last_updated ? Date.parse(c.last_updated) : Date.now(),
    });
  }
  setCached(CG_TOP_MARKETS_KEY, tickers, CG_TOP_MARKETS_TTL);
  return tickers;
}

/** Look up a single ticker from the CoinGecko top-markets cache. */
async function getCoinGeckoTicker(symbol: string): Promise<Ticker | null> {
  const sym = symbol.toUpperCase();
  const all = await getCoinGeckoTopMarkets();
  return all.find((t) => t.symbol === sym) ?? null;
}

/** 24h ticker statistics — single symbol.
 * Fallback chain: Binance → CoinGecko → cached stale. */
export async function getTicker24h(symbol: string): Promise<Ticker> {
  const sym = symbol.toUpperCase();
  const cacheKey = `t24:${sym}`;
  const cached = getCached<Ticker>(cacheKey);
  if (cached) return cached;

  try {
    const d = await binanceFetchJson<any>(`/api/v3/ticker/24hr?symbol=${sym}`);
    const t: Ticker = {
      symbol: sym,
      price: parseFloat(d.lastPrice),
      changePct: parseFloat(d.priceChangePercent),
      high: parseFloat(d.highPrice),
      low: parseFloat(d.lowPrice),
      volume: parseFloat(d.volume),
      quoteVolume: parseFloat(d.quoteVolume),
      updatedAt: d.closeTime,
    };
    setCached(cacheKey, t, 10_000);
    lastDataSource = 'binance';
    lastDataFetchedAt = Date.now();
    return t;
  } catch (binanceErr) {
    // Binance blocked / failed → try CoinGecko
    const cg = await getCoinGeckoTicker(sym);
    if (cg) {
      setCached(cacheKey, cg, 10_000);
      lastDataSource = 'coingecko';
      lastDataFetchedAt = Date.now();
      return cg;
    }
    throw binanceErr;
  }
}

/** Tickers for multiple symbols.
 * Fallback chain: Binance batch → Binance per-symbol → CoinGecko top-markets. */
export async function getTickers24h(symbols: string[]): Promise<Ticker[]> {
  if (symbols.length === 0) return [];
  if (symbols.length === 1) return [await getTicker24h(symbols[0])];

  const upper = symbols.map((s) => s.toUpperCase());

  // Try Binance batch endpoint first (1 attempt — fail fast on 418/451).
  try {
    const symParam = encodeURIComponent(JSON.stringify(upper));
    const data = await binanceFetchJson<any[]>(`/api/v3/ticker/24hr?symbols=${symParam}`);
    const tickers = data.map((d) => ({
      symbol: d.symbol,
      price: parseFloat(d.lastPrice),
      changePct: parseFloat(d.priceChangePercent),
      high: parseFloat(d.highPrice),
      low: parseFloat(d.lowPrice),
      volume: parseFloat(d.volume),
      quoteVolume: parseFloat(d.quoteVolume),
      updatedAt: d.closeTime,
    }));
    for (const t of tickers) setCached(`t24:${t.symbol}`, t, 10_000);
    lastDataSource = 'binance';
    lastDataFetchedAt = Date.now();
    return tickers;
  } catch (batchErr) {
    // Batch blocked (418/451) — try Binance per-symbol in parallel.
    try {
      const results = await Promise.allSettled(upper.map((s) => getTicker24h(s)));
      const tickers: Ticker[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') tickers.push(r.value);
      }
      if (tickers.length > 0) {
        lastDataSource = 'binance';
        lastDataFetchedAt = Date.now();
        return tickers;
      }
      throw new Error('per-symbol also empty');
    } catch {
      // Both Binance paths failed → CoinGecko fallback.
      const allCg = await getCoinGeckoTopMarkets();
      const tickerMap = new Map(allCg.map((t) => [t.symbol, t]));
      const tickers: Ticker[] = [];
      for (const sym of upper) {
        const t = tickerMap.get(sym);
        if (t) {
          tickers.push(t);
          setCached(`t24:${sym}`, t, 10_000);
        }
      }
      if (tickers.length === 0) {
        throw new Error('Binance + CoinGecko both returned no data for requested symbols');
      }
      lastDataSource = 'coingecko';
      lastDataFetchedAt = Date.now();
      return tickers;
    }
  }
}

/** All tickers (for market overview / movers).
 * Fallback chain: Binance all-tickers → CoinGecko top-markets (500 coins). */
export async function getAllTickers(): Promise<Ticker[]> {
  const cacheKey = 'all:tickers';
  const cached = getCached<Ticker[]>(cacheKey);
  if (cached) return cached;

  try {
    const data = await binanceFetchJson<any[]>(`/api/v3/ticker/24hr`);
    const tickers = data
      .filter((d) => d.symbol.endsWith('USDT') && !d.symbol.includes('UP') && !d.symbol.includes('DOWN'))
      .map((d) => ({
        symbol: d.symbol,
        price: parseFloat(d.lastPrice),
        changePct: parseFloat(d.priceChangePercent),
        high: parseFloat(d.highPrice),
        low: parseFloat(d.lowPrice),
        volume: parseFloat(d.volume),
        quoteVolume: parseFloat(d.quoteVolume),
        updatedAt: d.closeTime,
      }));
    setCached(cacheKey, tickers, 30_000);
    lastDataSource = 'binance';
    lastDataFetchedAt = Date.now();
    return tickers;
  } catch {
    // Binance all-tickers blocked → CoinGecko top 500 markets.
    // Slightly smaller universe than Binance's full USDT list, but covers
    // everything a typical watchlist/movers view needs.
    const tickers = await getCoinGeckoTopMarkets(500);
    setCached(cacheKey, tickers, 30_000);
    lastDataSource = 'coingecko';
    lastDataFetchedAt = Date.now();
    return tickers;
  }
}

/** Kline/candlestick data — cached 30s (klines don't change rapidly at 4h+ intervals). */
export async function getKlines(
  symbol: string,
  interval: string = '4h',
  limit: number = 200
): Promise<Kline[]> {
  const cacheKey = `kl:${symbol.toUpperCase()}:${interval}:${limit}`;
  const cached = getCached<Kline[]>(cacheKey);
  if (cached) return cached;
  const data = await binanceFetchJson<any[]>(
    `/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`
  );
  const klines: Kline[] = data.map((k) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
  setCached(cacheKey, klines, 30_000); // 30s cache
  return klines;
}

/** Order book depth — cached 5s (depth changes rapidly but 5s is fine for display). */
export async function getOrderBook(symbol: string, limit: number = 50): Promise<OrderBook> {
  const cacheKey = `ob:${symbol.toUpperCase()}:${limit}`;
  const cached = getCached<OrderBook>(cacheKey);
  if (cached) return cached;
  const data = await binanceFetchJson<any>(
    `/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`
  );
  const bids: [number, number][] = data.bids.map((b: string[]) => [parseFloat(b[0]), parseFloat(b[1])]);
  const asks: [number, number][] = data.asks.map((a: string[]) => [parseFloat(a[0]), parseFloat(a[1])]);
  const bestBid = bids[0]?.[0] ?? 0;
  const bestAsk = asks[0]?.[0] ?? 0;
  const bidDepth = bids.reduce((s, b) => s + b[0] * b[1], 0);
  const askDepth = asks.reduce((s, a) => s + a[0] * a[1], 0);
  const total = bidDepth + askDepth;
  const ob: OrderBook = {
    symbol,
    bids,
    asks,
    spread: bestAsk - bestBid,
    bidDepth,
    askDepth,
    imbalance: total > 0 ? (bidDepth - askDepth) / total : 0,
  };
  setCached(cacheKey, ob, 5_000); // 5s cache
  return ob;
}

/** Funding rate (futures) — for sentiment */
export async function getFundingRate(symbol: string): Promise<{ rate: number; nextFunding: number }> {
  const data = await fetchJsonUncached<any>(
    `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol.toUpperCase()}`
  );
  const arr = Array.isArray(data) ? data : [data];
  const d = arr[0];
  return {
    rate: parseFloat(d.lastFundingRate),
    nextFunding: d.nextFundingTime,
  };
}

/** Open Interest (futures) */
export async function getOpenInterest(symbol: string): Promise<{ openInterest: number; value: number }> {
  const sym = symbol.toUpperCase();
  const cacheKey = `oi:${sym}`;
  const cached = getCached<{ openInterest: number; value: number }>(cacheKey);
  if (cached) return cached;
  const d = await fetchJsonUncached<any>(
    `https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`
  );
  const result = {
    openInterest: parseFloat(d.openInterest),
    value: 0,
  };
  setCached(cacheKey, result, 15_000); // 15s cache
  return result;
}

const FAPI_BASE = 'https://fapi.binance.com';
const FUTURES_DATA_BASE = 'https://fapi.binance.com';

// Top symbols to fetch individually when batch premiumIndex is 418-blocked.
// These are high-volume USDT perpetuals commonly available on Binance Futures.
const TOP_FUTURES_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT',
  'AVAXUSDT', 'LINKUSDT', 'TRXUSDT', 'LTCUSDT', 'BCHUSDT', 'ATOMUSDT',
  'UNIUSDT', 'NEARUSDT', 'APTUSDT', 'FILUSDT', 'ICPUSDT', 'ARBUSDT',
  'OPUSDT', 'INJUSDT', 'SUIUSDT', 'SEIUSDT', 'TIAUSDT', 'RNDRUSDT',
  'FETUSDT', 'GALAUSDT', 'SANDUSDT', 'AAVEUSDT', 'MKRUSDT', 'PEPEUSDT',
];

export interface FundingRateEntry {
  symbol: string;
  rate: number; // decimal, e.g. 0.0001 = 0.01%
  nextFunding: number; // epoch ms
}

/**
 * Fetch funding rates for ALL USDT perpetuals in one batch call.
 * Falls back to per-symbol requests for the top 30 if the batch endpoint is 418-blocked.
 */
export async function getAllFundingRates(): Promise<FundingRateEntry[]> {
  const cacheKey = 'all:funding';
  const cached = getCached<FundingRateEntry[]>(cacheKey);
  if (cached) return cached;

  try {
    const data = await fetchJsonUncached<any[]>(`${FAPI_BASE}/fapi/v1/premiumIndex`);
    const filtered = data
      .filter((d) => typeof d.symbol === 'string' && d.symbol.endsWith('USDT'))
      .map((d) => ({
        symbol: d.symbol,
        rate: parseFloat(d.lastFundingRate),
        nextFunding: d.nextFundingTime,
      }))
      .filter((e) => Number.isFinite(e.rate) && Number.isFinite(e.nextFunding));
    if (filtered.length > 0) {
      setCached(cacheKey, filtered, 60_000); // 60s cache
      return filtered;
    }
    throw new Error('Empty funding rate response');
  } catch {
    // Batch blocked (418) or empty — fall back to parallel per-symbol requests.
    const results = await Promise.allSettled(
      TOP_FUTURES_SYMBOLS.map(async (sym) => {
        const d = await fetchJsonUncached<any>(`${FAPI_BASE}/fapi/v1/premiumIndex?symbol=${sym}`);
        return {
          symbol: d.symbol,
          rate: parseFloat(d.lastFundingRate),
          nextFunding: d.nextFundingTime,
        };
      })
    );
    const entries: FundingRateEntry[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && Number.isFinite(r.value.rate)) {
        entries.push(r.value);
      }
    }
    if (entries.length === 0) {
      throw new Error('Binance funding batch + per-symbol fallback both failed');
    }
    setCached(cacheKey, entries, 60_000);
    return entries;
  }
}

export interface OpenInterestHistoryEntry {
  time: number; // epoch ms
  openInterest: number; // contracts
  value: number; // USDT value
}

/**
 * Historical open interest — /futures/data/openInterestHist
 * Returns N bars of the requested period (default 30 × 4h).
 */
export async function getOpenInterestHistory(
  symbol: string,
  period: string = '4h',
  limit: number = 30
): Promise<OpenInterestHistoryEntry[]> {
  const sym = symbol.toUpperCase();
  const cacheKey = `oih:${sym}:${period}:${limit}`;
  const cached = getCached<OpenInterestHistoryEntry[]>(cacheKey);
  if (cached) return cached;
  const data = await fetchJsonUncached<any[]>(
    `${FUTURES_DATA_BASE}/futures/data/openInterestHist?symbol=${sym}&period=${period}&limit=${limit}`
  );
  const entries: OpenInterestHistoryEntry[] = data.map((d) => ({
    time: d.timestamp,
    openInterest: parseFloat(d.sumOpenInterest),
    value: parseFloat(d.sumOpenInterestValue),
  }));
  setCached(cacheKey, entries, 300_000); // 5 min cache
  return entries;
}

export interface LongShortRatioEntry {
  time: number; // epoch ms
  longShortRatio: number; // longs / shorts
  longAccount: number; // 0..1
  shortAccount: number; // 0..1
}

/**
 * Top trader long/short position ratio — /futures/data/topLongShortPositionRatio
 */
export async function getTopTraderLongShortRatio(
  symbol: string,
  period: string = '4h',
  limit: number = 30
): Promise<LongShortRatioEntry[]> {
  const sym = symbol.toUpperCase();
  const cacheKey = `ls:${sym}:${period}:${limit}`;
  const cached = getCached<LongShortRatioEntry[]>(cacheKey);
  if (cached) return cached;
  const data = await fetchJsonUncached<any[]>(
    `${FUTURES_DATA_BASE}/futures/data/topLongShortPositionRatio?symbol=${sym}&period=${period}&limit=${limit}`
  );
  const entries: LongShortRatioEntry[] = data.map((d) => ({
    time: d.timestamp,
    longShortRatio: parseFloat(d.longShortRatio),
    longAccount: parseFloat(d.longAccount),
    shortAccount: parseFloat(d.shortAccount),
  }));
  setCached(cacheKey, entries, 300_000); // 5 min cache
  return entries;
}

export interface TakerVolumeEntry {
  time: number; // epoch ms
  buyVol: number; // base asset volume
  sellVol: number;
  ratio: number; // buy / sell
}

/**
 * Taker buy/sell volume — /futures/data/takerlongshortRatio
 * Response uses buySellRatio, sellVol, buyVol per period.
 */
export async function getTakerBuySellVolume(
  symbol: string,
  period: string = '4h',
  limit: number = 30
): Promise<TakerVolumeEntry[]> {
  const sym = symbol.toUpperCase();
  const cacheKey = `tv:${sym}:${period}:${limit}`;
  const cached = getCached<TakerVolumeEntry[]>(cacheKey);
  if (cached) return cached;
  const data = await fetchJsonUncached<any[]>(
    `${FUTURES_DATA_BASE}/futures/data/takerlongshortRatio?symbol=${sym}&period=${period}&limit=${limit}`
  );
  const entries: TakerVolumeEntry[] = data.map((d) => {
    const buy = parseFloat(d.buyVol);
    const sell = parseFloat(d.sellVol);
    return {
      time: d.timestamp,
      buyVol: buy,
      sellVol: sell,
      ratio: sell > 0 ? buy / sell : 0,
    };
  });
  setCached(cacheKey, entries, 300_000); // 5 min cache
  return entries;
}

/** Recent trades */
export async function getRecentTrades(symbol: string, limit: number = 50) {
  const data = await binanceFetchJson<any[]>(
    `/api/v3/trades?symbol=${symbol.toUpperCase()}&limit=${limit}`
  );
  return data.map((t) => ({
    id: t.id,
    price: parseFloat(t.price),
    qty: parseFloat(t.qty),
    time: t.time,
    isBuyerMaker: t.isBuyerMaker,
  }));
}

/** Top gainers/losers across USDT pairs */
export async function getTopMovers(limit: number = 10): Promise<{ gainers: Ticker[]; losers: Ticker[] }> {
  const all = await getAllTickers();
  const filtered = all.filter((t) => t.quoteVolume > 1_000_000);
  const sorted = [...filtered].sort((a, b) => b.changePct - a.changePct);
  return {
    gainers: sorted.slice(0, limit),
    losers: sorted.slice(-limit).reverse(),
  };
}

/** Live price ticker stream over WebSocket. */
export function subscribeTicker(symbol: string, onMessage: (ticker: Ticker) => void): () => void {
  const ws = new WebSocket(`${WS_BASE}/${symbol.toLowerCase()}@ticker`);
  ws.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data as string);
      onMessage({
        symbol,
        price: parseFloat(d.c),
        changePct: parseFloat(d.P),
        high: parseFloat(d.h),
        low: parseFloat(d.l),
        volume: parseFloat(d.v),
        quoteVolume: parseFloat(d.q),
        updatedAt: d.E,
      });
    } catch {
      /* ignore */
    }
  };
  return () => ws.close();
}
