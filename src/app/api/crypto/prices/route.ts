/**
 * Crypto 24h tickers API.
 *
 * GET /api/crypto/prices
 *
 * Returns getTickers24h for every active crypto asset in the DB. Single
 * batched Binance call (with per-symbol fallback on 418).
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getTickers24h } from '@/lib/market/binance';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const assets = await db.asset.findMany({
      where: { assetClass: 'crypto', isActive: true },
      select: { symbol: true },
    });
    const symbols = assets.map((a) => a.symbol);
    if (symbols.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }
    const tickers = await getTickers24h(symbols);
    return NextResponse.json({ success: true, data: tickers });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
