import { NextRequest, NextResponse } from 'next/server';
import { getOrderBook, getFundingRate, getOpenInterest } from '@/lib/market/binance';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const symbol = req.nextUrl.searchParams.get('symbol') || 'BTCUSDT';
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50');
    const [orderbook, funding, oi] = await Promise.all([
      getOrderBook(symbol, limit),
      getFundingRate(symbol).catch(() => null),
      getOpenInterest(symbol).catch(() => null),
    ]);
    return NextResponse.json<ApiResult<{ symbol: string; bids: [number, number][]; asks: [number, number][]; spread: number; bidDepth: number; askDepth: number; imbalance: number; funding: any; openInterest: any }>>({
      success: true,
      data: { ...orderbook, funding, openInterest: oi },
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
