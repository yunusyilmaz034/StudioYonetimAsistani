'use server'

import {
  available,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  type Entitlement,
  type MemberId,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// PF-36 — the check-in status a receptionist needs the instant a member walks in: is her membership
// live, what is she on, and does she have a note. Read on demand (reception's client sees a new
// check-in land and asks for this). PII (her name) is fine — this is a desk-only action.
const DESK = ['owner', 'receptionist'] as const

// A package that COUNTS right now — active, started, not expired, not frozen (same predicate the
// dashboard uses, owner D-2/D-4).
const isValidNow = (e: Entitlement, nowMs: number): boolean =>
  e.status === 'active' && e.validFrom <= nowMs && e.validUntil >= nowMs && e.freeze === null

export interface CheckInStatus {
  readonly memberId: string
  readonly name: string
  readonly active: boolean // has at least one valid, live package
  readonly packageName: string | null // the soonest-to-expire live package (or "N paket")
  readonly validUntil: number | null // soonest expiry among live packages
  readonly credits: number | null // total remaining credits across live credit-packages
  readonly hasPeriodPackage: boolean // an unlimited/period membership is live (credits not the story)
  readonly hasNotice: boolean // an active "Kısıtlı Üyelik" restriction
}

export async function checkInStatusAction(input: unknown): Promise<CheckInStatus | null> {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(DESK)
  const db = adminDb()
  const nowMs = Date.now()

  const [member, entitlements] = await Promise.all([
    new FirestoreMemberRepository(db).findById(ctx, p.memberId as MemberId),
    new FirestoreEntitlementRepository(db).listActiveByMember(ctx, p.memberId as MemberId),
  ])
  if (!member) return null

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
  }
}
