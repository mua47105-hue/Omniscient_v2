import { NextResponse } from 'next/server';
import { getAllFundingRates, getOpenInterest } from '@/lib/market/binance';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const revalidate = 60; // ISR cache 60s

export interface FundingAllEntry {
  symbol: string;
  rate: number; // decimal
  nextFunding: number; // epoch ms
  openInterest: number; // contracts (best-effort, fetched for top symbols only)
  oiValue: number; // USDT value of OI (best-effort)
}

export async function GET() {
  try {
    const all = await getAllFundingRates();

    // Best-effort: attach current OI for the top symbols by |rate| magnitude.
    // We don't want to call /openInterest for ALL 400+ symbols (would be slow + rate-limited).
    // Instead, enrich the top 40 by absolute rate (these are the ones users care about most).
    const sorted = [...all].sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));
    const topSymbols = sorted.slice(0, 40).map((e) => e.symbol);

    const oiResults = await Promise.allSettled(topSymbols.map((s) => getOpenInterest(s)));
    const oiMap = new Map<string, { openInterest: number; value: number }>();
    oiResults.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        oiMap.set(topSymbols[i], r.value);
      }
    });

    const entries: FundingAllEntry[] = all.map((e) => ({
      symbol: e.symbol,
      rate: e.rate,
      nextFunding: e.nextFunding,
      openInterest: oiMap.get(e.symbol)?.openInterest ?? 0,
      oiValue: oiMap.get(e.symbol)?.value ?? 0,
    }));

    return NextResponse.json<ApiResult<FundingAllEntry[]>>({
      success: true,
      data: entries,
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
