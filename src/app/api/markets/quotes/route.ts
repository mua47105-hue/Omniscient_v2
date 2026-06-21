// Multi-asset-class market quotes — fetches by asset class from DB, maps to Yahoo symbols.
// Uses multi-source fallback: crypto→Binance, forex→Yahoo+er-api, gold/BTC/ETH→Yahoo+Binance,
// US stocks/indices→Yahoo+Alpha-Vantage, NSE stocks/other commodities→Yahoo only.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getYahooQuotesBySymbol, getYahooQuoteBySymbol, getForexQuoteWithFallback, getQuoteWithFallback, getStockQuoteWithFallback, FOREX_YAHOO_TO_PAIR, BINANCE_FALLBACKS, ALPHAVANTAGE_FALLBACKS } from '@/lib/market/macro';
import { getTickers24h } from '@/lib/market/binance';
import type { ApiResult, Ticker } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Forex Yahoo symbols that have er-api fallback
const FOREX_SYMBOLS = new Set(Object.keys(FOREX_YAHOO_TO_PAIR));
// Symbols that have Binance fallback (gold/BTC/ETH)
const BINANCE_FB_SYMBOLS = new Set(Object.keys(BINANCE_FALLBACKS));
// Symbols that have Alpha Vantage fallback (US stocks + index ETFs)
const ALPHAVANTAGE_FB_SYMBOLS = new Set(Object.keys(ALPHAVANTAGE_FALLBACKS));

export async function GET(req: NextRequest) {
  try {
    const assetClass = req.nextUrl.searchParams.get('class') || 'all';
    const where: any = { isActive: true };
    if (assetClass !== 'all') where.assetClass = assetClass;
    const assets = await db.asset.findMany({ where });

    // Group by asset class for different data sources
    const cryptoAssets = assets.filter((a) => a.assetClass === 'crypto');
    const yahooAssets = assets.filter((a) => a.assetClass !== 'crypto');

    const result: Record<string, any> = {};

    // Crypto → Binance (already works, fast)
    if (cryptoAssets.length > 0) {
      try {
        const tickers = await getTickers24h(cryptoAssets.map((a) => a.symbol));
        for (const t of tickers) {
          result[t.symbol] = {
            symbol: t.symbol,
            name: cryptoAssets.find((a) => a.symbol === t.symbol)?.name || t.symbol,
            assetClass: 'crypto',
            price: t.price,
            change: t.changePct,
            changePct: t.changePct,
            dayHigh: t.high,
            dayLow: t.low,
            volume: t.quoteVolume,
            currency: 'USD',
            source: 'binance',
          };
        }
      } catch (e: any) {
        console.error('[markets] crypto fetch failed:', e.message);
      }
    }

    // Forex/Stocks/Commodities/Indices → Yahoo with fallbacks
    if (yahooAssets.length > 0) {
      // Separate assets with fallbacks (forex/gold/BTC/ETH/US-stocks) from pure-Yahoo assets
      const fallbackAssets: typeof yahooAssets = [];
      const pureYahooAssets: typeof yahooAssets = [];
      for (const a of yahooAssets) {
        let meta: any = {};
        try { meta = JSON.parse(a.meta || '{}'); } catch {}
        const yahooSym = meta.yahooSymbol || a.symbol;
        if (FOREX_SYMBOLS.has(yahooSym) || BINANCE_FB_SYMBOLS.has(yahooSym) || ALPHAVANTAGE_FB_SYMBOLS.has(yahooSym)) {
          fallbackAssets.push(a);
        } else {
          pureYahooAssets.push(a);
        }
      }

      // Fetch fallback assets one by one (each has its own fallback logic)
      for (const a of fallbackAssets) {
        let meta: any = {};
        try { meta = JSON.parse(a.meta || '{}'); } catch {}
        const yahooSym = meta.yahooSymbol || a.symbol;
        try {
          let q;
          if (FOREX_SYMBOLS.has(yahooSym)) {
            q = await getForexQuoteWithFallback(yahooSym, '5d');
          } else if (BINANCE_FB_SYMBOLS.has(yahooSym)) {
            q = await getQuoteWithFallback(yahooSym, '5d');
          } else if (ALPHAVANTAGE_FB_SYMBOLS.has(yahooSym)) {
            q = await getStockQuoteWithFallback(yahooSym, '5d');
          } else {
            q = await getYahooQuoteBySymbol(yahooSym, '5d');
          }
          result[a.symbol] = {
            symbol: a.symbol,
            name: a.name,
            assetClass: a.assetClass,
            price: q.price,
            change: q.change,
            changePct: q.changePct,
            dayHigh: q.dayHigh,
            dayLow: q.dayLow,
            yearHigh: q.yearHigh,
            yearLow: q.yearLow,
            currency: q.currency,
            klines: q.klines,
            source: q.klines && q.klines.length > 0 ? 'yahoo' : 'fallback',
          };
        } catch (e: any) {
          console.error(`[markets] ${a.symbol} (${yahooSym}) all sources failed:`, e.message);
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      // Fetch pure-Yahoo assets (stocks, indices, commodities except gold) sequentially
      if (pureYahooAssets.length > 0) {
        const symbolMap = new Map<string, string>();
        for (const a of pureYahooAssets) {
          let meta: any = {};
          try { meta = JSON.parse(a.meta || '{}'); } catch {}
          const yahooSym = meta.yahooSymbol || a.symbol;
          symbolMap.set(yahooSym, a.symbol);
        }
        const yahooSymbols = [...symbolMap.keys()];
        const quotes = await getYahooQuotesBySymbol(yahooSymbols, '5d');
        for (const [yahooSym, q] of Object.entries(quotes)) {
          const ourSym = symbolMap.get(yahooSym) || yahooSym;
          const asset = pureYahooAssets.find((a) => {
            let m: any = {};
            try { m = JSON.parse(a.meta || '{}'); } catch {}
            return (m.yahooSymbol || a.symbol) === yahooSym;
          });
          result[ourSym] = {
            symbol: ourSym,
            name: asset?.name || q.name,
            assetClass: asset?.assetClass || 'unknown',
            price: q.price,
            change: q.change,
            changePct: q.changePct,
            dayHigh: q.dayHigh,
            dayLow: q.dayLow,
            yearHigh: q.yearHigh,
            yearLow: q.yearLow,
            currency: q.currency,
            klines: q.klines,
            source: 'yahoo',
          };
        }
      }
    }

    return NextResponse.json<ApiResult<typeof result>>({ success: true, data: result });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
