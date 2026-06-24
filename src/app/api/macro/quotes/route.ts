import { NextRequest, NextResponse } from 'next/server';
import { getMacroQuotes, getMacroQuote, MACRO_SYMBOLS, type MacroKey, type MacroQuote } from '@/lib/market/macro';
import { getQuoteMultiSource } from '@/lib/market/multi-source';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 300; // 5 min cache

export async function GET(req: NextRequest) {
  try {
    const keysParam = req.nextUrl.searchParams.get('keys') || 'dxy,vix,gold,oil,sp500,nasdaq,us10y,btc';
    const range = req.nextUrl.searchParams.get('range') || '30d';
    const keys = keysParam.split(',').filter(Boolean) as MacroKey[];

    // Use the multi-source fallback chain for each key.
    // getMacroQuotes only goes through Yahoo (with Binance fallback for gold/btc/eth).
    // We try getMacroQuote first (which has inline Binance fallback for gold/btc/eth),
    // and if it fails, fall through to getQuoteMultiSource (Yahoo → Twelve Data → Alpha Vantage → Tiingo → Finnhub).
    const quotes: Record<string, MacroQuote> = {};
    const warnings: string[] = [];

    for (const key of keys) {
      try {
        // First try getMacroQuote (has Binance fallback for gold/btc/eth + forex er-api)
        quotes[key] = await getMacroQuote(key, range);
      } catch {
        // Yahoo failed — try the multi-source chain
        try {
          const yahooSymbol = MACRO_SYMBOLS[key];
          if (yahooSymbol) {
            quotes[key] = await getQuoteMultiSource(yahooSymbol, range);
          } else {
            warnings.push(`${key}: no symbol mapping`);
          }
        } catch (multiErr: any) {
          console.error(`[macro/quotes] ${key} all sources failed:`, multiErr.message);
          warnings.push(`${key}: ${multiErr.message?.slice(0, 80)}`);
        }
      }
      // Small delay between keys to avoid rate-limiting
      await new Promise((r) => setTimeout(r, 100));
    }

    return NextResponse.json<ApiResult<typeof quotes>>({
      success: true,
      data: quotes,
      ...(warnings.length > 0 ? { warnings } : {}),
    } as any);
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
