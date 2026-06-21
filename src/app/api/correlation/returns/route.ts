// GET /api/correlation/returns?symbols=BTCUSDT,ETHUSDT&days=90
//
// Fetches daily klines for each requested symbol and returns aligned daily
// percentage returns (1 return per day per symbol). Used by the Correlation
// Matrix page to compute pairwise Pearson correlation coefficients.
//
// Sources:
//   - crypto  → Binance klines via getKlines(symbol, '1d', days+buffer)
//   - others  → Yahoo via getYahooQuoteBySymbol (returns MacroQuote with klines)
//
// Alignment: builds a UTC day-key (YYYY-MM-DD) → close map per symbol, takes
// the INTERSECTION of all symbols' day-keys, sorts chronologically, then
// computes daily returns per symbol from the aligned close series.
//
// Returns: { success, data: { symbol: number[] } } OR
//          { success, data: { ... }, warnings: [..] } for partial failures.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getKlines } from '@/lib/market/binance';
import { getYahooQuoteBySymbol, getQuoteWithFallback, getForexQuoteWithFallback, getStockQuoteWithFallback, BINANCE_FALLBACKS, FOREX_YAHOO_TO_PAIR, ALPHAVANTAGE_FALLBACKS } from '@/lib/market/macro';
import { dailyReturns } from '@/lib/analysis/correlation';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RawSeries {
  symbol: string;
  assetClass: string;
  /** Map of UTC day key "YYYY-MM-DD" → close price. */
  dayMap: Map<string, number>;
  error?: string;
}

