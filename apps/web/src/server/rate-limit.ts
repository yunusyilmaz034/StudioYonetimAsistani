import { createHash } from 'node:crypto'

import { headers } from 'next/headers'

import { adminDb } from './firebase-admin'

// A small fixed-window rate limiter for UNAUTHENTICATED public actions (the /pay buyer form). The
// authenticated surfaces are already gated by role + a verified session; this is the one door with no
// session behind it, so it gets a throttle. Keyed by a HASH of the caller's IP (never the raw IP —
// no PII in the limiter), scoped to the studio. Returns true if allowed, false if over the limit.

async function clientIpHash(): Promise<string> {
  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
  return createHash('sha256').update(ip).digest('hex').slice(0, 24)
}

export async function allowRate(studioId: string, action: string, limit: number, windowMs: number): Promise<boolean> {
  const key = `${action}_${await clientIpHash()}`
  const ref = adminDb().doc(`studios/${studioId}/rateLimits/${key}`)
  const now = Date.now()
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const d = snap.data() as { count?: number; windowStart?: number } | undefined
    if (!d || now - (d.windowStart ?? 0) > windowMs) {
      tx.set(ref, { count: 1, windowStart: now })
      return true
    }
    if ((d.count ?? 0) >= limit) return false
    tx.update(ref, { count: (d.count ?? 0) + 1 })
    return true
  })
}
