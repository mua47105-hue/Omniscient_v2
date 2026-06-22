// Macro market data client — free sources:
// - Yahoo Finance (query1/query2.finance.yahoo.com) for DXY, VIX, Gold, Oil, indices, yields
// - Binance PAXG (Pax Gold) as a gold fallback/proxy (1 PAXG = 1 troy oz gold)
// - alternative.me for Crypto Fear & Greed Index
// - CoinGecko global for BTC dominance + total market cap
// All endpoints are public, no API key required. In-memory cache survives Yahoo rate limits.

import type { Kline } from '@/lib/types';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

import https from 'node:https';

function nativeHttpsGet(url: string, headers: Record<string, string>, timeoutMs = 10000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

// Binance public REST hosts — `api.binance.com` is geo-blocked (451) on cloud
// datacenters (Hugging Face Spaces, etc.); the public mirror
// `data-api.binance.vision` serves the identical API and is NOT geo-blocked.
const BINANCE_HOSTS = [
  'https://api.binance.com',
  'https://data-api.binance.vision',
  'https://api-gcp.binance.com',
];

/** GET a Binance REST path, trying every host in order. Returns first success. */
async function binanceNativeGet(path: string, headers: Record<string, string>, timeoutMs = 10000): Promise<{ status: number; text: string }> {
  let lastRes = { status: 0, text: '' };
  for (const host of BINANCE_HOSTS) {
    try {
      const res = await nativeHttpsGet(`${host}${path}`, headers, timeoutMs);
      // 451/418/403 = geo-blocked → try next host. Other statuses (200, 400, etc.) → return.
      if (res.status === 451 || res.status === 418 || res.status === 403) {
        lastRes = res;
        continue;
      }
      return res;
    } catch {
      // network error → try next host
      continue;
    }
  }
  return lastRes;
}

// --- In-memory cache to survive Yahoo rate limits ---
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

function getCached<T>(key: string): T | null {
  const c = cache.get(key);
  if (c && Date.now() - c.ts < CACHE_TTL) return c.data as T;
  return null;
}
function setCached(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

async function yahooChart(symbol: string, interval = '1d', range = '30d') {
  const cacheKey = `yahoo:${symbol}:${interval}:${range}`;
  const cached = getCached<any>(cacheKey);
  if (cached) return cached;

  const enc = encodeURIComponent(symbol);
  const hosts = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com'];
  let lastErr: unknown;
  for (const host of hosts) {
    const url = `https://${host}/v8/finance/chart/${enc}?interval=${interval}&range=${range}`;
    try {
      const { status, text } = await nativeHttpsGet(url, {
        'User-Agent': UA,
        Accept: 'application/json,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      });
      if (status === 429) {
        lastErr = new Error(`Yahoo 429 for ${symbol}`);
        continue; // try next host
      }
      if (status >= 400 || !status) {
        lastErr = new Error(`Yahoo ${status} for ${symbol}`);
        continue;
      }
      let data: any;
      try { data = JSON.parse(text); } catch { lastErr = new Error(`Yahoo bad JSON for ${symbol}`); continue; }
      const result = data?.chart?.result?.[0];
      if (!result) {
        lastErr = new Error(`Yahoo: no result for ${symbol}`);
        continue;
      }
      const meta = result.meta || {};
      const timestamps: number[] = result.timestamp || [];
      const quote = result.indicators?.quote?.[0] || {};
      const klines: Kline[] = timestamps.map((t, i) => ({
        openTime: t * 1000,
        open: quote.open?.[i] ?? 0,
        high: quote.high?.[i] ?? 0,
        low: quote.low?.[i] ?? 0,
        close: quote.close?.[i] ?? 0,
        volume: quote.volume?.[i] ?? 0,
        closeTime: t * 1000,
      }));
      const out = {
        symbol: meta.symbol || symbol,
        name: meta.shortName || meta.longName || symbol,
        price: meta.regularMarketPrice ?? klines[klines.length - 1]?.close ?? 0,
        previousClose: meta.chartPreviousClose ?? meta.previousClose ?? 0,
        dayHigh: meta.regularMarketDayHigh ?? 0,
        dayLow: meta.regularMarketDayLow ?? 0,
        yearHigh: meta.fiftyTwoWeekHigh ?? 0,
        yearLow: meta.fiftyTwoWeekLow ?? 0,
        currency: meta.currency || 'USD',
        klines,
      };
      setCached(cacheKey, out);
      return out;
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error(`Yahoo: all hosts failed for ${symbol}`);
}

// --- Binance PAXG fallback for gold (1 PAXG = 1 troy oz physical gold) ---
async function binanceGoldProxy(): Promise<{ price: number; changePct: number; prevClose: number }> {
  const cacheKey = 'binance:paxg';
  const cached = getCached<any>(cacheKey);
  if (cached) return cached;
  const { status, text } = await binanceNativeGet('/api/v3/ticker/24hr?symbol=PAXGUSDT', {
    'User-Agent': UA, Accept: 'application/json',
  });
  if (status !== 200) throw new Error(`Binance PAXG ${status}`);
  const d = JSON.parse(text);
  const out = {
    price: parseFloat(d.lastPrice),
    changePct: parseFloat(d.priceChangePercent),
    prevClose: parseFloat(d.prevClosePrice),
  };
  setCached(cacheKey, out);
  return out;
}

export interface MacroQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  yearHigh: number;
  yearLow: number;
  currency: string;
  klines: Kline[];
}

function toQuote(d: Awaited<ReturnType<typeof yahooChart>>): MacroQuote {
  const change = d.price - d.previousClose;
  const changePct = d.previousClose ? (change / d.previousClose) * 100 : 0;
  return {
    symbol: d.symbol,
    name: d.name,
    price: d.price,
    change,
    changePct,
    dayHigh: d.dayHigh,
    dayLow: d.dayLow,
    yearHigh: d.yearHigh,
    yearLow: d.yearLow,
    currency: d.currency,
    klines: d.klines,
  };
}

// Yahoo Finance symbol map
export const MACRO_SYMBOLS = {
  dxy: 'DX-Y.NYB',          // US Dollar Index
  vix: '^VIX',              // CBOE Volatility Index
  gold: 'GC=F',             // Gold futures
  silver: 'SI=F',           // Silver futures
  oil: 'CL=F',              // WTI Crude Oil futures
  brent: 'BZ=F',            // Brent Crude Oil futures
  natgas: 'NG=F',           // Natural Gas futures
  copper: 'HG=F',           // Copper futures
  sp500: '^GSPC',           // S&P 500
  nasdaq: '^IXIC',          // Nasdaq Composite
  dow: '^DJI',              // Dow Jones
  russell: '^RUT',          // Russell 2000
  us10y: '^TNX',            // US 10-Year Treasury Yield
  us2y: '^IRX',             // US 2-Year Treasury Yield (13-week actually)
  btc: 'BTC-USD',           // Bitcoin (Yahoo)
  eth: 'ETH-USD',           // Ethereum (Yahoo)
  // Forex pairs (Yahoo format: EURUSD=X)
  eurusd: 'EURUSD=X',
  gbpusd: 'GBPUSD=X',
  usdjpy: 'USDJPY=X',
  usdchf: 'USDCHF=X',
  audusd: 'AUDUSD=X',
  usdcad: 'USDCAD=X',
  usdinr: 'USDINR=X',
  eurinr: 'EURINR=X',
  // NSE/BSE stocks (Yahoo uses .NS for NSE, .BO for BSE)
  reliance: 'RELIANCE.NS',
  tcs: 'TCS.NS',
  infy: 'INFY.NS',
  hdfcbank: 'HDFCBANK.NS',
  icicibank: 'ICICIBANK.NS',
  sbi: 'SBIN.NS',
  bhartiartl: 'BHARTIARTL.NS',
  itc: 'ITC.NS',
  // US stocks
  aapl: 'AAPL',
  msft: 'MSFT',
  googl: 'GOOGL',
  amzn: 'AMZN',
  nvda: 'NVDA',
  meta: 'META',
  tsla: 'TSLA',
  // Indian indices
  nifty50: '^NSEI',
  banknifty: '^NSEBANK',
  sensex: '^BSESN',
} as const;

export type MacroKey = keyof typeof MACRO_SYMBOLS;

export async function getMacroQuote(key: MacroKey, range = '30d'): Promise<MacroQuote> {
  // Gold fallback: try Yahoo GC=F, fall back to Binance PAXG (1 PAXG = 1 oz gold)
  if (key === 'gold') {
    try {
      return toQuote(await yahooChart(MACRO_SYMBOLS.gold, '1d', range));
    } catch {
      const g = await binanceGoldProxy();
      return {
        symbol: 'PAXG',
        name: 'Gold (PAXG proxy)',
        price: g.price,
        change: g.price - g.prevClose,
        changePct: g.changePct,
        dayHigh: 0,
        dayLow: 0,
        yearHigh: 0,
        yearLow: 0,
        currency: 'USD',
        klines: [],
      };
    }
  }
  // BTC/ETH fallback: try Yahoo, then Binance
  if (key === 'btc' || key === 'eth') {
    try {
      return toQuote(await yahooChart(MACRO_SYMBOLS[key], '1d', range));
    } catch {
      const sym = key === 'btc' ? 'BTCUSDT' : 'ETHUSDT';
      const { status, text } = await binanceNativeGet(`/api/v3/ticker/24hr?symbol=${sym}`, {
        'User-Agent': UA, Accept: 'application/json',
      });
      if (status === 200) {
        const d = JSON.parse(text);
        return {
          symbol: sym,
          name: key === 'btc' ? 'Bitcoin' : 'Ethereum',
          price: parseFloat(d.lastPrice),
          change: parseFloat(d.priceChange),
          changePct: parseFloat(d.priceChangePercent),
          dayHigh: parseFloat(d.highPrice),
          dayLow: parseFloat(d.lowPrice),
          yearHigh: 0,
          yearLow: 0,
          currency: 'USD',
          klines: [],
        };
      }
      throw new Error(`Binance ${sym} ${status}`);
    }
  }
  return toQuote(await yahooChart(MACRO_SYMBOLS[key], '1d', range));
}

export async function getMacroQuotes(keys: MacroKey[], range = '30d'): Promise<Record<string, MacroQuote>> {
  // Sequential fetch with delay to avoid Yahoo 429 rate-limiting
  const out: Record<string, MacroQuote> = {};
  for (const k of keys) {
    try {
      out[k] = await getMacroQuote(k, range);
    } catch (e: any) {
      console.error(`[macro] ${k} failed:`, e.message);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

/** Fetch a quote by raw Yahoo symbol (for assets stored in DB with yahooSymbol in meta) */
export async function getYahooQuoteBySymbol(yahooSymbol: string, range = '5d'): Promise<MacroQuote> {
  const cacheKey = `yahoo:${yahooSymbol}:1d:${range}`;
  const cached = getCached<MacroQuote>(cacheKey);
  if (cached) return cached;
  const result = await yahooChart(yahooSymbol, '1d', range);
  const q = toQuote(result);
  setCached(cacheKey, q);
  return q;
}

// Map of Yahoo symbols that have Binance fallbacks (for rate-limit resilience)
export const BINANCE_FALLBACKS: Record<string, { binanceSymbol: string; name: string }> = {
  'GC=F': { binanceSymbol: 'PAXGUSDT', name: 'Gold (PAXG proxy)' },
  'BTC-USD': { binanceSymbol: 'BTCUSDT', name: 'Bitcoin' },
  'ETH-USD': { binanceSymbol: 'ETHUSDT', name: 'Ethereum' },
};

/** Fetch klines from Binance (daily) for fallback purposes */
async function getBinanceDailyKlines(symbol: string, limit = 200): Promise<Kline[]> {
  const path = `/api/v3/klines?symbol=${symbol}&interval=1d&limit=${limit}`;
  const { status, text } = await binanceNativeGet(path, { 'User-Agent': UA, Accept: 'application/json' });
  if (status !== 200) throw new Error(`Binance klines ${status} for ${symbol}`);
  const data = JSON.parse(text);
  return data.map((k: any[]) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
}

/**
 * Get a quote WITH Binance fallback for gold/BTC/ETH.
 * Tries Yahoo first; if it fails AND the symbol has a Binance fallback, uses Binance klines.
 * Returns a MacroQuote with klines populated for technical analysis.
 */
export async function getQuoteWithFallback(yahooSymbol: string, range = '1y'): Promise<MacroQuote> {
  try {
    return await getYahooQuoteBySymbol(yahooSymbol, range);
  } catch (yahooErr: any) {
    const fallback = BINANCE_FALLBACKS[yahooSymbol];
    if (!fallback) throw yahooErr; // no fallback available, re-throw Yahoo error
    console.log(`[macro] ${yahooSymbol} Yahoo failed (${yahooErr.message}), using Binance fallback ${fallback.binanceSymbol}`);
    const klines = await getBinanceDailyKlines(fallback.binanceSymbol, 200);
    const lastClose = klines[klines.length - 1]?.close ?? 0;
    const prevClose = klines[klines.length - 2]?.close ?? lastClose;
    const change = lastClose - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;
    return {
      symbol: fallback.binanceSymbol,
      name: fallback.name,
      price: lastClose,
      change,
      changePct,
      dayHigh: Math.max(...klines.slice(-1).map((k) => k.high)),
      dayLow: Math.min(...klines.slice(-1).map((k) => k.low)),
      yearHigh: Math.max(...klines.map((k) => k.high)),
      yearLow: Math.min(...klines.map((k) => k.low)),
      currency: 'USD',
      klines,
    };
  }
}

// --- Forex fallback via open.er-api.com (free, no key, no rate limit) ---
// Yahoo forex symbols → currency codes for the er-api lookup
export const FOREX_YAHOO_TO_PAIR: Record<string, { base: string; quote: string; name: string }> = {
  'EURUSD=X': { base: 'EUR', quote: 'USD', name: 'Euro / US Dollar' },
  'GBPUSD=X': { base: 'GBP', quote: 'USD', name: 'British Pound / US Dollar' },
  'USDJPY=X': { base: 'USD', quote: 'JPY', name: 'US Dollar / Japanese Yen' },
  'USDCHF=X': { base: 'USD', quote: 'CHF', name: 'US Dollar / Swiss Franc' },
  'AUDUSD=X': { base: 'AUD', quote: 'USD', name: 'Australian Dollar / US Dollar' },
  'USDCAD=X': { base: 'USD', quote: 'CAD', name: 'US Dollar / Canadian Dollar' },
  'USDINR=X': { base: 'USD', quote: 'INR', name: 'US Dollar / Indian Rupee' },
  'EURINR=X': { base: 'EUR', quote: 'INR', name: 'Euro / Indian Rupee' },
};

/** Fetch forex rates from open.er-api.com (always free, no key, no rate limit) */
async function getForexRateFromErApi(base: string, quote: string): Promise<{ rate: number; prevRate: number }> {
  // Cache the FULL rates object per base currency (er-api returns all rates for the base)
  const cacheKey = `erapi:${base}`;
  const cached = getCached<Record<string, number>>(cacheKey);
  let rates: Record<string, number>;
  if (cached) {
    rates = cached;
  } else {
    const { status, text } = await nativeHttpsGet(`https://open.er-api.com/v6/latest/${base}`, {
      'User-Agent': UA, Accept: 'application/json',
    });
    if (status !== 200) throw new Error(`er-api ${status}`);
    const data = JSON.parse(text);
    rates = data.rates || {};
    setCached(cacheKey, rates);
  }
  const rate = rates[quote];
  if (!rate) throw new Error(`er-api: no rate for ${base}/${quote}`);
  return { rate, prevRate: rate }; // er-api doesn't provide prev close
}

/**
 * Get a forex quote with open.er-api.com fallback.
 * Tries Yahoo first (gives klines for charting); if Yahoo fails, uses er-api for at least the current price.
 */
export async function getForexQuoteWithFallback(yahooSymbol: string, range = '1y'): Promise<MacroQuote> {
  try {
    return await getYahooQuoteBySymbol(yahooSymbol, range);
  } catch (yahooErr: any) {
    const pair = FOREX_YAHOO_TO_PAIR[yahooSymbol];
    if (!pair) throw yahooErr; // not a forex pair, re-throw
    console.log(`[macro] ${yahooSymbol} Yahoo failed (${yahooErr.message}), using er-api fallback`);
    const { rate } = await getForexRateFromErApi(pair.base, pair.quote);
    return {
      symbol: yahooSymbol,
      name: pair.name,
      price: rate,
      change: 0,
      changePct: 0,
      dayHigh: 0,
      dayLow: 0,
      yearHigh: 0,
      yearLow: 0,
      currency: pair.quote,
      klines: [], // no historical data from er-api
    };
  }
}

// --- Alpha Vantage fallback for stocks/indices ---
// Yahoo stock/index symbols → Alpha Vantage symbols
// Alpha Vantage free tier: 25 req/day. Used only when Yahoo fails AND user has configured a key.
export const ALPHAVANTAGE_FALLBACKS: Record<string, { avSymbol: string; name: string }> = {
  // US stocks
  'AAPL': { avSymbol: 'AAPL', name: 'Apple Inc.' },
  'MSFT': { avSymbol: 'MSFT', name: 'Microsoft Corp.' },
  'GOOGL': { avSymbol: 'GOOGL', name: 'Alphabet Inc.' },
  'AMZN': { avSymbol: 'AMZN', name: 'Amazon.com Inc.' },
  'NVDA': { avSymbol: 'NVDA', name: 'NVIDIA Corp.' },
  'META': { avSymbol: 'META', name: 'Meta Platforms' },
  'TSLA': { avSymbol: 'TSLA', name: 'Tesla Inc.' },
  // Indices (Alpha Vantage doesn't support indices directly, but we try)
  '^GSPC': { avSymbol: 'SPY', name: 'S&P 500 (SPY ETF)' },
  '^IXIC': { avSymbol: 'QQQ', name: 'Nasdaq 100 (QQQ ETF)' },
  '^DJI': { avSymbol: 'DIA', name: 'Dow Jones (DIA ETF)' },
};

/** Fetch a stock quote from Alpha Vantage (requires user's API key) */
async function getAlphaVantageQuote(avSymbol: string): Promise<{ price: number; changePct: number; prevClose: number }> {
  // Read the user's Alpha Vantage key from the Setting table
  const { db } = await import('@/lib/db');
  const keyRow = await db.setting.findUnique({ where: { key: 'alpha_vantage_api_key' } });
  const apiKey = keyRow?.value?.replace(/^"|"$/g, ''); // strip JSON quotes
  if (!apiKey || apiKey.startsWith('PASTE_') || apiKey.startsWith('YOUR_')) {
    throw new Error('No Alpha Vantage API key configured');
  }
  const cacheKey = `av:${avSymbol}`;
  const cached = getCached<{ price: number; changePct: number; prevClose: number }>(cacheKey);
  if (cached) return cached;
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${avSymbol}&apikey=${apiKey}`;
  const { status, text } = await nativeHttpsGet(url, { 'User-Agent': UA, Accept: 'application/json' });
  if (status !== 200) throw new Error(`Alpha Vantage ${status}`);
  const data = JSON.parse(text);
  const q = data['Global Quote'];
  if (!q || !q['05. price']) throw new Error('Alpha Vantage: no data (possibly rate limited or invalid key)');
  const price = parseFloat(q['05. price']);
  const changePct = parseFloat(q['10. change percent']?.replace('%', '') || '0');
  const prevClose = parseFloat(q['08. previous close'] || price);
  const out = { price, changePct, prevClose };
  setCached(cacheKey, out);
  return out;
}

/**
 * Get a stock/index quote with Alpha Vantage fallback.
 * Tries Yahoo first (gives klines for charting); if Yahoo fails, uses Alpha Vantage for current price.
 */
export async function getStockQuoteWithFallback(yahooSymbol: string, range = '1y'): Promise<MacroQuote> {
  try {
    return await getYahooQuoteBySymbol(yahooSymbol, range);
  } catch (yahooErr: any) {
    const fb = ALPHAVANTAGE_FALLBACKS[yahooSymbol];
    if (!fb) throw yahooErr; // no fallback available
    console.log(`[macro] ${yahooSymbol} Yahoo failed (${yahooErr.message}), trying Alpha Vantage fallback`);
    try {
      const av = await getAlphaVantageQuote(fb.avSymbol);
      return {
        symbol: yahooSymbol,
        name: fb.name,
        price: av.price,
        change: av.price - av.prevClose,
        changePct: av.changePct,
        dayHigh: 0,
        dayLow: 0,
        yearHigh: 0,
        yearLow: 0,
        currency: 'USD',
        klines: [], // Alpha Vantage free tier doesn't give daily klines efficiently
      };
    } catch (avErr: any) {
      console.error(`[macro] ${yahooSymbol} Alpha Vantage also failed:`, avErr.message);
      throw yahooErr; // throw the original Yahoo error
    }
  }
}

/** Fetch quotes for many Yahoo symbols sequentially (rate-limit safe) */
export async function getYahooQuotesBySymbol(
  symbols: string[],
  range = '5d'
): Promise<Record<string, MacroQuote>> {
  const out: Record<string, MacroQuote> = {};
  for (const sym of symbols) {
    try {
      out[sym] = await getYahooQuoteBySymbol(sym, range);
    } catch (e: any) {
      console.error(`[macro] ${sym} failed:`, e.message);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

// --- Fear & Greed Index (crypto) ---
export interface FearGreed {
  value: number;          // 0-100
  classification: string; // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
  timestamp: number;
  history: { value: number; classification: string; timestamp: number }[];
}

export async function getFearGreed(limit = 30): Promise<FearGreed> {
  const cacheKey = `feargreed:${limit}`;
  const cached = getCached<FearGreed>(cacheKey);
  if (cached) return cached;
  const { status, text } = await nativeHttpsGet(`https://api.alternative.me/fng/?limit=${limit}`, {
    'User-Agent': UA, Accept: 'application/json',
  });
  if (status !== 200) throw new Error(`FearGreed ${status}`);
  const data = JSON.parse(text);
  const arr: any[] = data.data || [];
  const latest = arr[0] || {};
  const out: FearGreed = {
    value: parseInt(latest.value || '50'),
    classification: latest.value_classification || 'Neutral',
    timestamp: parseInt(latest.timestamp || '0'),
    history: arr.map((d) => ({
      value: parseInt(d.value),
      classification: d.value_classification,
      timestamp: parseInt(d.timestamp),
    })),
  };
  setCached(cacheKey, out);
  return out;
}

// --- BTC Dominance proxy (from CoinGecko global) ---
export interface GlobalCryptoStats {
  totalMarketCap: number;
  totalVolume: number;
  btcDominance: number;
  ethDominance: number;
  marketCapChangePct24h: number;
  activeCryptos: number;
}

export async function getGlobalCryptoStats(): Promise<GlobalCryptoStats> {
  const cacheKey = 'coingecko:global';
  const cached = getCached<GlobalCryptoStats>(cacheKey);
  if (cached) return cached;

  // --- Source 1: CoinGecko /global (richest data — BTC dominance, mcap change) ---
  try {
    const { status, text } = await nativeHttpsGet('https://api.coingecko.com/api/v3/global', {
      'User-Agent': UA, Accept: 'application/json',
    });
    if (status === 200) {
      const data = JSON.parse(text);
      const d = data.data;
      const out: GlobalCryptoStats = {
        totalMarketCap: d.total_market_cap?.usd ?? 0,
        totalVolume: d.total_volume?.usd ?? 0,
        btcDominance: d.market_cap_percentage?.btc ?? 0,
        ethDominance: d.market_cap_percentage?.eth ?? 0,
        marketCapChangePct24h: d.market_cap_change_percentage_24h_usd ?? 0,
        activeCryptos: d.active_cryptocurrencies ?? 0,
      };
      setCached(cacheKey, out);
      return out;
    }
    console.error(`[macro] CoinGecko global returned ${status}`);
  } catch (e: any) {
    console.error('[macro] CoinGecko global failed:', e.message);
  }

  // --- Source 2: CoinGecko /coins/markets (works when /global is rate-limited;
  //     derive dominance from per-coin market caps). This is the path that
  //     survives HF Spaces shared-IP rate limiting. ---
  try {
    const { status, text } = await nativeHttpsGet(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h',
      { 'User-Agent': UA, Accept: 'application/json' }
    );
    if (status === 200) {
      const coins: any[] = JSON.parse(text);
      const totalMarketCap = coins.reduce((s, c) => s + (c.market_cap ?? 0), 0);
      const totalVolume = coins.reduce((s, c) => s + (c.total_volume ?? 0), 0);
      const btc = coins.find((c) => (c.symbol || '').toUpperCase() === 'BTC');
      const eth = coins.find((c) => (c.symbol || '').toUpperCase() === 'ETH');
      const btcMcap = btc?.market_cap ?? 0;
      const ethMcap = eth?.market_cap ?? 0;
      const avgChange = coins.length
        ? coins.reduce((s, c) => s + (c.price_change_percentage_24h ?? 0), 0) / coins.length
        : 0;
      const out: GlobalCryptoStats = {
        totalMarketCap,
        totalVolume,
        btcDominance: totalMarketCap > 0 ? (btcMcap / totalMarketCap) * 100 : 0,
        ethDominance: totalMarketCap > 0 ? (ethMcap / totalMarketCap) * 100 : 0,
        marketCapChangePct24h: avgChange,
        activeCryptos: coins.length,
      };
      setCached(cacheKey, out);
      return out;
    }
    console.error(`[macro] CoinGecko markets returned ${status}`);
  } catch (e: any) {
    console.error('[macro] CoinGecko markets fallback failed:', e.message);
  }

  // --- Source 3: Binance (only works when not geo-blocked — e.g. local dev) ---
  try {
    const { status, text } = await binanceNativeGet('/api/v3/ticker/24hr', {
      'User-Agent': UA, Accept: 'application/json',
    });
    if (status === 200) {
      const tickers: any[] = JSON.parse(text);
      const usdtPairs = tickers.filter((t) => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 1_000_000);
      const totalVolume = usdtPairs.reduce((s, t) => s + parseFloat(t.quoteVolume), 0);
      const btc = usdtPairs.find((t) => t.symbol === 'BTCUSDT');
      const eth = usdtPairs.find((t) => t.symbol === 'ETHUSDT');
      const btcVol = btc ? parseFloat(btc.quoteVolume) : 0;
      const ethVol = eth ? parseFloat(eth.quoteVolume) : 0;
      const out: GlobalCryptoStats = {
        totalMarketCap: totalVolume * 4.5, // rough proxy: 24h volume × ~4.5x = market cap approximation
        totalVolume,
        btcDominance: totalVolume > 0 ? (btcVol / totalVolume) * 100 : 0,
        ethDominance: totalVolume > 0 ? (ethVol / totalVolume) * 100 : 0,
        marketCapChangePct24h: usdtPairs.length
          ? usdtPairs.reduce((s, t) => s + parseFloat(t.priceChangePercent), 0) / usdtPairs.length
          : 0,
        activeCryptos: usdtPairs.length,
      };
      setCached(cacheKey, out);
      return out;
    }
  } catch (e: any) {
    console.error('[macro] Binance global fallback failed:', e.message);
  }
  throw new Error('Global crypto stats unavailable (CoinGecko global + CoinGecko markets + Binance all failed)');
}
