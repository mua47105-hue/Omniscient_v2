/**
 * Global crypto stats API (CoinGecko /global).
 *
 * GET /api/macro/global
 *
 * Returns total market cap, 24h volume, BTC/ETH dominance, active
 * cryptocurrencies count. 5-min cache.
 */
import { NextResponse } from 'next/server';
import { getGlobalCryptoStats } from '@/lib/market/macro';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stats = await getGlobalCryptoStats();
    if (!stats) {
      return NextResponse.json(
        { success: false, error: 'upstream unavailable' },
        { status: 502 },
      );
    }
    return NextResponse.json({ success: true, data: stats });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
