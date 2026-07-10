'use server'

import { cookies } from 'next/headers'

import { adminAuth } from '../firebase-admin'
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  sessionCookieOptions,
} from '../session-config'

// Exchange a freshly-minted Firebase ID token for an httpOnly session cookie.
// `createSessionCookie` verifies the ID token; an invalid one throws and no cookie
// is set. The client calls this immediately after email/password sign-in.
export async function createSession(idToken: string): Promise<{ ok: true }> {
  const sessionCookie = await adminAuth().createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  })
  const store = await cookies()
  store.set(SESSION_COOKIE_NAME, sessionCookie, sessionCookieOptions())
  return { ok: true }
}

// Clear the session cookie. The client also signs out of the Firebase client SDK.
export async function destroySession(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE_NAME)
}