function utcDayKey(ms: number): string {
  const d = new Date(ms);
  // Use UTC parts so 00:00 UTC is the day boundary — consistent across sources.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Fetch raw daily closes for a single symbol, returning a day → close map. */
async function fetchSymbolSeries(
  symbol: string,
  assetClass: string,
  yahooSymbol: string | undefined,
  days: number,
): Promise<RawSeries> {
  const dayMap = new Map<string, number>();
  const ys = yahooSymbol || symbol;
  try {
    let closes: Array<{ ts: number; close: number }> = [];
    if (assetClass === 'crypto') {
      // Binance klines — request days + 10 buffer for safety.
      const klines = await getKlines(symbol, '1d', days + 10);
      closes = klines.map((k) => ({ ts: k.openTime, close: k.close }));
    } else {
      // Yahoo with fallbacks (forex / gold-BTC-ETH / US stocks / indices).
      // Range string: Yahoo accepts 'Nd' for n in {1..59} and 'Nmo'/'Ny' otherwise.
      // Use a generous range so we always have ≥ days+5 daily candles.
      const range = yahooRangeForDays(days);
      let q;
      if (BINANCE_FALLBACKS[ys]) {
        q = await getQuoteWithFallback(ys, range);
      } else if (FOREX_YAHOO_TO_PAIR[ys]) {
        q = await getForexQuoteWithFallback(ys, range);
      } else if (ALPHAVANTAGE_FALLBACKS[ys]) {
        q = await getStockQuoteWithFallback(ys, range);
      } else {
        q = await getYahooQuoteBySymbol(ys, range);
      }
      closes = (q.klines || []).map((k) => ({ ts: k.openTime, close: k.close }));
    }
    for (const c of closes) {
      if (!isFinite(c.close) || c.close <= 0) continue;
      dayMap.set(utcDayKey(c.ts), c.close);
    }
    return { symbol, assetClass, dayMap };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    return { symbol, assetClass, dayMap, error: msg };
  }
}

/** Map a day count (30/60/90/180) to a Yahoo range string. */
function yahooRangeForDays(days: number): string {
  if (days <= 30) return '1mo';
  if (days <= 60) return '2mo';
  if (days <= 90) return '3mo';
  if (days <= 180) return '6mo';
  return '1y';
}

export async function GET(req: NextRequest) {
  try {
    const symbolsParam = req.nextUrl.searchParams.get('symbols') || '';
    const daysRaw = parseInt(req.nextUrl.searchParams.get('days') || '90', 10);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 90;

    if (!symbolsParam.trim()) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'symbols parameter is required' },
        { status: 400 },
      );
    }

    const requestedSymbols = symbolsParam
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (requestedSymbols.length === 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'no valid symbols provided' },
        { status: 400 },
      );
    }
    if (requestedSymbols.length > 25) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'too many symbols (max 25 per request)' },
        { status: 400 },
      );
    }

    // Look up each symbol in the DB to learn its assetClass + Yahoo symbol.
    const assets = await db.asset.findMany({
      where: { symbol: { in: requestedSymbols } },
    });
    const assetBySymbol = new Map(assets.map((a) => [a.symbol, a]));

    // Fetch each symbol's daily closes. We split into crypto (Binance, parallel)
    // and Yahoo (sequential with delay to avoid 429 rate-limits).
    const cryptoTasks: Array<Promise<RawSeries>> = [];
    const yahooTasks: Array<Promise<RawSeries>> = [];
    const unknownSymbols: string[] = [];

    for (const sym of requestedSymbols) {
      const asset = assetBySymbol.get(sym);
      if (!asset) {
        unknownSymbols.push(sym);
        continue;
      }
      let meta: { yahooSymbol?: string } = {};
      try { meta = JSON.parse(asset.meta || '{}'); } catch { /* ignore */ }
      const yahooSym = meta.yahooSymbol || sym;
      const task = fetchSymbolSeries(sym, asset.assetClass, yahooSym, days);
      if (asset.assetClass === 'crypto') {
        cryptoTasks.push(task);
      } else {
        yahooTasks.push(task);
      }
    }

    // Run crypto in parallel (Binance handles it fine).
    const cryptoResults = await Promise.all(cryptoTasks);

    // Run Yahoo sequentially with a small delay (avoid 429 rate-limit).
    const yahooResults: RawSeries[] = [];
    for (let i = 0; i < yahooTasks.length; i++) {
      yahooResults.push(await yahooTasks[i]);
      if (i < yahooTasks.length - 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    const allSeries = [...cryptoResults, ...yahooResults];

    // Build a symbol → RawSeries map for ordered output (preserve input order).
    const seriesBySymbol = new Map<string, RawSeries>();
    for (const s of allSeries) seriesBySymbol.set(s.symbol, s);

    // Determine the intersection of all day keys.
    // First, find the most recent trading day across all "successful" symbols
    // (symbols with no error and non-empty dayMap). Then drop "stale" symbols
    // whose latest trading day is more than 30 days older than that — handles
    // delisted symbols (e.g., MATICUSDT was migrated to POL on Binance in
    // Sept 2024 and now returns old klines for the limit window).
    let latestDay = '';
    for (const sym of requestedSymbols) {
      const s = seriesBySymbol.get(sym);
      if (!s || s.error || s.dayMap.size === 0) continue;
      for (const k of s.dayMap.keys()) {
        if (k > latestDay) latestDay = k;
      }
    }

    const staleCutoffMs = latestDay
      ? Date.parse(latestDay) - 30 * 24 * 60 * 60 * 1000
      : 0;

    const successful: string[] = [];
    const staleWarnings: string[] = [];
    for (const sym of requestedSymbols) {
      const s = seriesBySymbol.get(sym);
      if (!s || s.error || s.dayMap.size === 0) continue;
      let maxDay = '';
      for (const k of s.dayMap.keys()) {
        if (k > maxDay) maxDay = k;
      }
      if (latestDay && Date.parse(maxDay) < staleCutoffMs) {
        staleWarnings.push(
          `${sym}: latest data is ${maxDay} (older than 30 days from latest ${latestDay}) — likely delisted, skipping`,
        );
        continue;
      }
      successful.push(sym);
    }

    let commonDays: Set<string> | null = null;
    for (const sym of successful) {
      const s = seriesBySymbol.get(sym);
      if (!s) continue;
      if (commonDays === null) {
        commonDays = new Set(s.dayMap.keys());
      } else {
        const next = new Set<string>();
        for (const k of commonDays) {
          if (s.dayMap.has(k)) next.add(k);
        }
        commonDays = next;
      }
    }

    if (!commonDays || successful.length < 2 || commonDays.size < 5) {
      const failureSummary = [
        ...allSeries
          .filter((s) => s.error)
          .map((s) => `${s.symbol}: ${s.error}`),
        ...staleWarnings,
      ].join('; ') || 'none';
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error:
            'insufficient overlapping data — need at least 2 symbols with ≥5 common trading days. ' +
            `Got ${successful.length} symbol(s) with ${commonDays?.size ?? 0} common days. ` +
            `Failures: ${failureSummary}`,
        },
        { status: 502 },
      );
    }

    // Sort common days chronologically and slice to the LAST `days` days.
    const sortedDays = [...commonDays].sort();
    const tailDays = sortedDays.slice(-Math.max(days + 2, 5));

    // Build aligned closes per symbol, then compute daily returns.
    const data: Record<string, number[]> = {};
    for (const sym of successful) {
      const s = seriesBySymbol.get(sym)!;
      const closes = tailDays
        .map((d) => s.dayMap.get(d))
        .filter((v): v is number => typeof v === 'number' && isFinite(v));
      const returns = dailyReturns(closes);
      if (returns.length >= 2) {
        data[sym] = returns;
      }
    }

    // After filtering, we may have fewer than 2 symbols with valid returns.
    const finalSymbols = Object.keys(data);
    if (finalSymbols.length < 2) {
      const failureSummary =
        allSeries
          .filter((s) => s.error)
          .map((s) => `${s.symbol}: ${s.error}`)
          .join('; ') || 'none';
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error:
            'not enough valid return series after alignment — need ≥2 symbols with ≥2 returns each. ' +
            `Got ${finalSymbols.length}. Failures: ${failureSummary}`,
        },
        { status: 502 },
      );
    }

    // Re-align all return arrays to the same length (trim to min length).
    const minLen = Math.min(...finalSymbols.map((s) => data[s].length));
    for (const s of finalSymbols) {
      data[s] = data[s].slice(-minLen);
    }

    const warnings: string[] = [];
    for (const sym of unknownSymbols) {
      warnings.push(`${sym}: not found in asset database (skipped)`);
    }
    for (const s of allSeries) {
      if (s.error) warnings.push(`${s.symbol}: ${s.error}`);
    }
    for (const w of staleWarnings) warnings.push(w);
    const skipped = requestedSymbols.filter((sym) => !finalSymbols.includes(sym));
    for (const sym of skipped) {
      if (!unknownSymbols.includes(sym) && !allSeries.find((s) => s.symbol === sym && s.error)) {
        warnings.push(`${sym}: insufficient data after alignment`);
      }
    }

    return NextResponse.json<ApiResult<Record<string, number[]>> & { warnings?: string[] }>({
      success: true,
      data,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'internal error';
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: msg },
      { status: 500 },
    );
  }
}
