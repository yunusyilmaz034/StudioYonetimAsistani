import type { Instant, MemberId } from '../../../shared'
import type { Entitlement } from '../../entitlements'
import type { Reservation } from '../../reservations'
import type { ClassSession } from '../../scheduling'
import type {
  BlockedSession,
  BulkPlan,
  ClosurePlan,
  OperationScope,
  PlannedEntitlement,
  PlannedSession,
  SkippedEntitlement,
} from './types'

// D21 / D22 — the planners. PURE: (world, scope, now) → plan. They write nothing, and the apply
// step re-runs them against a freshly-read world rather than replaying their output.
//
// **The preview is a promise about SHAPE, never about exact counts.** Between preview and apply
// reception may book someone into a class the closure is about to cancel — so the summary the
// owner sees afterwards is the APPLIED one, not the PREVIEWED one.

const RESOLVED_STATUSES = ['attended', 'no_show'] as const

export interface ClosureWorld {
  readonly sessions: readonly ClassSession[] // sessions inside the date range
  readonly reservationsBySession: ReadonlyMap<string, readonly Reservation[]>
  readonly entitlements: readonly Entitlement[] // ALL active entitlements in the studio
  readonly memberNames: ReadonlyMap<string, string>
}

export function computeClosurePlan(
  world: ClosureWorld,
  input: {
    readonly scope: OperationScope
    readonly extensionDays: number
    readonly closureFrom: Instant
    readonly closureTo: Instant
  },
): ClosurePlan {
  const sessionsToCancel: PlannedSession[] = []
  const blockedSessions: BlockedSession[] = []
  const membersAffected = new Set<MemberId>()
  let reservationsToRelease = 0
  let creditsToRelease = 0

  for (const s of world.sessions) {
    if (!sessionInScope(s, input.scope)) continue

    if (s.status === 'cancelled') {
      blockedSessions.push({
        sessionId: s.id,
        serviceName: s.serviceName,
        startsAt: s.startsAt,
        reason: 'already_cancelled',
        detail: 'Zaten iptal edilmiş.',
      })
      continue
    }

    const reservations = world.reservationsBySession.get(s.id) ?? []

    // ── OQ-6 — the blocking rule ────────────────────────────────────────────────────────────
    // A session whose reservations were ALREADY resolved (attended / no_show) is not processed.
    // The system does not manufacture a credit that was really lost, and it does not silently
    // rewrite a past event. It refuses, reports, and waits for a human with a reason.
    const resolved = reservations.filter((r) =>
      (RESOLVED_STATUSES as readonly string[]).includes(r.status),
    )
    if (resolved.length > 0) {
      blockedSessions.push({
        sessionId: s.id,
        serviceName: s.serviceName,
        startsAt: s.startsAt,
        reason: 'already_resolved',
        detail: `${resolved.length} rezervasyon zaten sonuçlanmış (katıldı/gelmedi). Önce düzeltme yapılmalı.`,
      })
      continue
    }

    const booked = reservations.filter((r) => r.status === 'booked')
    sessionsToCancel.push({
      sessionId: s.id,
      serviceName: s.serviceName,
      startsAt: s.startsAt,
      bookedCount: booked.length,
    })
    reservationsToRelease += booked.length
    // A period booking held nothing; releasing it moves no credit.
    creditsToRelease += booked.filter((r) => r.creditEffect !== 'none').length
    for (const r of booked) membersAffected.add(r.memberId)
  }

  // ── The extension (D21.1–D21.4) ─────────────────────────────────────────────────────────
  const entitlementsToExtend: PlannedEntitlement[] = []
  const skippedEntitlements: SkippedEntitlement[] = []

  if (input.extensionDays > 0) {
    for (const e of world.entitlements) {
      const row = toPlanned(e, world)

      if (!entitlementInScope(e, input.scope)) {
        skippedEntitlements.push({ ...row, reason: 'out_of_scope' })
        continue
      }
      if (e.status === 'frozen') {
        // D21.4 — freeze arithmetic is deliberately unbuilt (DEBT-009). Extending a frozen
        // package would be doing it by the back door. Reported, never guessed.
        skippedEntitlements.push({ ...row, reason: 'frozen' })
        continue
      }
      if (e.status !== 'active') {
        skippedEntitlements.push({ ...row, reason: 'not_active' })
        continue
      }
      // D21.2 — only packages whose validity OVERLAPS the closure. One that expired before it,
      // or starts after it, was not harmed by it; extending it is a gift, not a remedy.
      if (!overlaps(e.validFrom, e.validUntil, input.closureFrom, input.closureTo)) {
        skippedEntitlements.push({ ...row, reason: 'not_overlapping' })
        continue
      }
      entitlementsToExtend.push(row)
    }
  }

  return {
    sessionsToCancel,
    blockedSessions,
    reservationsToRelease,
    creditsToRelease,
    membersAffected: [...membersAffected],
    entitlementsToExtend,
    skippedEntitlements,
  }
}

