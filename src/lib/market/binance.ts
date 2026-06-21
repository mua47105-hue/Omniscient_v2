/**
 * Binance REST + WebSocket client.
 *
 *  - Native `fetch` (no axios). Binance public endpoints don't need keys.
 *  - In-memory cache: 10s tickers, 30s klines, 5s orderbook.
 *  - `getTickers24h(symbols)` uses the multi-symbol batch endpoint
 *    `/fapi/v1/ticker/24hr?symbols=[...]`. On HTTP 418 (Binance's "you sent
 *    too many symbols / IP rate-limited" response) we fall back to per-symbol
 *    requests so a single bad batch never breaks the whole scan.
 *  - `subscribeTicker` opens a WebSocket on `wss://stream.binance.com:9443`.
 *  - All numbers are coerced from Binance's string responses.
 */
import type {
  Ticker,
  Kline,
  OrderBook,
  FundingRate,
  OpenInterest,
} from '@/lib/types';

const FAPI_ROOT = 'https://fapi.binance.com';
const API_ROOT = 'https://api.binance.com';
const WS_ROOT = 'wss://stream.binance.com:9443/ws';

// ---------------------------------------------------------------------------
// Tiny cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  ts: number;
  value: T;
}

const TICKER_TTL = 10_000;
const KLINES_TTL = 30_000;
const ORDERBOOK_TTL = 5_000;

const tickerCache = new Map<string, CacheEntry<Ticker>>();
const tickersBatchCache = new Map<string, CacheEntry<Ticker[]>>();
const klinesCache = new Map<string, CacheEntry<Kline[]>>();
const orderbookCache = new Map<string, CacheEntry<OrderBook>>();
const fundingCache = new Map<string, CacheEntry<FundingRate>>();
const oiCache = new Map<string, CacheEntry<OpenInterest>>();

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string, ttl: number): T | null {
  const hit = map.get(key);
  if (hit && Date.now() - hit.ts < ttl) return hit.value;
  return null;
}

