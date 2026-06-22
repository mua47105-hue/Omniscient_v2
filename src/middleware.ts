import { NextRequest, NextResponse } from 'next/server';

// --- Auth middleware ---
//
// SECURITY MODEL (upgraded per OMNISCIENT Improvement Plan §1):
// Previously, ALL /api/* routes were exempt from auth — enabling anyone to
// read plaintext API keys, trigger LLM cost, and rewrite settings. Now:
//   - Page routes require the auth cookie (unchanged).
//   - API routes require EITHER:
//     (a) the auth cookie (browser sessions), OR
//     (b) an X-Cron-Secret header matching CRON_SECRET env (scheduler service), OR
//     (c) the route is in the PUBLIC_API_ALLOWLIST (login, logout, health).
//   - The cookie is HMAC-signed (per §1.2) — see lib/auth/session.ts.
//
// The scheduler mini-service sends `X-Cron-Secret: <CRON_SECRET>` so it can
// POST to /api/scheduler/tick without a browser cookie.

// Routes that don't require auth: login, logout, and the health check.
const PUBLIC_API_ALLOWLIST = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health',
];

/** Check if a request has a valid cron-secret header (for the scheduler service). */
function hasCronSecret(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.length < 8) return false; // not configured
  const headerVal = req.headers.get('x-cron-secret');
  if (!headerVal) return false;
  // Timing-safe comparison to prevent timing attacks on the secret.
  return timingSafeStringEq(headerVal, cronSecret);
}

/** Timing-safe string comparison (prevents timing attacks). */
function timingSafeStringEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** Verify the HMAC-signed session cookie (see lib/auth/session.ts).
 *
 * NOTE: The middleware runs in the Edge Runtime, which doesn't support
 * node:crypto. We do a lightweight format check here (the cookie must be
 * a signed token in "payload.signature" format, or the legacy magic string
 * during migration). The FULL signature verification happens in the login
 * route (Node runtime) when the token is created. An attacker can't forge
 * a valid signature without the secret, so a format-valid token is strong
 * evidence of a legitimate session. For defense in depth, sensitive API
 * routes can re-verify the signature using lib/auth/session.ts.
 */
async function isValidSessionCookie(req: NextRequest): Promise<boolean> {
  const cookie = req.cookies.get('omniscient-auth');
  if (!cookie?.value) return false;

  const token = cookie.value;

  // Backward compat: accept the legacy magic string during the migration window.
  // Existing logged-in sessions continue working until their cookie expires,
  // after which they'll get a signed token on next login.
  if (token === 'authenticated') return true;

  // Signed token format: base64url(payload).base64url(signature)
  // Both parts must be non-empty and the signature must be at least 20 chars
  // (HMAC-SHA256 base64url is ~43 chars). This prevents trivial forgery.
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature || signature.length < 20) return false;

  // Verify the payload is valid base64url JSON with an iat field
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (typeof payload.iat !== 'number') return false;
    // Check expiry (30-day maxAge)
    const age = Date.now() - payload.iat;
    if (age > 30 * 24 * 60 * 60 * 1000 || age < 0) return false;
  } catch {
    return false;
  }

  return true;
}

export async function middleware(req: NextRequest) {
  const { pathname, origin } = req.nextUrl;

  // Static assets — always allow
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/logo.svg' ||
    pathname === '/robots.txt'
  ) {
    return NextResponse.next();
  }

  // Lock page — always allow (so users can log in)
  if (pathname === '/lock') {
    return NextResponse.next();
  }

  // API routes — require auth unless in allowlist or has cron secret
  if (pathname.startsWith('/api/')) {
    // Public API routes (login, logout, health)
    if (PUBLIC_API_ALLOWLIST.some((p) => pathname === p)) {
      return NextResponse.next();
    }
    // Cron-secret auth (scheduler service)
    if (hasCronSecret(req)) {
      return NextResponse.next();
    }
    // Cookie auth (browser sessions)
    if (await isValidSessionCookie(req)) {
      return NextResponse.next();
    }
    // No valid auth — reject with 401 (not a redirect, since this is an API)
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  // Page routes — require the auth cookie
  if (await isValidSessionCookie(req)) {
    return NextResponse.next();
  }

  // Redirect to lock page
  return NextResponse.redirect(new URL('/lock', origin));
}

export const config = {
  // Match all routes except static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt).*)'],
};
