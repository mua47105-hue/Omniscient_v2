// Multi-source market data fallback chain for stocks, indices, forex, commodities.
//
// WHY THIS EXISTS:
// Yahoo Finance rate-limits shared datacenter IPs (HTTP 429) — on Hugging Face
// Spaces, every macro quote fails. This module provides a 4-source fallback
// chain so the macro page, markets scan, and correlation views keep working
// even when Yahoo is down.
//
// SOURCES (in priority order):
//   1. Yahoo Finance (free, no key — but rate-limited on datacenter IPs)
//   2. Twelve Data (free: 800 req/day, 8 req/min — has time_series + quote)
//   3. Alpha Vantage (free: 25 req/day — has GLOBAL_QUOTE + TIME_SERIES_DAILY)
//   4. Tiingo (free: 1000 req/day — has daily prices + quotes)
//   5. Finnhub (free: 60 req/min — has quote + candle)
//
// Each source is tried in order. The first one that returns valid data wins.
// API keys are read from the Setting table (set in Settings → Data Sources)
// or from HF Space Secrets (env vars).
//
// All sources return a normalized MacroQuote so callers don't need to know
// which source served the data.

import type { Kline } from '@/lib/types';
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';
import { HF_SECRETS } from '@/lib/runtime';
import { getYahooQuoteBySymbol, type MacroQuote } from '@/lib/market/macro';

// --- API key resolution (env-over-DB) ---

async function getApiKey(settingKey: string, envVal?: string): Promise<string> {
  // HF Secret env var wins
  if (envVal && envVal.length > 0 && !envVal.startsWith('PASTE_')) return envVal;
  // DB Setting fallback
  const dbVal = await getSetting<string>(settingKey, '');
  if (dbVal && dbVal.length > 0 && !dbVal.startsWith('PASTE_')) return dbVal;
  return '';
}

export async function getTwelveDataKey(): Promise<string> {
  return getApiKey('twelvedata_api_key', process.env.TWELVEDATA_API_KEY || HF_SECRETS.twelveDataApiKey);
}

export async function getAlphaVantageKey(): Promise<string> {
  return getApiKey(SETTING_KEYS.alphaVantageApiKey, HF_SECRETS.alphaVantageApiKey);
}

export async function getTiingoKey(): Promise<string> {
  return getApiKey('tiingo_api_key', process.env.TIINGO_API_KEY || HF_SECRETS.tiingoApiKey);
}

export async function getFinnhubKey(): Promise<string> {
  return getApiKey(SETTING_KEYS.finnhubApiKey, HF_SECRETS.finnhubApiKey);
}

// --- Symbol mapping ---
// Yahoo symbols → each provider's format
// Yahoo: AAPL, ^GSPC, EURUSD=X, RELIANCE.NS, GC=F
// Twelve Data: AAPL, GSPC, EUR/USD, RELIANCE, XAU/USD
// Alpha Vantage: AAPL, SPY (ETF), EURUSD, RELIANCE.BSE (limited)
// Tiingo: aapl, ^GSPC (no forex/commodities on free tier)
// Finnhub: AAPL, SPY, EURUSD (no Indian stocks on free tier)

interface SymbolMapping {
  twelveData: string | null;
  alphaVantage: string | null;
  tiingo: string | null;
  finnhub: string | null;
}

