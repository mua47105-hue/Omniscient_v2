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

  // Redirect to lock page using the origin
  return NextResponse.redirect(new URL('/lock', origin));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.svg|robots.txt|api).*)'],
};
