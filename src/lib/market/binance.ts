// Binance market data client — REST + WebSocket (deepest free crypto data source)
// Public endpoints, no API key required for market data.

import type { Kline, OrderBook, Ticker } from '@/lib/types';

const REST_BASE = 'https://api.binance.com';
const WS_BASE = 'wss://stream.binance.com:9443/ws';

// In-memory cache to reduce API calls + survive intermittent rate-limits.
// Binance blocks batch endpoints (418) from datacenter IPs intermittently,
// so we cache aggressively and fall back to per-symbol requests.
type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

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
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** Fetch with one quick retry (200ms) — keeps total latency low while still surviving transient blips. */
async function fetchJson<T>(url: string, retries = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchJsonUncached<T>(url);
    } catch (e) {
      lastErr = e;
      // 418 = blocked — retrying the SAME batch url won't help, bail fast so caller can fall back.
      if (e instanceof Error && e.message.includes('Binance 418')) throw e;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw lastErr;
}

/** 24h ticker statistics — single symbol. This endpoint is NOT blocked (always 200). */
export async function getTicker24h(symbol: string): Promise<Ticker> {
  const sym = symbol.toUpperCase();
  const cacheKey = `t24:${sym}`;
  const cached = getCached<Ticker>(cacheKey);
  if (cached) return cached;
  const d = await fetchJson<any>(`${REST_BASE}/api/v3/ticker/24hr?symbol=${sym}`);
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
  setCached(cacheKey, t, 10_000); // 10s cache
  return t;
}

/** Tickers for multiple symbols. Batch endpoint is intermittently 418-blocked, so we fall back to parallel per-symbol requests. */
export async function getTickers24h(symbols: string[]): Promise<Ticker[]> {
  if (symbols.length === 0) return [];
  if (symbols.length === 1) return [await getTicker24h(symbols[0])];

  // Return cached-only subset (skip network for fresh ones).
  const upper = symbols.map((s) => s.toUpperCase());

  // Try batch endpoint first (1 attempt — fail fast on 418).
  try {
    const symParam = encodeURIComponent(JSON.stringify(upper));
    const data = await fetchJson<any[]>(`${REST_BASE}/api/v3/ticker/24hr?symbols=${symParam}`);
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
    return tickers;
  } catch {
    // Batch endpoint blocked (418) — fall back to parallel per-symbol requests.
    const results = await Promise.allSettled(upper.map((s) => getTicker24h(s)));
    const tickers: Ticker[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') tickers.push(r.value);
    }
    if (tickers.length === 0) {
      throw new Error('Binance batch + per-symbol fallback both failed');
    }
    return tickers;
  }
}

/** All tickers (for market overview). Falls back to parallel per-symbol requests when batch endpoint is blocked. */
export async function getAllTickers(): Promise<Ticker[]> {
  const cacheKey = 'all:tickers';
  const cached = getCached<Ticker[]>(cacheKey);
  if (cached) return cached;

  try {
    const data = await fetchJson<any[]>(`${REST_BASE}/api/v3/ticker/24hr`);
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
    setCached(cacheKey, tickers, 30_000); // 30s cache for full ticker list
    return tickers;
  } catch {
    // Fall back: use the tracked symbol list from per-symbol calls.
    // We don't know all USDT pairs here, so we use a curated list of top symbols.
    const topSymbols = [
      'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','DOTUSDT',
      'MATICUSDT','TRXUSDT','LTCUSDT','BCHUSDT','ATOMUSDT','UNIUSDT','NEARUSDT','APTUSDT','FILUSDT','ICPUSDT',
      'POLUSDT',
      'ARBUSDT','OPUSDT','INJUSDT','SUIUSDT','SEIUSDT','TIAUSDT','RNDRUSDT','FETUSDT','GALAUSDT','SANDUSDT',
    ];
    const results = await Promise.allSettled(topSymbols.map((s) => getTicker24h(s)));
    const tickers: Ticker[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') tickers.push(r.value);
    }
    if (tickers.length === 0) throw new Error('Binance all-tickers + per-symbol fallback both failed');
    setCached(cacheKey, tickers, 30_000);
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
  const data = await fetchJson<any[]>(
    `${REST_BASE}/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`
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
  const data = await fetchJson<any>(
    `${REST_BASE}/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`
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
  const data = await fetchJson<any>(
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
  const d = await fetchJson<any>(
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
    const data = await fetchJson<any[]>(`${FAPI_BASE}/fapi/v1/premiumIndex`);
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
        const d = await fetchJson<any>(`${FAPI_BASE}/fapi/v1/premiumIndex?symbol=${sym}`);
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
  const data = await fetchJson<any[]>(
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
  const data = await fetchJson<any[]>(
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
  const data = await fetchJson<any[]>(
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
  const data = await fetchJson<any[]>(
    `${REST_BASE}/api/v3/trades?symbol=${symbol.toUpperCase()}&limit=${limit}`
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
