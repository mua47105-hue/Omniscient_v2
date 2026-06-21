import { NextRequest, NextResponse } from 'next/server';
import {
  getFundingRate,
  getOpenInterest,
  getOpenInterestHistory,
  getTopTraderLongShortRatio,
  getTakerBuySellVolume,
  getKlines,
} from '@/lib/market/binance';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const revalidate = 300; // ISR 5 min

export interface AssetDerivativesData {
  symbol: string;
  funding: { rate: number; nextFunding: number };
  openInterest: { current: number; value: number };
  oiHistory: { time: number; oi: number; value: number; price: number }[];
  lsRatio: {
    time: number;
    longShortRatio: number;
    longAccount: number;
    shortAccount: number;
  }[];
  takerVolume: { time: number; buyVol: number; sellVol: number; ratio: number }[];
  priceHistory: { time: number; price: number }[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol: rawSymbol } = await params;
    const symbol = rawSymbol.toUpperCase();

    const [funding, openInterest, oiHist, lsHist, tvHist, klines] = await Promise.all([
      getFundingRate(symbol),
      getOpenInterest(symbol),
      getOpenInterestHistory(symbol, '4h', 30),
      getTopTraderLongShortRatio(symbol, '4h', 30),
      getTakerBuySellVolume(symbol, '4h', 30),
      // Fetch last 30 × 4h klines for price overlay
      getKlines(symbol, '4h', 30).catch(() => []),
    ]);

    // Build a time → price map from klines for OI vs price overlay
    const priceByTime = new Map<number, number>();
    for (const k of klines) {
      // Bucket kline closeTime → 4h-aligned timestamp (truncate to 4h boundary)
      const t = Math.floor(k.openTime / (4 * 3600_000)) * (4 * 3600_000);
      priceByTime.set(t, k.close);
    }

    const oiHistory = oiHist.map((e) => {
      const aligned = Math.floor(e.time / (4 * 3600_000)) * (4 * 3600_000);
      return {
        time: e.time,
        oi: e.openInterest,
        value: e.value,
        price: priceByTime.get(aligned) ?? 0,
      };
    });

    const priceHistory = klines.map((k) => ({ time: k.openTime, price: k.close }));

    const payload: AssetDerivativesData = {
      symbol,
      funding,
      openInterest: {
        current: openInterest.openInterest,
        value: openInterest.value,
      },
      oiHistory,
      lsRatio: lsHist,
      takerVolume: tvHist,
      priceHistory,
    };

    return NextResponse.json<ApiResult<AssetDerivativesData>>({
      success: true,
      data: payload,
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
