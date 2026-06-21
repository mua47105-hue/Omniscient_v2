import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';

/**
 * Auth middleware.
 *
 * OMNISCIENT uses a single shared password (APP_PASSWORD env). On a successful
 * POST /api/auth/login the server sets the `omniscient-auth` cookie (httpOnly,
 * same-site lax). This middleware gates every non-public path on that cookie.
 *
 * Public paths:
 *   - /lock            (login page)
 *   - /api/auth/*      (login + logout endpoints)
 *   - /api/*           (other API routes are still gated by auth checks at the
 *                       route level — but allow them through here so the lock
 *                       page can POST without redirect loops)
 *   - _next/*, favicon.ico, public assets
 */
const PUBLIC_PATHS = ['/lock'];
const PUBLIC_PREFIXES = ['/api/auth/', '/_next/', '/favicon'];

export async function middleware(_req: NextRequest): Promise<NextResponse> {
  const { pathname } = _req.nextUrl;

  if (PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const cookieStore = await cookies();
  const auth = cookieStore.get('omniscient-auth');
  if (auth?.value === 'authenticated') {
    return NextResponse.next();
  }

  const url = _req.nextUrl.clone();
  url.pathname = '/lock';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // Run on every path except Next internals + static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|logo.svg).*)'],
};