function setCached<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  map.set(key, { ts: Date.now(), value });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return NaN;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`Binance ${res.status} ${res.statusText} for ${url}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// REST — Ticker 24h
// ---------------------------------------------------------------------------

function parseTicker24h(raw: any): Ticker {
  return {
    symbol: raw.symbol,
    lastPrice: num(raw.lastPrice),
    priceChange: num(raw.priceChange),
    priceChangePercent: num(raw.priceChangePercent),
    high: num(raw.highPrice),
    low: num(raw.lowPrice),
    volume: num(raw.volume),
    quoteVolume: num(raw.quoteVolume),
    openPrice: num(raw.openPrice),
    closeTime: raw.closeTime,
    fetchedAt: Date.now(),
  };
}

export async function getTicker24h(symbol: string): Promise<Ticker> {
  const key = symbol.toUpperCase();
  const cached = getCached(tickerCache, key, TICKER_TTL);
  if (cached) return cached;

  const raw = await fetchJson(
    `${FAPI_ROOT}/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(key)}`,
  );
  const ticker = parseTicker24h(raw);
  setCached(tickerCache, key, ticker);
  return ticker;
}

export async function getTickers24h(symbols: string[]): Promise<Ticker[]> {
  if (!symbols.length) return [];
  const upper = symbols.map((s) => s.toUpperCase());
  const cacheKey = upper.join(',');
  const cached = getCached(tickersBatchCache, cacheKey, TICKER_TTL);
  if (cached) return cached;

  // Try batch endpoint first.
  try {
    const symbolsParam = encodeURIComponent(JSON.stringify(upper));
    const raw = await fetchJson(
      `${FAPI_ROOT}/fapi/v1/ticker/24hr?symbols=${symbolsParam}`,
    );
    if (Array.isArray(raw)) {
      const out = raw.map(parseTicker24h);
      for (const t of out) setCached(tickerCache, t.symbol, t);
      setCached(tickersBatchCache, cacheKey, out);
      return out;
    }
  } catch (err: any) {
    // 418 = "Malformed" / IP banned from batch — fall back to per-symbol.
    if (err?.status !== 418 && err?.status !== 400) {
      // Network or 5xx — still fall back, but log.
      console.warn('[binance] batch tickers failed, falling back:', err?.message);
    }
  }

  // Per-symbol fallback.
  const results = await Promise.allSettled(upper.map((s) => getTicker24h(s)));
  const out: Ticker[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') out.push(r.value);
  }
  setCached(tickersBatchCache, cacheKey, out);
  return out;
}

export async function getAllTickers(): Promise<Ticker[]> {
  try {
    const raw = await fetchJson(`${FAPI_ROOT}/fapi/v1/ticker/24hr`);
    if (Array.isArray(raw)) {
      const out = raw.map(parseTicker24h);
      for (const t of out) setCached(tickerCache, t.symbol, t);
      return out;
    }
  } catch (err) {
    console.error('[binance] getAllTickers failed:', err);
  }
  return [];
}

// ---------------------------------------------------------------------------
// REST — Klines
// ---------------------------------------------------------------------------

export async function getKlines(
  symbol: string,
  interval = '15m',
  limit = 200,
): Promise<Kline[]> {
  const key = `${symbol.toUpperCase()}|${interval}|${limit}`;
  const cached = getCached(klinesCache, key, KLINES_TTL);
  if (cached) return cached;

  const raw = await fetchJson(
    `${FAPI_ROOT}/fapi/v1/klines?symbol=${encodeURIComponent(
      symbol.toUpperCase(),
    )}&interval=${interval}&limit=${limit}`,
  );
  if (!Array.isArray(raw)) return [];
  const klines: Kline[] = raw.map((k: any[]) => ({
    openTime: k[0],
    open: num(k[1]),
    high: num(k[2]),
    low: num(k[3]),
    close: num(k[4]),
    volume: num(k[5]),
    closeTime: k[6],
    quoteVolume: num(k[7]),
    trades: k[8],
  }));
  setCached(klinesCache, key, klines);
  return klines;
}

// ---------------------------------------------------------------------------
// REST — Order Book
// ---------------------------------------------------------------------------

export async function getOrderBook(
  symbol: string,
  limit = 50,
): Promise<OrderBook> {
  const key = `${symbol.toUpperCase()}|${limit}`;
  const cached = getCached(orderbookCache, key, ORDERBOOK_TTL);
  if (cached) return cached;

  const raw = await fetchJson(
    `${FAPI_ROOT}/fapi/v1/depth?symbol=${encodeURIComponent(
      symbol.toUpperCase(),
    )}&limit=${limit}`,
  );
  const ob: OrderBook = {
    symbol: symbol.toUpperCase(),
    bids: (raw.bids || []).map((b: string[]) => ({ price: num(b[0]), quantity: num(b[1]) })),
    asks: (raw.asks || []).map((a: string[]) => ({ price: num(a[0]), quantity: num(a[1]) })),
    fetchedAt: Date.now(),
  };
  setCached(orderbookCache, key, ob);
  return ob;
}

// ---------------------------------------------------------------------------
// REST — Funding Rate + Open Interest
// ---------------------------------------------------------------------------

export async function getFundingRate(symbol: string): Promise<FundingRate | null> {
  const key = symbol.toUpperCase();
  const cached = getCached(fundingCache, key, TICKER_TTL);
  if (cached) return cached;

  try {
    const raw = await fetchJson(
      `${FAPI_ROOT}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(key)}`,
    );
    const fr: FundingRate = {
      symbol: key,
      fundingRate: num(raw.lastFundingRate),
      markPrice: num(raw.markPrice),
      nextFundingTime: raw.nextFundingTime,
    };
    setCached(fundingCache, key, fr);
    return fr;
  } catch (err) {
    console.error('[binance] getFundingRate failed:', err);
    return null;
  }
}

export async function getOpenInterest(symbol: string): Promise<OpenInterest | null> {
  const key = symbol.toUpperCase();
  const cached = getCached(oiCache, key, TICKER_TTL);
  if (cached) return cached;

  try {
    const raw = await fetchJson(
      `${FAPI_ROOT}/fapi/v1/openInterest?symbol=${encodeURIComponent(key)}`,
    );
    const oi: OpenInterest = {
      symbol: key,
      openInterest: num(raw.openInterest),
      time: raw.time,
    };
    setCached(oiCache, key, oi);
    return oi;
  } catch (err) {
    console.error('[binance] getOpenInterest failed:', err);
    return null;
  }
}

export async function getAllFundingRates(): Promise<FundingRate[]> {
  try {
    const raw = await fetchJson(`${FAPI_ROOT}/fapi/v1/premiumIndex`);
    if (!Array.isArray(raw)) return [];
    const out: FundingRate[] = raw.map((r: any) => ({
      symbol: r.symbol,
      fundingRate: num(r.lastFundingRate),
      markPrice: num(r.markPrice),
      nextFundingTime: r.nextFundingTime,
    }));
    return out;
  } catch (err) {
    console.error('[binance] getAllFundingRates failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// REST — Top Movers (by |priceChangePercent| desc, top N)
// ---------------------------------------------------------------------------

export async function getTopMovers(limit = 10): Promise<Ticker[]> {
  const all = await getAllTickers();
  return all
    .filter((t) => Number.isFinite(t.priceChangePercent) && t.quoteVolume > 0)
    .sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// WebSocket — live ticker
// ---------------------------------------------------------------------------

export function subscribeTicker(
  symbol: string,
  onMessage: (ticker: Ticker) => void,
): { close: () => void } {
  const stream = symbol.toLowerCase() + '@ticker';
  const ws = new WebSocket(`${WS_ROOT}/${stream}`);

  ws.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data as string);
      const ticker: Ticker = {
        symbol: d.s,
        lastPrice: num(d.c),
        priceChange: num(d.p),
        priceChangePercent: num(d.P),
        high: num(d.h),
        low: num(d.l),
        volume: num(d.v),
        quoteVolume: num(d.q),
        openPrice: num(d.o),
        closeTime: d.C,
        fetchedAt: Date.now(),
      };
      setCached(tickerCache, ticker.symbol, ticker);
      onMessage(ticker);
    } catch (err) {
      console.error('[binance] ws parse failed:', err);
    }
  };

  ws.onerror = (e) => console.error('[binance] ws error:', e);

  return {
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}
