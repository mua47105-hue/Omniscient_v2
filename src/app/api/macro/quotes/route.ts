/**
 * Macro quotes API — Yahoo Finance proxy.
 *
 * GET /api/macro/quotes?symbols=^GSPC,^VIX,GC=F,...
 *
 * Fetches Yahoo quotes for the requested symbols. Defaults to the canonical
 * macro set: DXY, VIX, Gold, WTI, S&P500, Nasdaq, US10Y. 5-min cache (handled
 * inside lib/market/macro.ts).
 */
import { NextResponse } from 'next/server';
import { getMacroQuotes, getFearGreed } from '@/lib/market/macro';

export const dynamic = 'force-dynamic';

// Canonical macro symbol set — exported for client reuse.
export const MACRO_SYMBOLS: Array<{ symbol: string; label: string; yahoo: string }> = [
  { symbol: 'DXY', label: 'US Dollar Index', yahoo: 'DX-Y.NYB' },
  { symbol: 'VIX', label: 'Volatility Index', yahoo: '^VIX' },
  { symbol: 'GOLD', label: 'Gold (front-month)', yahoo: 'GC=F' },
  { symbol: 'WTI', label: 'Crude Oil WTI', yahoo: 'CL=F' },
  { symbol: 'SPX', label: 'S&P 500', yahoo: '^GSPC' },
  { symbol: 'NDX', label: 'Nasdaq 100', yahoo: '^NDX' },
  { symbol: 'US10Y', label: 'US 10Y Yield', yahoo: '^TNX' },
];

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbolsParam = searchParams.get('symbols');

    let symbols: string[];
    if (symbolsParam) {
      symbols = symbolsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      symbols = MACRO_SYMBOLS.map((m) => m.yahoo);
    }

    const [quotes, fg] = await Promise.all([
      getMacroQuotes(symbols),
      getFearGreed(1),
    ]);

    // Compute a simple Risk-On / Risk-Off regime.
    // Heuristic:
    //   - VIX > 25  → risk-off
    //   - VIX < 18  → risk-on
    //   - DXY change > +0.3% → risk-off (dollar strength = risk-off)
    //   - Otherwise: neutral
    const vix = quotes.find((q) => q.symbol === '^VIX');
    const dxy = quotes.find((q) => q.symbol === 'DX-Y.NYB');
    let regime: 'risk-on' | 'risk-off' | 'neutral' = 'neutral';
    if (vix) {
      if (vix.price >= 25) regime = 'risk-off';
      else if (vix.price < 18) regime = 'risk-on';
    }
    if (regime === 'neutral' && dxy?.changePercent != null) {
      if (dxy.changePercent > 0.3) regime = 'risk-off';
      else if (dxy.changePercent < -0.3) regime = 'risk-on';
    }

    return NextResponse.json({
      success: true,
      data: {
        quotes,
        fearGreed: fg[0] ?? null,
        regime,
        symbols: MACRO_SYMBOLS,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
