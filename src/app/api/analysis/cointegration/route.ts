// E3 — Cointegration matrix API. Augments the Pearson /correlation page with
// a predictive cointegration view. Free, pure math (no API key).
import { NextRequest, NextResponse } from 'next/server';
import { getKlines } from '@/lib/market/binance';
import { computeCointegrationMatrix, engleGranger } from '@/lib/analysis/cointegration';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const symbols = req.nextUrl.searchParams.get('symbols')?.split(',').filter(Boolean)
      ?? ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT'];
    // Fetch daily closes for each symbol (200 bars ≈ 200 days).
    const prices: Record<string, number[]> = {};
    await Promise.all(symbols.map(async (s) => {
      try {
        const k = await getKlines(s, '1d', 200);
        prices[s] = k.map((c) => c.close);
      } catch { /* skip */ }
    }));
    const matrix = computeCointegrationMatrix(prices);
    return NextResponse.json<ApiResult<typeof matrix>>({ success: true, data: matrix });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
