// E4 — Derivatives-v2 intelligence layer (basis + 25Δ skew + VRP + regime).
// Free: Deribit public + Binance Coin-M. No API key.
import { NextRequest, NextResponse } from 'next/server';
import { computeDerivativesV2 } from '@/lib/market/deribit';
import { getKlines } from '@/lib/market/binance';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const currency = (req.nextUrl.searchParams.get('currency') || 'BTC') as 'BTC' | 'ETH';
    const klines = await getKlines(`${currency}USDT`, '1d', 30);
    const result = await computeDerivativesV2(currency, klines.map((k) => ({ close: k.close })));
    return NextResponse.json<ApiResult<typeof result>>({ success: true, data: result });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
