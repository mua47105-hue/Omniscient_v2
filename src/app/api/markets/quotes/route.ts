/**
 * Markets quotes API — Yahoo Finance quotes for non-crypto assets.
 *
 * GET /api/markets/quotes
 *
 * Queries the DB for active non-crypto assets (forex / stocks / indices /
 * commodities). If none exist, falls back to a curated list of common Yahoo
 * Finance symbols so the page is never empty. 5-min cache (in macro.ts).
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getMacroQuotes, type YahooQuote } from '@/lib/market/macro';

export const dynamic = 'force-dynamic';

const FALLBACK_ASSETS: { symbol: string; name: string; assetClass: string }[] = [
  // Indices
  { symbol: '^GSPC', name: 'S&P 500', assetClass: 'indices' },
  { symbol: '^DJI', name: 'Dow Jones Industrial Average', assetClass: 'indices' },
  { symbol: '^IXIC', name: 'NASDAQ Composite', assetClass: 'indices' },
  { symbol: '^VIX', name: 'CBOE Volatility Index', assetClass: 'indices' },
  { symbol: '^NSEI', name: 'NIFTY 50', assetClass: 'indices' },
  { symbol: '^BSESN', name: 'BSE SENSEX', assetClass: 'indices' },
  // Forex
  { symbol: 'EURUSD=X', name: 'Euro / US Dollar', assetClass: 'forex' },
  { symbol: 'GBPUSD=X', name: 'British Pound / US Dollar', assetClass: 'forex' },
  { symbol: 'USDJPY=X', name: 'US Dollar / Japanese Yen', assetClass: 'forex' },
  { symbol: 'USDINR=X', name: 'US Dollar / Indian Rupee', assetClass: 'forex' },
  { symbol: 'DXY=X', name: 'US Dollar Index', assetClass: 'forex' },
  // Commodities
  { symbol: 'GC=F', name: 'Gold Futures', assetClass: 'commodities' },
  { symbol: 'SI=F', name: 'Silver Futures', assetClass: 'commodities' },
  { symbol: 'CL=F', name: 'Crude Oil WTI Futures', assetClass: 'commodities' },
  { symbol: 'NG=F', name: 'Natural Gas Futures', assetClass: 'commodities' },
  { symbol: 'HG=F', name: 'Copper Futures', assetClass: 'commodities' },
  // Stocks
  { symbol: 'AAPL', name: 'Apple Inc.', assetClass: 'stocks' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', assetClass: 'stocks' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', assetClass: 'stocks' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', assetClass: 'stocks' },
  { symbol: 'TSLA', name: 'Tesla Inc.', assetClass: 'stocks' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', assetClass: 'stocks' },
  { symbol: 'META', name: 'Meta Platforms Inc.', assetClass: 'stocks' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', assetClass: 'stocks' },
];

export async function GET() {
  try {
    // Try the DB first.
    let assets: { symbol: string; name: string; assetClass: string }[] = [];
    try {
      const rows = await db.asset.findMany({
        where: {
          isActive: true,
          assetClass: { not: 'crypto' },
        },
        select: { symbol: true, name: true, assetClass: true },
      });
      assets = rows.map((r) => ({
        symbol: r.symbol,
        name: r.name,
        assetClass: r.assetClass,
      }));
    } catch {
      /* ignore DB errors — use fallback */
    }

    if (assets.length === 0) {
      assets = FALLBACK_ASSETS;
    }

    const quotes = await getMacroQuotes(assets.map((a) => a.symbol));
    const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));

    const out = assets.map((a) => {
      const q: YahooQuote | undefined = bySymbol.get(a.symbol);
      return {
        symbol: a.symbol,
        name: a.name,
        assetClass: a.assetClass,
        price: q?.price ?? 0,
        change: q?.change,
        changePercent: q?.changePercent,
        previousClose: q?.previousClose,
        currency: q?.currency,
        fetchedAt: q?.fetchedAt ?? 0,
      };
    });

    return NextResponse.json({ success: true, data: out });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
