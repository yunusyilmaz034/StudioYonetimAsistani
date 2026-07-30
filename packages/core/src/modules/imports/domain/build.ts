import type { Instant, MemberId, ProductId } from '../../../shared'
import { MEMBER_FIELDS, PACKAGE_FIELDS } from './fields'
import { cellFor } from './headers'
import { foldName, matchMember, type MatchCandidate, type MatchOutcome } from './match'
import { parseBirthDate, parseCount, parseDate } from './parse'
import type { MemberDraft, PackageDraft } from './types'

// ROWS → WHAT WOULD HAPPEN. Pure, and it is what the preview screen renders.
//
// Nothing here writes. The operator sees exactly this list, row by row, before anything is
// committed — which is the only reason it is safe to let a spreadsheet touch a live studio at all.

export type RowStatus = 'ready' | 'rejected'

export interface RejectedRow {
  readonly line: number
  readonly status: 'rejected'
  /** Turkish, and specific enough to fix by opening the file at that line. */
  readonly reason: string
  readonly preview: string
}

export interface MemberRow {
  readonly line: number
  readonly status: 'ready'
  readonly draft: MemberDraft
  readonly phoneE164: string
  /** Set when this phone already belongs to a member — reported, never merged (AD-40). */
  readonly duplicateOf: MemberId | null
}

export interface PackageRow {
  readonly line: number
  readonly status: 'ready'
  readonly productId: ProductId
  readonly productName: string
  readonly memberName: string
  readonly phoneE164: string | null
  readonly remainingCredits: number | null
  readonly validFrom: Instant
  readonly validUntil: Instant
  readonly note: string | null
  /** How the owner of this package was found. A proposal is NOT a decision — see `match.ts`. */
  readonly match: MatchOutcome
}

export interface BuildMembersResult {
  readonly ready: readonly MemberRow[]
  readonly rejected: readonly RejectedRow[]
}

export interface BuildPackagesResult {
  readonly ready: readonly PackageRow[]
  readonly rejected: readonly RejectedRow[]
  /** Package names in the file that match nothing in the catalogue. Reported, never guessed at. */
  readonly unknownProducts: readonly string[]
}

export type Mapping = Readonly<Record<string, number | null>>
export type Defaults = Readonly<Record<string, string>>

/** A phone normaliser, injected so this module stays free of the members module (one door each). */
export type NormalizePhone = (raw: string) => { e164: string; normalized: string } | null

const preview = (row: readonly string[]): string => row.slice(0, 4).join(' · ').slice(0, 80)

export function buildMembers(
  rows: readonly (readonly string[])[],
  mapping: Mapping,
  defaults: Defaults,
  existing: readonly MatchCandidate[],
  normalizePhone: NormalizePhone,
  headerRowIndex: number,
): BuildMembersResult {
  const ready: MemberRow[] = []
  const rejected: RejectedRow[] = []
  // Phones claimed EARLIER IN THIS FILE. A file that lists the same woman twice is common and must
  // not produce two members; the second occurrence is rejected pointing at the first's line.
  const seenInFile = new Map<string, number>()

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i]!
    const line = i + 1
    const get = (k: string) => cellFor(row, mapping, defaults, k)

    const fullName = get('fullName')
    if (!fullName) {
      rejected.push({ line, status: 'rejected', reason: 'Ad Soyad boş', preview: preview(row) })
      continue
    }

    const phone = normalizePhone(get('phone'))
    if (!phone) {
      rejected.push({
        line,
        status: 'rejected',
        reason: get('phone') ? `Telefon okunamadı: ${get('phone')}` : 'Telefon boş',
        preview: preview(row),
      })
      continue
    }

    const earlier = seenInFile.get(phone.normalized)
    if (earlier !== undefined) {
      rejected.push({
        line,
        status: 'rejected',
        reason: `Bu telefon dosyada ${earlier}. satırda da var`,
        preview: preview(row),
      })
      continue
    }
    seenInFile.set(phone.normalized, line)

    ready.push({
      line,
      status: 'ready',
      phoneE164: phone.e164,
      duplicateOf: existing.find((m) => m.phoneNormalized === phone.normalized)?.memberId ?? null,
      draft: {
        line,
        fullName,
        phoneRaw: get('phone'),
        email: get('email') || null,
        birthDate: parseBirthDate(get('birthDate')),
        notes: get('notes') || null,
      },
    })
  }

  return { ready, rejected }
}