// ── D22 — the bulk plan ────────────────────────────────────────────────────────────────────
export function computeBulkPlan(
  entitlements: readonly Entitlement[],
  memberNames: ReadonlyMap<string, string>,
  scope: OperationScope,
): BulkPlan {
  const toApply: PlannedEntitlement[] = []
  const skipped: SkippedEntitlement[] = []
  const world = { memberNames } as Pick<ClosureWorld, 'memberNames'>

  for (const e of entitlements) {
    const row = toPlanned(e, world)
    if (!entitlementInScope(e, scope)) {
      skipped.push({ ...row, reason: 'out_of_scope' })
      continue
    }
    if (e.status === 'frozen') {
      skipped.push({ ...row, reason: 'frozen' })
      continue
    }
    if (e.status !== 'active') {
      skipped.push({ ...row, reason: 'not_active' }) // expired / cancelled
      continue
    }
    toApply.push(row)
  }
  return { toApply, skipped }
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────

function toPlanned(e: Entitlement, world: Pick<ClosureWorld, 'memberNames'>): PlannedEntitlement {
  return {
    entitlementId: e.id,
    memberId: e.memberId,
    memberName: world.memberNames.get(e.memberId) ?? '—',
    productName: e.productSnapshot.name,
    validUntil: e.validUntil,
  }
}

// Two ranges overlap unless one ends before the other begins. Inclusive on both ends: a package
// that expires ON the first day of the closure lost that day.
const overlaps = (aFrom: number, aTo: number, bFrom: number, bTo: number): boolean =>
  aFrom <= bTo && aTo >= bFrom

function sessionInScope(s: ClassSession, scope: OperationScope): boolean {
  switch (scope.kind) {
    case 'studio':
      return true
    case 'category':
      return scope.categories.includes(s.category)
    case 'service':
      return scope.serviceIds.includes(s.serviceId)
    // A closure scoped to a product or to named members says nothing about WHICH CLASSES stop
    // running — only about whose packages are extended. Cancelling classes for "members X and Y"
    // is not a thing: a class is cancelled for everyone in it or for nobody.
    case 'product':
    case 'members':
      return false
  }
}

function entitlementInScope(e: Entitlement, scope: OperationScope): boolean {
  switch (scope.kind) {
    case 'studio':
      return true
    case 'category':
      return scope.categories.includes(e.productSnapshot.category)
    case 'service': {
      const covered = e.productSnapshot.serviceIds
      // A LEGACY package (no service list) covers its whole category — so a service-scoped act
      // reaches it if the service belongs to that category. We cannot know that here without the
      // service, so the caller narrows by category too; absent a list we include it, which is the
      // same category-wide reading D12 gives everywhere else.
      return covered === undefined || covered.some((id) => scope.serviceIds.includes(id))
    }
    case 'product':
      return scope.productIds.includes(e.productSnapshot.productId)
    case 'members':
      return scope.memberIds.includes(e.memberId)
  }
}
