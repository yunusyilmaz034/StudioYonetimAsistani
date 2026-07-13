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
//
// ── Rotation (DEBT-013). ────────────────────────────────────────────────────────────────
// Verification accepts a LIST of secrets; minting uses only the first. That is the whole
// rotation mechanism: publish the new secret as the active one, keep the outgoing one in the
// list for a window, then drop it. No token minted under the old key is ever rejected while
// both are live.
//
// Deliberately NOT a `kid` in the token, which is what DEBT-013 originally proposed. A key id
// buys the ability to tell which key signed a token — and pays for it with a permanent change
// to the token format. These tokens live for SIXTY SECONDS: two secrets on the verify side
// achieve zero-downtime rotation with no format at all, and the second HMAC costs nothing
// measurable. Simple beats clever; the format we never changed is the one we can never break.
export function verifyQrToken(token: string, secrets: readonly string[]): QrClaims | null {
  const idx = token.lastIndexOf('.')
  if (idx < 0) return null
  const payload = token.slice(0, idx)
  const provided = token.slice(idx + 1)

  // Every candidate is checked in constant time, and the loop does not stop early on a match:
  // an early exit would leak, through timing, WHICH key verified a token.
  let verified = false
  for (const secret of secrets) {
    const expected = signature(payload, secret)
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)
    // Constant-time compare: an early-exit or length-leaking check is how signature oracles start.
    if (a.length === b.length && timingSafeEqual(a, b)) verified = true
  }
  if (!verified) return null

  const [memberId, branchId, expRaw, jti] = payload.split('|')
  if (!memberId || !branchId || !expRaw || !jti) return null
  const exp = Number(expRaw)
  if (!Number.isFinite(exp)) return null
  return { memberId, branchId, exp, jti }
}
