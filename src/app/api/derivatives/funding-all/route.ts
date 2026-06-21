/**
 * Derivatives funding-all API — bulk funding rates for all Binance USDT-M
 * perpetuals + open interest for the DB-tracked assets.
 *
 * GET /api/derivatives/funding-all
 *
 * Returns the full getAllFundingRates() list (one row per listed perp) plus
 * open-interest enrichment for DB-tracked symbols. Cached 10s upstream.
 */
import { NextResponse } from 'next/server';
import { getAllFundingRates, getOpenInterest } from '@/lib/market/binance';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const funding = await getAllFundingRates();

    // Enrich DB-tracked symbols with open interest (parallel).
    let tracked: { symbol: string; name?: string }[] = [];
    try {
      tracked = await db.asset.findMany({
        where: { assetClass: 'crypto', isActive: true },
        select: { symbol: true, name: true },
      });
    } catch {
      /* ignore */
    }

    const oiBySymbol = new Map<string, number>();
    await Promise.all(
      tracked.map(async (a) => {
        try {
          const oi = await getOpenInterest(a.symbol);
          if (oi) oiBySymbol.set(a.symbol, oi.openInterest);
        } catch {
          /* ignore */
        }
      }),
    );

    // Decorate funding rows with openInterest + name.
    const nameBySymbol = new Map(tracked.map((a) => [a.symbol, a.name ?? a.symbol]));
    const out = funding.map((f) => ({
      ...f,
      name: nameBySymbol.get(f.symbol) ?? f.symbol,
      openInterest: oiBySymbol.get(f.symbol) ?? null,
    }));

    return NextResponse.json({ success: true, data: out });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
