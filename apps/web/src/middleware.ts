import { NextResponse, type NextRequest } from 'next/server'

import { SESSION_COOKIE_NAME } from '@/server/session-config'

// COARSE gate only (v1.5 decision #3): the middleware checks the *presence* of the
// session cookie and nothing more. It never reads the cookie's contents, never
// uses firebase-admin, and never makes an authorization decision — that is always
// requireTenantContext() on the Node server. This exists purely to bounce an
// unauthenticated request to /login without a server round-trip.
const PUBLIC_PREFIXES = ['/login', '/design-system']

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl
  const hasSession = req.cookies.has(SESSION_COOKIE_NAME)

  if (!hasSession && !isPublic(pathname)) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (hasSession && pathname === '/login') {
    const url = req.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
}
