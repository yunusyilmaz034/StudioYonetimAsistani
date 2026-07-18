import { NextResponse, type NextRequest } from 'next/server'

import { SESSION_COOKIE_NAME } from '@/server/session-config'

// COARSE gate only (v1.5 decision #3): the middleware checks the *presence* of the
// session cookie and nothing more. It never reads the cookie's contents, never
// uses firebase-admin, and never makes an authorization decision — that is always
// requireTenantContext() on the Node server. This exists purely to bounce an
// unauthenticated request to /login without a server round-trip.
// v1.21 — the invite link and the member login are PUBLIC by necessity: the member has no
// account (and therefore no cookie) until she has used them.
// Plus Phase 6 — the PAYTR callback is a server-to-server POST from PAYTR's IPs; it carries no
// session cookie, so the coarse gate would bounce it to /login and the payment would NEVER be
// recorded (the entitlement is granted ONLY on this verified callback). The route itself verifies
// the PAYTR notification hash, so "public" here means "reachable", not "unauthenticated & trusted".
// PF-37 — `/pay/{linkId}` is the shareable payment page: a customer with no account (and no cookie)
// opens it from WhatsApp to pay. Without this it bounced to /login, so the link showed the staff
// sign-in screen to every customer and to WhatsApp's link-preview bot. The page reveals only a label
// and amount (no PII) and the checkout action re-verifies the link is active.
// `/api/member/*` is the mobile app's API. It carries a Firebase ID token in an Authorization header,
// not a `__session` cookie, and each handler verifies that token itself (see `member-api.ts`). "Public"
// here means "reachable without the cookie gate" — the handler, not the middleware, does the auth.
const PUBLIC_PREFIXES = ['/login', '/design-system', '/invite', '/portal/login', '/pay', '/api/member', '/api/payments/paytr/callback']

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl
  const hasSession = req.cookies.has(SESSION_COOKIE_NAME)

  if (!hasSession && !isPublic(pathname)) {
    const url = req.nextUrl.clone()
    // A member without a session belongs at HER door, not at the staff login she can never pass.
    url.pathname = pathname.startsWith('/portal') ? '/portal/login' : '/login'
    return NextResponse.redirect(url)
  }

  // DEBT-012 — there used to be a second rule here: "cookie present and heading for /login →
  // bounce to /". It was the other half of an infinite redirect. This gate is COARSE by design
  // and cannot tell a live cookie from a dead one, so a cookie that no longer verifies — expired,
  // or minted by an Auth emulator that has since been reset — read as a live session: the
  // middleware bounced /login → /, the server verified the cookie for real, found nothing, and
  // redirected / → /login. The user ended at ERR_TOO_MANY_REDIRECTS with no way back in from
  // inside the product.
  //
  // Nothing is lost by deleting it. `/login` already asks the server whether the session is
  // REAL and redirects a genuinely signed-in visitor itself — which is the same convenience,
  // decided by the one layer that can actually decide it. The stale cookie is inert (every
  // server read rejects it) and is overwritten by the next successful sign-in.
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
}
