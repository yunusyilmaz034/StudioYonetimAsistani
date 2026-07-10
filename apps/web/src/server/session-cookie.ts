import { cookies } from 'next/headers'

import { SESSION_COOKIE_NAME } from './session-config'

// Read the raw session cookie (server only — uses next/headers). Verification is
// in auth.ts; the pure config lives in session-config.ts so the edge middleware
// can share the cookie name without importing next/headers.
export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION_COOKIE_NAME)?.value ?? null
}
