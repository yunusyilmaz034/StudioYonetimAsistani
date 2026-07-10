import { err, ok, type Result } from '../../../shared'

import type { PhoneE164 } from './member'

// Turkish mobile phone normalisation to E.164 (E3, AD-40). Total or it fails —
// a number that cannot be coerced to a valid TR mobile is never guessed at
// (invalid_phone). Landlines and malformed numbers are rejected.

export interface NormalizedPhone {
  readonly e164: PhoneE164 // '+905321234567'
  readonly normalized: string // '905321234567' — digits only, the uniqueness key
}

// TR mobile national number: leading 5, then 9 digits (10 total, e.g. 5321234567).
const TR_MOBILE_NSN = /^5\d{9}$/

export function normalizePhone(raw: string): Result<NormalizedPhone> {
  const digits = raw.replace(/\D/g, '')

  // Accept: 5XXXXXXXXX (10), 05XXXXXXXXX (11, leading 0), 905XXXXXXXXX (12, +90).
  let nsn: string
  if (digits.length === 10 && digits.startsWith('5')) {
    nsn = digits
  } else if (digits.length === 11 && digits.startsWith('05')) {
    nsn = digits.slice(1)
  } else if (digits.length === 12 && digits.startsWith('90')) {
    nsn = digits.slice(2)
  } else {
    return err({ code: 'invalid_phone', value: raw })
  }

  if (!TR_MOBILE_NSN.test(nsn)) {
    return err({ code: 'invalid_phone', value: raw })
  }

  return ok({
    e164: `+90${nsn}` as PhoneE164,
    normalized: `90${nsn}`,
  })
}
