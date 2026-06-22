import { NextRequest, NextResponse } from 'next/server';
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';
import { HF_SECRETS } from '@/lib/runtime';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();

    // Password resolution (env-over-DB):
    //   1. HF Secret: process.env.APP_PASSWORD (set in Space Settings UI)
    //   2. DB Setting: app_password (set via Settings → Security UI)
    //   3. Default: "omniscient"
    const dbPassword = await getSetting<string>(SETTING_KEYS.appPassword, '');
    const correctPassword = HF_SECRETS.appPassword || dbPassword || 'omniscient';

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
