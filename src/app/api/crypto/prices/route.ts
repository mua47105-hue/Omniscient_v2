import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTickers24h } from '@/lib/market/binance';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const symbols = await db.asset.findMany({ where: { assetClass: 'crypto', isActive: true } });
    const symList = symbols.map((s) => s.symbol);
    const tickers = await getTickers24h(symList);
    return NextResponse.json<ApiResult<typeof tickers>>({ success: true, data: tickers });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
