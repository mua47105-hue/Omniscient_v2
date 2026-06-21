import { NextResponse } from 'next/server';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json<ApiResult<{ ok: boolean }>>({ success: true, data: { ok: true } });
  res.cookies.delete('omniscient-auth');
  return res;
}
