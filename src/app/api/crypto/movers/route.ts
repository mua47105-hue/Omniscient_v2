/**
 * Crypto top movers API.
 *
 * GET /api/crypto/movers
 *
 * Returns the top-10 symbols by |priceChangePercent| desc, across all Binance
 * USDT-M perps with nonzero quote volume. Uses getAllTickers + sort.
 */
import { NextResponse } from 'next/server';
import { getTopMovers } from '@/lib/market/binance';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const movers = await getTopMovers(10);
    return NextResponse.json({ success: true, data: movers });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
