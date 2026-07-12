import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// D10/D16 — the check-in token: the pure codec, so the rule can be TESTED rather than trusted.
//
// The token replaces the old static-memberId QR, which was a bearer credential with no expiry.
// Its three properties, and why each one is here:
//   • SIGNED — the memberId comes out of a signature, never out of a camera. A scanned string
//     that was not minted by this server is worth nothing.
//   • SHORT-LIVED — a screenshot is dead within a minute.
//   • SINGLE-USE (the `jti`, burned server-side) — a screenshot taken INSIDE that minute is dead
//     the moment the real member scans.

export interface QrClaims {
  readonly memberId: string
  readonly branchId: string
  readonly exp: number
  readonly jti: string
}

const signature = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url')

export function signQrToken(claims: QrClaims, secret: string): string {
  const payload = `${claims.memberId}|${claims.branchId}|${claims.exp}|${claims.jti}`
  return `${payload}.${signature(payload, secret)}`
}

export function newJti(): string {
  return randomBytes(9).toString('base64url')
}

// Returns null for ANY malformed or unsigned token. Expiry is checked by the caller, which
// knows the clock — this stays pure.
export function verifyQrToken(token: string, secret: string): QrClaims | null {
  const idx = token.lastIndexOf('.')
  if (idx < 0) return null
  const payload = token.slice(0, idx)
  const provided = token.slice(idx + 1)

  const expected = signature(payload, secret)
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // Constant-time compare: an early-exit or length-leaking check is how signature oracles start.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const [memberId, branchId, expRaw, jti] = payload.split('|')
  if (!memberId || !branchId || !expRaw || !jti) return null
  const exp = Number(expRaw)
  if (!Number.isFinite(exp)) return null
  return { memberId, branchId, exp, jti }
}
