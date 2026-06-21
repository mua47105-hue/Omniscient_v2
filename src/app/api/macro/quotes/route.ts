import { NextRequest, NextResponse } from 'next/server';
import { getMacroQuotes, type MacroKey } from '@/lib/market/macro';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 300; // 5 min cache

export async function GET(req: NextRequest) {
  try {
    const keysParam = req.nextUrl.searchParams.get('keys') || 'dxy,vix,gold,oil,sp500,nasdaq,us10y,btc';
    const range = req.nextUrl.searchParams.get('range') || '30d';
    const keys = keysParam.split(',').filter(Boolean) as MacroKey[];
    const quotes = await getMacroQuotes(keys, range);
    return NextResponse.json<ApiResult<typeof quotes>>({ success: true, data: quotes });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
