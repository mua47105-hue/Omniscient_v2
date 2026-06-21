// GitHub dev-activity — free, no key. Commit count + stars for flagship crypto repos.
import { NextResponse } from 'next/server';
import { getDevActivity } from '@/lib/market/devactivity';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getDevActivity();
    return NextResponse.json<ApiResult<typeof data>>({ success: true, data });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
