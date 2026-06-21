import { NextResponse } from 'next/server';
import { getTopMovers } from '@/lib/market/binance';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const movers = await getTopMovers(8);
    return NextResponse.json<ApiResult<typeof movers>>({ success: true, data: movers });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
