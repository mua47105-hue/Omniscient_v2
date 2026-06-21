// On-chain BTC stats — free, no key. Hashrate, difficulty, 24h tx count.
import { NextResponse } from 'next/server';
import { getOnChainStats } from '@/lib/market/onchain';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getOnChainStats();
    return NextResponse.json<ApiResult<typeof data>>({ success: true, data });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
