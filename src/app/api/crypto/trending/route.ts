// CoinGecko trending + top markets — free, no key. Attention + market-cap signal.
import { NextResponse } from 'next/server';
import { getTrending, getTopMarkets } from '@/lib/market/coingecko';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [trending, top] = await Promise.all([
      getTrending().catch(() => []),
      getTopMarkets(20).catch(() => []),
    ]);
    return NextResponse.json<ApiResult<{ trending: typeof trending; top: typeof top }>>({ success: true, data: { trending, top } });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
