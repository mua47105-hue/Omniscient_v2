// E8 — Asymmetric Fear & Greed edge signal. Free (alternative.me), no key.
import { NextResponse } from 'next/server';
import { computeFearGreedSignal } from '@/lib/analysis/fear-greed-edge';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await computeFearGreedSignal();
    return NextResponse.json<ApiResult<typeof data>>({ success: true, data });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
