import { NextRequest, NextResponse } from 'next/server';
import { getKlines } from '@/lib/market/binance';
import { computeIndicators } from '@/lib/market/indicators';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const symbol = req.nextUrl.searchParams.get('symbol') || 'BTCUSDT';
    const interval = req.nextUrl.searchParams.get('interval') || '4h';
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '200');
    const klines = await getKlines(symbol, interval, limit);
    const indicators = computeIndicators(klines);
    return NextResponse.json<ApiResult<{ klines: typeof klines; indicators: typeof indicators }>>({
      success: true,
      data: { klines, indicators },
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
