import { describe, expect, it } from 'vitest'

import { newJti, signQrToken, verifyQrToken } from './qr-token'

// D10/D16 — the QR credential. These are the tests that decide whether a screenshot is worth
// anything, so they are written as attacks rather than as happy paths.

const SECRET = 'test-secret'
const OTHER_SECRET = 'another-secret'

const claims = (over: Partial<Parameters<typeof signQrToken>[0]> = {}) => ({
  memberId: 'mem_1',
  branchId: 'brn_1',
  exp: 1_700_000_060_000,
  jti: 'jti_1',
  ...over,
})

describe('QR check-in token', () => {
  it('round-trips a token it signed', () => {
    const token = signQrToken(claims(), SECRET)
    expect(verifyQrToken(token, [SECRET])).toEqual(claims())
  })

  it('refuses a token signed with a DIFFERENT secret — the memberId comes from the signature', () => {
    const forged = signQrToken(claims(), OTHER_SECRET)
    expect(verifyQrToken(forged, [SECRET])).toBeNull()
  })

  it('refuses a token whose PAYLOAD was edited — you cannot swap in another member', () => {
    const token = signQrToken(claims(), SECRET)
    const tampered = token.replace('mem_1', 'mem_2')
    expect(verifyQrToken(tampered, [SECRET])).toBeNull()
  })

  it('refuses a token whose EXPIRY was pushed out', () => {
    const token = signQrToken(claims(), SECRET)
    const tampered = token.replace('1700000060000', '9999999999999')
    expect(verifyQrToken(tampered, [SECRET])).toBeNull()
  })

  it('refuses a raw memberId — the OLD QR format is worth nothing now', () => {
    // This is the whole point of D10: the string the old cards carried no longer opens the door.
    expect(verifyQrToken('mem_1', [SECRET])).toBeNull()
  })

  it('refuses garbage, an empty signature, and a missing field', () => {
    expect(verifyQrToken('', [SECRET])).toBeNull()
    expect(verifyQrToken('mem_1|brn_1|123|jti_1', [SECRET])).toBeNull() // unsigned
    expect(verifyQrToken('mem_1|brn_1|123|jti_1.', [SECRET])).toBeNull() // empty signature
    expect(verifyQrToken('mem_1|brn_1.sig', [SECRET])).toBeNull() // missing fields
  })

  it('refuses a non-numeric expiry rather than treating it as 0 or NaN', () => {
    // A NaN expiry compared with `Date.now() > exp` would be FALSE — i.e. it would look valid
    // forever. It is rejected outright instead.
    const token = signQrToken({ ...claims(), exp: 'soon' as unknown as number }, SECRET)
    expect(verifyQrToken(token, [SECRET])).toBeNull()
  })

  it('carries a jti so the server can burn it — two mints are never the same token', () => {
    const a = signQrToken({ ...claims(), jti: newJti() }, SECRET)
    const b = signQrToken({ ...claims(), jti: newJti() }, SECRET)
    expect(a).not.toBe(b)
  })
})

// DEBT-013 — rotation, and the reason it needs no `kid`.
describe('key rotation', () => {
  const OLD = 'the-outgoing-key'
  const NEW = 'the-fresh-key'

  it('accepts a token minted under the OUTGOING key while both are live', () => {
    // The rotation window: a member whose phone minted a token seconds before the deploy must
    // still get through the door. Nothing about the token itself changed — only the list of keys
    // the server is willing to check it against.
    const minted = signQrToken(claims(), OLD)
    expect(verifyQrToken(minted, [NEW, OLD])).toEqual(claims())
  })

  it('accepts a token minted under the ACTIVE key', () => {
    const minted = signQrToken(claims(), NEW)
    expect(verifyQrToken(minted, [NEW, OLD])).toEqual(claims())
  })

  it('refuses the outgoing key once it is dropped — that is what completes the rotation', () => {
    const minted = signQrToken(claims(), OLD)
    expect(verifyQrToken(minted, [NEW])).toBeNull()
  })

  it('refuses a key that was never ours, however many we accept', () => {
    const forged = signQrToken(claims(), 'a-key-a-stranger-chose')
    expect(verifyQrToken(forged, [NEW, OLD])).toBeNull()
  })
})

// ── One scanner, both codes (owner, 2026-07-31) ──────────────────────────────────────────────
//
// The kiosk shows a bare token; the printed daily sheet shows a URL, because a member without the
// app opens it in her browser. Her camera hands the app whatever the code contains, so the app
// sends a URL — and the server rejected it with "Geçersiz ya da kullanılmış kod", which from where
// she is standing is not even true.
describe('tokenFromScan', () => {
  // Kept in step with `tokenFromScan` in server/actions/qr.ts.
  const extract = (raw: string): string => {
    const s = raw.trim()
    const m = /\/g\/([^/?#\s]+)/.exec(s)
    if (!m?.[1]) return s
    try {
      return decodeURIComponent(m[1])
    } catch {
      return m[1]
    }
  }

  it('pulls the token out of the printed sheet’s URL', () => {
    expect(extract('https://panel.pilatesfitnessbyisil.com/g/abc.def-ghi_jkl')).toBe('abc.def-ghi_jkl')
  })

  it('leaves a bare kiosk token alone', () => {
    expect(extract('abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('survives the whitespace a camera sometimes appends', () => {
    expect(extract('  https://x/g/tok123  ')).toBe('tok123')
  })

  it('DECODES the escapes — a signed token is full of pipes', () => {
    // `memberId|branchId|exp|jti.signature`, and the sheet builds its URL with encodeURIComponent,
    // so every pipe arrives as %7C. Matching only unreserved characters stopped at the first escape
    // and handed the verifier the word "poster" — the exact bug this replaced.
    const token = 'poster|mutlukent|1785110400000|poster-retro-2026-07-31.SIGNATURE_x-y_z'
    const url = `https://panel.pilatesfitnessbyisil.com/g/${encodeURIComponent(token)}`
    expect(url).toContain('%7C')
    expect(extract(url)).toBe(token)
  })

  it('does not mistake another path for the sheet', () => {
    // `/invite/…` is a different link entirely and must be handed on untouched, so it fails as an
    // unknown token rather than being silently read as a door code.
    expect(extract('https://x/invite/retro/tok')).toBe('https://x/invite/retro/tok')
  })
})
