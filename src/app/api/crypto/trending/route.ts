/**
 * Crypto trending API (CoinGecko).
 *
 * GET /api/crypto/trending
 *
 * Returns CoinGecko's trending-coins list (24h) + top-20 markets by market
 * cap. 5-min cache in the module (well under CoinGecko's free-tier limit).
 */
import { NextResponse } from 'next/server';
import { getTrending, getTopMarkets } from '@/lib/market/coingecko';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [trending, topMarkets] = await Promise.all([
      getTrending(),
      getTopMarkets(20),
    ]);
    return NextResponse.json({
      success: true,
      data: { trending, topMarkets },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
