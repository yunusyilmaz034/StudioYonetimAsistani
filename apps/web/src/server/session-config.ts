// Session-cookie settings — PURE and edge-safe (no next/headers, no Node APIs), so
// the middleware (edge runtime) can import the cookie name without pulling
// server-only code. Centralised per v1.5 decision #2. Firebase Hosting requires
// the cookie be named exactly `__session` for SSR.
export const SESSION_COOKIE_NAME = '__session'

// 5 days — the maximum a Firebase session cookie may live.
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000

export interface SessionCookieOptions {
  readonly httpOnly: true
  readonly secure: boolean
  readonly sameSite: 'lax'
  readonly path: '/'
  readonly maxAge: number // seconds
}

// Production behaviour is the default: httpOnly + Secure + SameSite=Lax. The only
// relaxation is `secure` off non-production (browsers drop Secure cookies over
// http://localhost, where the emulator runs) — the emulator is a config
// difference, not a different security model.
export function sessionCookieOptions(
  maxAgeMs: number = SESSION_MAX_AGE_MS,
): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  }
}
