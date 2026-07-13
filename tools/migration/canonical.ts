import { normalizePhone } from '@studio/core'

// The canonical import DTO, and the validator that decides whether a row may enter the system.
//
// ── The three rules this file exists to enforce ──────────────────────────────────────────────
//
//   1. NEVER GUESS. A row we cannot read is a row we refuse. Not a row we improve.
//   2. NEVER SILENTLY CORRECT. If a phone number is malformed, it is REPORTED, by line number,
//      and a human fixes it at the source. An importer that "helpfully" repairs data teaches the
//      studio that its own records are approximately true.
//   3. A COLLISION IS NEVER MERGED (AD-40, I-21). Two members with the same phone are two rows a
//      human must look at. Merging them is how you give one woman another woman's package.
//
// Everything here is PURE — no Firestore, no clock, no I/O — so the rules that decide what enters
// production can be tested in milliseconds, and are.

/** What BulutGym gives us, and all it gives us: a name and a phone. (Owner, 2026-07-13.) */
export interface MemberImportRow {
  readonly line: number // the line in the source file — so a human can go and look at it
  readonly fullName: string
  readonly phoneRaw: string
}

export interface ValidMember {
  readonly line: number
  readonly fullName: string
  readonly phoneE164: string
}

export type RejectionReason =
  | 'missing_name'
  | 'missing_phone'
  | 'phone_not_normalisable'
  | 'duplicate_phone'

export interface Rejection {
  readonly line: number
  readonly fullName: string
  readonly phoneRaw: string
  readonly reason: RejectionReason
  /** For a duplicate: the line it collides with. A human needs both to decide. */
  readonly collidesWithLine?: number
}

export interface ValidationReport {
  readonly total: number
  readonly valid: readonly ValidMember[]
  readonly rejected: readonly Rejection[]
}

/** True when the run may proceed. **Any** rejection blocks it (Doc 8 §7, go/no-go). */
export function isClean(report: ValidationReport): boolean {
  return report.rejected.length === 0
}

/**
 * Validate every row. Rows are NOT dropped and the run is NOT partially applied: this returns the
 * whole picture, and the caller refuses the import if a single row is bad.
 *
 * Why all-or-nothing: a partial import leaves the studio with a members list that is *almost*
 * right, and nobody can tell which half. The cost of refusing is one afternoon with a spreadsheet.
 * The cost of a half-import is discovering, in March, that a member has been missing since January.
 */
export function validateMembers(rows: readonly MemberImportRow[]): ValidationReport {
  const valid: ValidMember[] = []
  const rejected: Rejection[] = []
  const seenPhone = new Map<string, number>() // E.164 → the line that claimed it first

  for (const row of rows) {
    const fullName = row.fullName.trim()
    const phoneRaw = row.phoneRaw.trim()
    const base = { line: row.line, fullName, phoneRaw }

    if (!fullName) {
      rejected.push({ ...base, reason: 'missing_name' })
      continue
    }
    if (!phoneRaw) {
      // A member with no phone cannot be invited to the portal, cannot be found by reception's
      // search, and cannot be told her class was cancelled. She is not a record; she is a gap.
      rejected.push({ ...base, reason: 'missing_phone' })
      continue
    }

    // AD-40 — normalisation is TOTAL or the row is rejected. `05321234567` and `5321234567` both
    // occur in the source; `0532 123 45 67` does too. What never happens is a guess.
    const phone = normalizePhone(phoneRaw)
    if (!phone.ok) {
      rejected.push({ ...base, reason: 'phone_not_normalisable' })
      continue
    }

    // Dedupe on the NORMALISED key, never on the raw string. `0532 123 45 67` and `+905321234567`
    // are the same woman written two ways, and a collision check that compares raw text would let
    // her in twice — which is exactly the merge this rule exists to prevent.
    const first = seenPhone.get(phone.value.normalized)
    if (first !== undefined) {
      // REPORTED, never merged (I-21). Two rows sharing a phone might be a mother and daughter, a
      // typo, or the same woman entered twice. Only a human knows which, and only a phone call
      // settles it.
      rejected.push({ ...base, reason: 'duplicate_phone', collidesWithLine: first })
      continue
    }

    seenPhone.set(phone.value.normalized, row.line)
    valid.push({ line: row.line, fullName, phoneE164: phone.value.e164 })
  }

  return { total: rows.length, valid, rejected }
}

export const REJECTION_COPY: Record<RejectionReason, string> = {
  missing_name: 'Ad soyad boş',
  missing_phone: 'Telefon boş',
  phone_not_normalisable: 'Telefon E.164 formatına çevrilemedi (geçersiz numara)',
  duplicate_phone: 'Aynı telefon başka bir satırda daha var — birleştirilmedi, insan karar vermeli',
}