function mapSymbol(yahooSymbol: string): SymbolMapping {
  const s = yahooSymbol.toUpperCase();

  // Indices — Yahoo uses ^GSPC etc, providers use ETFs or index symbols
  if (s === '^GSPC') return { twelveData: 'GSPC', alphaVantage: 'SPY', tiingo: 'SPY', finnhub: 'SPY' };
  if (s === '^IXIC') return { twelveData: 'IXIC', alphaVantage: 'QQQ', tiingo: 'QQQ', finnhub: 'QQQ' };
  if (s === '^DJI') return { twelveData: 'DJI', alphaVantage: 'DIA', tiingo: 'DIA', finnhub: 'DIA' };
  if (s === '^RUT') return { twelveData: 'RUT', alphaVantage: 'IWM', tiingo: 'IWM', finnhub: 'IWM' };
  if (s === '^VIX') return { twelveData: 'VIX', alphaVantage: null, tiingo: 'vix', finnhub: null };
  if (s === '^TNX') return { twelveData: 'TNX', alphaVantage: null, tiingo: 't10yie', finnhub: null };
  if (s === '^IRX') return { twelveData: 'IRX', alphaVantage: null, tiingo: null, finnhub: null };

  // Forex — Yahoo: EURUSD=X → Twelve Data: EUR/USD, Alpha Vantage: EURUSD, Finnhub: OANDA:EUR_USD
  const forexMatch = s.match(/^([A-Z]{6})=X$/);
  if (forexMatch) {
    const pair = forexMatch[1];
    const base = pair.slice(0, 3);
    const quote = pair.slice(3);
    return {
      twelveData: `${base}/${quote}`,
      alphaVantage: pair,
      tiingo: `forex/${base}${quote}`,
      finnhub: `OANDA:${base}_${quote}`,
    };
  }

  // Commodities — Yahoo futures → Twelve Data has XAU/USD (gold), XAG/USD (silver)
  if (s === 'GC=F') return { twelveData: 'XAU/USD', alphaVantage: null, tiingo: 'gold', finnhub: 'OANDA:XAU_USD' };
  if (s === 'SI=F') return { twelveData: 'XAG/USD', alphaVantage: null, tiingo: 'silver', finnhub: 'OANDA:XAG_USD' };
  if (s === 'CL=F') return { twelveData: 'WTI/USD', alphaVantage: null, tiingo: null, finnhub: 'OANDA:WTI_USD' };
  if (s === 'BZ=F') return { twelveData: 'BRENT/USD', alphaVantage: null, tiingo: null, finnhub: null };
  if (s === 'NG=F') return { twelveData: 'NG/USD', alphaVantage: null, tiingo: null, finnhub: null };
  if (s === 'HG=F') return { twelveData: 'XCU/USD', alphaVantage: null, tiingo: null, finnhub: null };
  if (s === 'DX-Y.NYB') return { twelveData: 'DX/USD', alphaVantage: null, tiingo: null, finnhub: null };

  // Indian stocks — Yahoo: RELIANCE.NS → Twelve Data: RELIANCE, Tiingo: nil
  const nsMatch = s.match(/^(.+)\.NS$/);
  if (nsMatch) {
    return { twelveData: nsMatch[1], alphaVantage: null, tiingo: null, finnhub: null };
  }
  const boMatch = s.match(/^(.+)\.BO$/);
  if (boMatch) {
    return { twelveData: boMatch[1], alphaVantage: null, tiingo: null, finnhub: null };
  }

  // Crypto — Yahoo: BTC-USD → all providers can handle it
  if (s === 'BTC-USD') return { twelveData: 'BTC/USD', alphaVantage: null, tiingo: 'btcusd', finnhub: 'BINANCE:BTCUSDT' };
  if (s === 'ETH-USD') return { twelveData: 'ETH/USD', alphaVantage: null, tiingo: 'ethusd', finnhub: 'BINANCE:ETHUSDT' };

  // US stocks — same symbol across all providers
  return { twelveData: s, alphaVantage: s, tiingo: s.toLowerCase(), finnhub: s };
}

// --- HTTP helper ---
async function fetchJson(url: string, timeoutMs = 10_000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// --- Source 1: Twelve Data ---
async function fetchTwelveData(yahooSymbol: string, range: string): Promise<MacroQuote | null> {
  const key = await getTwelveDataKey();
  if (!key) return null;
  const mapping = mapSymbol(yahooSymbol);
  if (!mapping.twelveData) return null;

  try {
    // Get quote (current price + day change)
    const quoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(mapping.twelveData)}&apikey=${key}`;
    const quote = await fetchJson(quoteUrl);
    if (quote.status === 'error') throw new Error(quote.message || 'Twelve Data error');

    // Get time series (daily klines) — outputsize based on range
    const outputsize = range === '1y' ? 252 : range === '6mo' ? 126 : range === '3mo' ? 63 : 30;
    const tsUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(mapping.twelveData)}&interval=1day&outputsize=${outputsize}&apikey=${key}`;
    const ts = await fetchJson(tsUrl);
    if (ts.status === 'error') throw new Error(ts.message || 'Twelve Data TS error');

    const values: any[] = ts.values || [];
    const klines: Kline[] = values.reverse().map((v) => ({
      openTime: new Date(v.datetime).getTime(),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseFloat(v.volume || 0),
      closeTime: new Date(v.datetime).getTime() + 86400000,
    }));

    const price = parseFloat(quote.close);
    const open = parseFloat(quote.open);
    const change = price - open;
    const changePct = open ? (change / open) * 100 : 0;

    return {
      symbol: yahooSymbol,
      name: quote.name || yahooSymbol,
      price,
      change,
      changePct,
      dayHigh: parseFloat(quote.high),
      dayLow: parseFloat(quote.low),
      yearHigh: parseFloat(quote.fifty_two_week?.high || 0),
      yearLow: parseFloat(quote.fifty_two_week?.low || 0),
      currency: quote.currency || 'USD',
      klines,
    };
  } catch (e: any) {
    console.error(`[multi-source] Twelve Data failed for ${yahooSymbol}:`, e.message);
    return null;
  }
}

