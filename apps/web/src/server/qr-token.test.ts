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
    expect(verifyQrToken(token, SECRET)).toEqual(claims())
  })

  it('refuses a token signed with a DIFFERENT secret — the memberId comes from the signature', () => {
    const forged = signQrToken(claims(), OTHER_SECRET)
    expect(verifyQrToken(forged, SECRET)).toBeNull()
  })

  it('refuses a token whose PAYLOAD was edited — you cannot swap in another member', () => {
    const token = signQrToken(claims(), SECRET)
    const tampered = token.replace('mem_1', 'mem_2')
    expect(verifyQrToken(tampered, SECRET)).toBeNull()
  })

  it('refuses a token whose EXPIRY was pushed out', () => {
    const token = signQrToken(claims(), SECRET)
    const tampered = token.replace('1700000060000', '9999999999999')
    expect(verifyQrToken(tampered, SECRET)).toBeNull()
  })

  it('refuses a raw memberId — the OLD QR format is worth nothing now', () => {
    // This is the whole point of D10: the string the old cards carried no longer opens the door.
    expect(verifyQrToken('mem_1', SECRET)).toBeNull()
  })

  it('refuses garbage, an empty signature, and a missing field', () => {
    expect(verifyQrToken('', SECRET)).toBeNull()
    expect(verifyQrToken('mem_1|brn_1|123|jti_1', SECRET)).toBeNull() // unsigned
    expect(verifyQrToken('mem_1|brn_1|123|jti_1.', SECRET)).toBeNull() // empty signature
    expect(verifyQrToken('mem_1|brn_1.sig', SECRET)).toBeNull() // missing fields
  })

  it('refuses a non-numeric expiry rather than treating it as 0 or NaN', () => {
    // A NaN expiry compared with `Date.now() > exp` would be FALSE — i.e. it would look valid
    // forever. It is rejected outright instead.
    const token = signQrToken({ ...claims(), exp: 'soon' as unknown as number }, SECRET)
    expect(verifyQrToken(token, SECRET)).toBeNull()
  })

  it('carries a jti so the server can burn it — two mints are never the same token', () => {
    const a = signQrToken({ ...claims(), jti: newJti() }, SECRET)
    const b = signQrToken({ ...claims(), jti: newJti() }, SECRET)
    expect(a).not.toBe(b)
  })
})
