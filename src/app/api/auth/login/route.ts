/**
 * Auth login API.
 *
 * POST /api/auth/login  body: {password}
 *
 * Checks the password against (in order):
 *   1. APP_PASSWORD env var
 *   2. The 'app.password' Setting KV row (if set via Settings UI)
 *
 * On success: sets an httpOnly cookie 'omniscient-auth'='authenticated'
 * with a 30-day maxAge, SameSite=Lax. Returns {success: true}.
 * On failure: 401 + {success: false, error: 'invalid password'}.
 */
import { NextResponse } from 'next/server';
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';

export const dynamic = 'force-dynamic';

const COOKIE_NAME = 'omniscient-auth';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  try {
    let body: { password?: string };
    try {
      body = (await req.json()) as { password?: string };
    } catch {
      return NextResponse.json(
        { success: false, error: 'invalid JSON body' },
        { status: 400 },
      );
    }

    const submitted = body.password ?? '';
    if (!submitted) {
      return NextResponse.json(
        { success: false, error: 'password required' },
        { status: 400 },
      );
    }

    // Resolve the expected password: env wins, fall back to Setting KV.
    const envPassword = process.env.APP_PASSWORD;
    let expected: string | undefined = envPassword;
    if (!expected) {
      expected = await getSetting<string>(SETTING_KEYS.appPassword);
    }

    if (!expected) {
      // No password configured — fail closed.
      return NextResponse.json(
        { success: false, error: 'no password configured (set APP_PASSWORD env or app.password setting)' },
        { status: 500 },
      );
    }

    // Constant-time-ish compare (lengths differ → fail fast, then byte-compare).
    if (submitted.length !== expected.length || submitted !== expected) {
      return NextResponse.json(
        { success: false, error: 'invalid password' },
        { status: 401 },
      );
    }

    // Set cookie. Use Set-Cookie via the NextResponse cookies API.
    const res = NextResponse.json({ success: true, data: { authenticated: true } });
    res.cookies.set({
      name: COOKIE_NAME,
      value: 'authenticated',
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(THIRTY_DAYS_MS / 1000),
    });
    return res;
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