// --- Source 2: Alpha Vantage ---
async function fetchAlphaVantage(yahooSymbol: string, range: string): Promise<MacroQuote | null> {
  const key = await getAlphaVantageKey();
  if (!key) return null;
  const mapping = mapSymbol(yahooSymbol);
  if (!mapping.alphaVantage) return null;

  try {
    // GLOBAL_QUOTE gives current price + day change + day high/low
    const quoteUrl = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(mapping.alphaVantage)}&apikey=${key}`;
    const quoteResp = await fetchJson(quoteUrl);
    const q = quoteResp['Global Quote'];
    if (!q || !q['05. price']) throw new Error('Alpha Vantage: no data');

    // TIME_SERIES_DAILY gives klines (last 100 days on free tier)
    const tsUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(mapping.alphaVantage)}&outputsize=compact&apikey=${key}`;
    const tsResp = await fetchJson(tsUrl);
    const tsData = tsResp['Time Series (Daily)'];
    if (!tsData) throw new Error('Alpha Vantage: no time series');

    const klines: Kline[] = Object.entries(tsData)
      .map(([date, v]: [string, any]) => ({
        openTime: new Date(date).getTime(),
        open: parseFloat(v['1. open']),
        high: parseFloat(v['2. high']),
        low: parseFloat(v['3. low']),
        close: parseFloat(v['4. close']),
        volume: parseFloat(v['5. volume'] || 0),
        closeTime: new Date(date).getTime() + 86400000,
      }))
      .sort((a, b) => a.openTime - b.openTime);

    const price = parseFloat(q['05. price']);
    const prevClose = parseFloat(q['08. previous close'] || q['05. price']);
    const change = parseFloat(q['09. change'] || 0);
    const changePct = parseFloat(q['10. change percent']?.replace('%', '') || 0);

    return {
      symbol: yahooSymbol,
      name: yahooSymbol,
      price,
      change,
      changePct,
      dayHigh: parseFloat(q['03. high'] || 0),
      dayLow: parseFloat(q['04. low'] || 0),
      yearHigh: 0,
      yearLow: 0,
      currency: 'USD',
      klines,
    };
  } catch (e: any) {
    console.error(`[multi-source] Alpha Vantage failed for ${yahooSymbol}:`, e.message);
    return null;
  }
}

