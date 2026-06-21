/**
 * Auth logout API.
 *
 * POST /api/auth/logout
 *
 * Clears the 'omniscient-auth' cookie. Always returns 200 (even if the
 * cookie wasn't present) — logging out when already logged out is a no-op.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const COOKIE_NAME = 'omniscient-auth';

export async function POST() {
  try {
    const res = NextResponse.json({ success: true, data: { authenticated: false } });
    res.cookies.set({
      name: COOKIE_NAME,
      value: '',
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0, // delete
    });
    return res;
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
