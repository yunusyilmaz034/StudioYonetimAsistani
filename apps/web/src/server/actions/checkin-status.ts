'use server'

import {
  available,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  type Entitlement,
  type MemberId,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// PF-36 — the check-in status a receptionist needs the instant a member walks in: is her membership
// live, what is she on, and does she have a note. Read on demand (reception's client sees a new
// check-in land and asks for this). PII (her name) is fine — this is a desk-only action.
// DESK (owner, 2026-08-03) — trainers now cover reception in practice ("bizim hocalar biraz da
// resepsiyona bakıyor"), so the reservation agenda and check-in are theirs too. They are not full
// reception: the members list, the till, the funnel and the reports stay closed. Every write here
// already records WHO did it, which is what makes widening it safe rather than merely convenient.
const DESK = ['owner', 'receptionist', 'trainer'] as const

// A package that COUNTS right now — active, started, not expired, not frozen (same predicate the
// dashboard uses, owner D-2/D-4).
const isValidNow = (e: Entitlement, nowMs: number): boolean =>
// "Dondurulmuş mu?" — `freeze` NON-NULL means the package HAS a freeze allowance, not that it is
// frozen right now. Currently frozen is `freeze.activeFrom !== null` (types.ts: "LocalDate ⇔
// currently frozen"). Checking `freeze === null` therefore treated every package that MERELY ALLOWS
// freezing as invalid — in this studio that is the Fitness 3-Aylık membership, so six paying members
// were being counted as having no live package (2026-07-27).
  e.status === 'active' && e.validFrom <= nowMs && e.validUntil >= nowMs && e.freeze?.activeFrom == null

export interface CheckInStatus {
  readonly memberId: string
  readonly name: string
  readonly active: boolean // has at least one valid, live package
  readonly packageName: string | null // the soonest-to-expire live package (or "N paket")
  readonly validUntil: number | null // soonest expiry among live packages
  readonly credits: number | null // total remaining credits across live credit-packages
  readonly hasPeriodPackage: boolean // an unlimited/period membership is live (credits not the story)
  readonly hasNotice: boolean // an active "Kısıtlı Üyelik" restriction
  // The class this arrival belongs to, if any (2026-07-27). Reception's toast is the only place the
  // desk finds out that a scan ALSO closed a yoklama — without it the attendance mark happens
  // invisibly and nobody at the desk can tell whether it worked.
  readonly attendance: { readonly startsAt: number; readonly resolved: boolean } | null
}

// The window either side of NOW in which a booking is plausibly "the class she just walked in for".
// Read-side only — the write side's window is studio data and lives in the domain decision.
const NEAR_MS = 90 * 60_000

export async function checkInStatusAction(input: unknown): Promise<CheckInStatus | null> {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(DESK)
  const db = adminDb()
  const nowMs = Date.now()

  const [member, entitlements, reservations] = await Promise.all([
    new FirestoreMemberRepository(db).findById(ctx, p.memberId as MemberId),
    new FirestoreEntitlementRepository(db).listActiveByMember(ctx, p.memberId as MemberId),
    new FirestoreReservationRepository(db)
      .listByMember(ctx, p.memberId as MemberId)
      .catch(() => []),
  ])
  if (!member) return null

  // Nearest booking around now — `attended` included, because by the time this read runs the scan
  // has usually already resolved it, and reporting "no class" then would be the opposite of the truth.
  const near = reservations
    .filter(
      (r) =>
        (r.status === 'booked' || r.status === 'attended') &&
        Math.abs(r.sessionStartsAt - nowMs) <= NEAR_MS,
    )
    .sort((a, b) => Math.abs(a.sessionStartsAt - nowMs) - Math.abs(b.sessionStartsAt - nowMs))[0]

  const live = entitlements.filter((e) => isValidNow(e, nowMs)).sort((a, b) => a.validUntil - b.validUntil)
  const creditPkgs = live.filter((e) => e.credits !== null)
  const credits = creditPkgs.length > 0 ? creditPkgs.reduce((sum, e) => sum + available(e.credits!), 0) : null

  return {
    memberId: p.memberId,
    name: member.fullName,
    active: live.length > 0,
    packageName: live.length === 0 ? null : live.length === 1 ? live[0]!.productSnapshot.name : `${live.length} paket`,
    validUntil: live[0]?.validUntil ?? null,
    credits,
    hasPeriodPackage: live.some((e) => e.credits === null),
    hasNotice: member.restriction !== null,
    attendance: near ? { startsAt: near.sessionStartsAt, resolved: near.status === 'attended' } : null,
  }
}
