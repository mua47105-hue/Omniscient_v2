import { NextResponse } from 'next/server';
import { getGlobalCryptoStats } from '@/lib/market/macro';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

export async function GET() {
  try {
    const stats = await getGlobalCryptoStats();
    return NextResponse.json<ApiResult<typeof stats>>({ success: true, data: stats });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
