import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname, origin } = req.nextUrl;

  // Allow: lock page, ALL API routes, static assets
  if (
    pathname === '/lock' ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  // Check auth cookie for page routes
  const authCookie = req.cookies.get('omniscient-auth');
  if (authCookie?.value === 'authenticated') {
    return NextResponse.next();
  }

  // Rewrite to lock page (200 status, NOT 307 redirect)
  // A 307 redirect causes HF Spaces health check to think the app isn't ready.
  // A rewrite serves the /lock page content at the original URL with 200 OK.
  return NextResponse.rewrite(new URL('/lock', origin));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt|api).*)'],
};