// --- Source 3: Tiingo ---
async function fetchTiingo(yahooSymbol: string, range: string): Promise<MacroQuote | null> {
  const key = await getTiingoKey();
  if (!key) return null;
  const mapping = mapSymbol(yahooSymbol);
  if (!mapping.tiingo) return null;

  try {
    // Tiingo daily prices — gives klines
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (range === '1y' ? 365 : range === '6mo' ? 180 : 90));
    const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(mapping.tiingo)}/prices?startDate=${startDate.toISOString().slice(0, 10)}&endDate=${endDate.toISOString().slice(0, 10)}&token=${key}`;
    const data = await fetchJson(url);
    if (!Array.isArray(data)) throw new Error('Tiingo: no data');

    const klines: Kline[] = data.map((v: any) => ({
      openTime: new Date(v.date).getTime(),
      open: v.open,
      high: v.high,
      low: v.low,
      close: v.close,
      volume: v.volume || 0,
      closeTime: new Date(v.date).getTime() + 86400000,
    }));

    const last = klines[klines.length - 1];
    const prev = klines[klines.length - 2];
    if (!last) throw new Error('Tiingo: empty response');
    const change = last.close - (prev?.close ?? last.close);
    const changePct = prev?.close ? (change / prev.close) * 100 : 0;

    return {
      symbol: yahooSymbol,
      name: yahooSymbol,
      price: last.close,
      change,
      changePct,
      dayHigh: last.high,
      dayLow: last.low,
      yearHigh: Math.max(...klines.map(k => k.high)),
      yearLow: Math.min(...klines.map(k => k.low)),
      currency: 'USD',
      klines,
    };
  } catch (e: any) {
    console.error(`[multi-source] Tiingo failed for ${yahooSymbol}:`, e.message);
    return null;
  }
}

// --- Source 4: Finnhub ---
async function fetchFinnhub(yahooSymbol: string, range: string): Promise<MacroQuote | null> {
  const key = await getFinnhubKey();
  if (!key) return null;
  const mapping = mapSymbol(yahooSymbol);
  if (!mapping.finnhub) return null;

  try {
    // Finnhub quote — current price + day change
    const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(mapping.finnhub)}&token=${key}`;
    const quote = await fetchJson(quoteUrl);
    if (quote.error) throw new Error(quote.error);
    if (!quote.c || quote.c === 0) throw new Error('Finnhub: no data');

    // Finnhub candle — historical klines
    const to = Math.floor(Date.now() / 1000);
    const from = to - (range === '1y' ? 365 * 86400 : range === '6mo' ? 180 * 86400 : 90 * 86400);
    const candleUrl = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(mapping.finnhub)}&resolution=D&from=${from}&to=${to}&token=${key}`;
    const candle = await fetchJson(candleUrl);
    if (candle.s !== 'ok') throw new Error('Finnhub: candle not available');

    const klines: Kline[] = candle.t.map((t: number, i: number) => ({
      openTime: t * 1000,
      open: candle.o[i],
      high: candle.h[i],
      low: candle.l[i],
      close: candle.c[i],
      volume: candle.v?.[i] || 0,
      closeTime: t * 1000 + 86400000,
    }));

    const price = quote.c;
    const change = quote.d || 0;
    const changePct = quote.dp || 0;

    return {
      symbol: yahooSymbol,
      name: yahooSymbol,
      price,
      change,
      changePct,
      dayHigh: quote.h,
      dayLow: quote.l,
      yearHigh: 0,
      yearLow: 0,
      currency: 'USD',
      klines,
    };
  } catch (e: any) {
    console.error(`[multi-source] Finnhub failed for ${yahooSymbol}:`, e.message);
    return null;
  }
}

/**
 * Get a market quote with multi-source fallback.
 *
 * Tries each source in order: Yahoo → Twelve Data → Alpha Vantage → Tiingo → Finnhub.
 * Returns the first successful result. If all fail, throws the last error.
 *
 * This is the main entry point for the macro page, markets scan, and
 * correlation views. It replaces getQuoteWithFallback() which only had
 * Binance as a fallback (and only for gold/BTC/ETH).
 */
export async function getQuoteMultiSource(yahooSymbol: string, range = '1y'): Promise<MacroQuote> {
  // Source 1: Yahoo Finance (free, no key)
  try {
    return await getYahooQuoteBySymbol(yahooSymbol, range);
  } catch (yahooErr: any) {
    console.log(`[multi-source] Yahoo failed for ${yahooSymbol}: ${yahooErr.message} — trying fallbacks...`);
  }

  // Source 2: Twelve Data
  const td = await fetchTwelveData(yahooSymbol, range);
  if (td) {
    console.log(`[multi-source] Twelve Data served ${yahooSymbol}`);
    return td;
  }

  // Source 3: Alpha Vantage
  const av = await fetchAlphaVantage(yahooSymbol, range);
  if (av) {
    console.log(`[multi-source] Alpha Vantage served ${yahooSymbol}`);
    return av;
  }

  // Source 4: Tiingo
  const tg = await fetchTiingo(yahooSymbol, range);
  if (tg) {
    console.log(`[multi-source] Tiingo served ${yahooSymbol}`);
    return tg;
  }

  // Source 5: Finnhub
  const fh = await fetchFinnhub(yahooSymbol, range);
  if (fh) {
    console.log(`[multi-source] Finnhub served ${yahooSymbol}`);
    return fh;
  }

  throw new Error(`All market data sources failed for ${yahooSymbol}. Configure API keys in Settings → Data Sources.`);
}

/**
 * Check which sources are configured (have API keys).
 * Used by the Settings UI to show which fallbacks are available.
 */
export async function getConfiguredSources(): Promise<{
  yahoo: boolean;
  twelveData: boolean;
  alphaVantage: boolean;
  tiingo: boolean;
  finnhub: boolean;
}> {
  const [td, av, tg, fh] = await Promise.all([
    getTwelveDataKey(),
    getAlphaVantageKey(),
    getTiingoKey(),
    getFinnhubKey(),
  ]);
  return {
    yahoo: true, // always available (free, no key)
    twelveData: td.length > 0,
    alphaVantage: av.length > 0,
    tiingo: tg.length > 0,
    finnhub: fh.length > 0,
  };
}