/** The catalogue, reduced to what matching a package name needs. */
export interface ProductCandidate {
  readonly productId: ProductId
  readonly name: string
}

export function buildPackages(
  rows: readonly (readonly string[])[],
  mapping: Mapping,
  defaults: Defaults,
  existing: readonly MatchCandidate[],
  products: readonly ProductCandidate[],
  normalizePhone: NormalizePhone,
  utcOffsetMinutes: number,
  today: Instant,
  headerRowIndex: number,
): BuildPackagesResult {
  const ready: PackageRow[] = []
  const rejected: RejectedRow[] = []
  const unknown = new Set<string>()
  // Folded product name → id. Folding is the same one names use, so "Reformer Pilates - 8 Ders" and
  // "reformer pilates 8 ders" are the same package — punctuation and case are not information here.
  const byName = new Map(products.map((p) => [foldName(p.name), p.productId]))

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i]!
    const line = i + 1
    const get = (k: string) => cellFor(row, mapping, defaults, k)

    const memberName = get('fullName')
    if (!memberName) {
      rejected.push({ line, status: 'rejected', reason: 'Ad Soyad boş', preview: preview(row) })
      continue
    }

    const productName = get('productName')
    const productId = byName.get(foldName(productName))
    if (!productId) {
      // Reported, never guessed. A wrong package id is a right in the wrong CATEGORY — a pilates
      // credit that opens the gym — and the category wall is the one thing the UI cannot repair.
      if (productName) unknown.add(productName)
      rejected.push({
        line,
        status: 'rejected',
        reason: productName ? `Katalogda böyle bir paket yok: ${productName}` : 'Paket boş',
        preview: preview(row),
      })
      continue
    }

    const validUntil = parseDate(get('validUntil'), utcOffsetMinutes)
    if (validUntil === null) {
      rejected.push({
        line,
        status: 'rejected',
        reason: get('validUntil') ? `Bitiş tarihi okunamadı: ${get('validUntil')}` : 'Bitiş tarihi boş',
        preview: preview(row),
      })
      continue
    }

    const validFrom = parseDate(get('validFrom'), utcOffsetMinutes) ?? today
    if (validFrom > validUntil) {
      rejected.push({ line, status: 'rejected', reason: 'Başlangıç tarihi bitişten sonra', preview: preview(row) })
      continue
    }

    const rawCredits = get('remainingCredits')
    const remainingCredits = parseCount(rawCredits)
    if (rawCredits && remainingCredits === null) {
      rejected.push({ line, status: 'rejected', reason: `Kalan ders okunamadı: ${rawCredits}`, preview: preview(row) })
      continue
    }

    const phone = normalizePhone(get('phone'))
    ready.push({
      line,
      status: 'ready',
      productId,
      productName,
      memberName,
      phoneE164: phone?.e164 ?? null,
      remainingCredits,
      validFrom,
      validUntil,
      note: get('note') || null,
      match: matchMember(phone?.normalized ?? null, memberName, existing),
    })
  }

  return { ready, rejected, unknownProducts: [...unknown] }
}

/** The package rows an operator still has to resolve before anything can be applied. */
export function needsDecision(rows: readonly PackageRow[]): readonly PackageRow[] {
  return rows.filter((r) => r.match.kind !== 'phone')
}

/** Turn a resolved package row into the draft the apply step consumes. */
export function toPackageDraft(row: PackageRow, memberId: MemberId | null): PackageDraft {
  return {
    line: row.line,
    memberId,
    newMember:
      memberId === null
        ? { line: row.line, fullName: row.memberName, phoneRaw: row.phoneE164 ?? '', email: null, birthDate: null, notes: null }
        : null,
    productId: row.productId,
    remainingCredits: row.remainingCredits,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    note: row.note,
  }
}

/** Field keys the operator must supply when the file has no column for them. */
export function missingRequired(kind: 'members' | 'member_packages', mapping: Mapping): readonly string[] {
  const fields = kind === 'members' ? MEMBER_FIELDS : PACKAGE_FIELDS
  return fields.filter((f) => f.required && mapping[f.key] == null).map((f) => f.key)
}
