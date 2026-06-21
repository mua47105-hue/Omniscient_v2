import { NextResponse } from 'next/server';
import { getFearGreed } from '@/lib/market/macro';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 1800; // 30 min cache

export async function GET() {
  try {
    const fg = await getFearGreed(30);
    return NextResponse.json<ApiResult<typeof fg>>({ success: true, data: fg });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
