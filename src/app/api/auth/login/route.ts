import { NextRequest, NextResponse } from 'next/server';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();

    // Use environment variable first, then fall back to a hardcoded default.
    // This works on Vercel (no SQLite needed) AND on local dev (with DB).
    const correctPassword = process.env.APP_PASSWORD || 'omniscient';

    if (password === correctPassword) {
      const res = NextResponse.json<ApiResult<{ ok: boolean }>>({ success: true, data: { ok: true } });
      res.cookies.set('omniscient-auth', 'authenticated', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60,
        path: '/',
      });
      return res;
    }

    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Wrong password' },
      { status: 401 }
    );
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
