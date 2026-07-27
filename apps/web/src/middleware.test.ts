import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { middleware } from './middleware'
import { SESSION_COOKIE_NAME } from './server/session-config'

// The coarse gate (v1.5 #3) — and the regression guard for DEBT-012.
//
// The middleware may only ever answer ONE question: is a session cookie present? It cannot
// verify one (it runs on the edge, without firebase-admin), and the day it pretended it could
// was the day a dead cookie locked the owner out of her own product with ERR_TOO_MANY_REDIRECTS.

function request(path: string, opts: { cookie?: boolean } = {}) {
  const req = new NextRequest(new URL(`https://studio.test${path}`))
  if (opts.cookie) req.cookies.set(SESSION_COOKIE_NAME, 'stale-or-live-we-cannot-tell')
  return req
}

const locationOf = (res: ReturnType<typeof middleware>) => res.headers.get('location')

describe('middleware — the coarse gate', () => {
  it('sends a visitor with no cookie to the staff login', () => {
    expect(locationOf(middleware(request('/members')))).toBe('https://studio.test/login')
  })

  it('sends a member with no cookie to HER door, not to the staff login she can never pass', () => {
    expect(locationOf(middleware(request('/portal/agenda')))).toBe(
      'https://studio.test/portal/login',
    )
  })

  it('lets a request holding a cookie through — it never judges the cookie', () => {
    expect(locationOf(middleware(request('/members', { cookie: true })))).toBeNull()
  })

  it('leaves the public paths alone', () => {
    expect(locationOf(middleware(request('/invite/abc')))).toBeNull()
    expect(locationOf(middleware(request('/portal/login')))).toBeNull()
  })

  it('lets the cookie-less PAYTR callback through — it grants the package, and PAYTR carries no session', () => {
    expect(locationOf(middleware(request('/api/payments/paytr/callback')))).toBeNull()
  })

  it('lets the cookie-less shareable payment page through — a customer pays without an account (PF-37)', () => {
    expect(locationOf(middleware(request('/pay/plink_abc?s=retro')))).toBeNull()
  })

  // The online sales page and the price list the marketing site reads. `/pay` once shipped behind the
  // guard and showed strangers a STAFF LOGIN; every public route belongs in the allowlist and in a test.
  // The browser fetches the manifest while rendering the LOGIN screen — she has no session yet.
  // Behind the guard it 307s to /portal/login and the install prompt never appears.
  it('lets the cookie-less member PWA manifest through', () => {
    expect(locationOf(middleware(request('/portal/manifest.webmanifest?s=retro')))).toBeNull()
  })

  it('lets the cookie-less online sales page and its public price list through', () => {
    expect(locationOf(middleware(request('/uyelik?s=retro')))).toBeNull()
    expect(locationOf(middleware(request('/api/public/products?s=retro')))).toBeNull()
  })

  // The printed daily sheet (2026-07-27). Bouncing this loses WHICH sheet was scanned, so the
  // member logs in and lands on a dashboard having checked in to nothing.
  it('lets the scanned check-in sheet through so it can keep the token and hand it to login', () => {
    expect(locationOf(middleware(request('/g/poster%7Cbr_1%7C123%7Cjti.sig?s=retro')))).toBeNull()
  })
})

describe('DEBT-012 — a stale cookie must never become a redirect loop', () => {
  it('does NOT bounce a cookie-holding visitor away from /login', () => {
    // This is the whole bug. The middleware sees a cookie and cannot know it is dead; if it
    // bounces /login → /, the server verifies for real, finds nothing, and redirects / → /login.
    // The only escape was DevTools. `/login` verifies the session itself and redirects a genuinely
    // signed-in visitor — a decision made by the layer that can actually make it.
    expect(locationOf(middleware(request('/login', { cookie: true })))).toBeNull()
  })

  it('does not bounce her away from the member login either', () => {
    expect(locationOf(middleware(request('/portal/login', { cookie: true })))).toBeNull()
  })
})
