import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreCalendarRepository,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreOperationsRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  instant,
  systemClock,
  type BulkDeps,
  type ClosureDeps,
  type ClosureWorld,
  type Entitlement,
  type LocalDate,
  type Reservation,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'

// The world-loaders for the bulk operations (D21/D22).
//
// They are the ONLY thing the pure planners see. Everything else — the blocking rules, the
// overlap arithmetic, the skip reasons — is decided in `computeClosurePlan` / `computeBulkPlan`,
// where it can be tested without a database.

// Derived from the studio's IANA zone, never a literal (v1.27 S2). A hand-written 180 is a number
// that is right until the day the studio is not in Türkiye — and wrong silently, in a date bucket.
const OFFSET_MIN = DEFAULT_STUDIO_CONFIG.utcOffsetMinutes
const dayStartMs = (d: LocalDate): number => Date.parse(`${d}T00:00:00Z`) - OFFSET_MIN * 60_000
const dayEndMs = (d: LocalDate): number => Date.parse(`${d}T23:59:59Z`) - OFFSET_MIN * 60_000

async function loadClosureWorld(
  ctx: TenantContext,
  from: LocalDate,
  to: LocalDate,
): Promise<ClosureWorld> {
  const db = adminDb()
  const sched = new FirestoreSchedulingRepository(db)
  const resRepo = new FirestoreReservationRepository(db)

  const [sessions, entitlements, members] = await Promise.all([
    sched.listSessionsForDay(ctx, instant(dayStartMs(from)), instant(dayEndMs(to))),
    new FirestoreEntitlementRepository(db).listActive(ctx),
    new FirestoreMemberRepository(db).list(ctx),
  ])

  // One roster read per session in the range. A week is a few dozen — and the preview is a
  // deliberate, owner-initiated act, not a hot path.
  const reservationsBySession = new Map<string, readonly Reservation[]>()
  await Promise.all(
    sessions.map(async (s) => {
      reservationsBySession.set(s.id, await resRepo.listBySession(ctx, s.id))
    }),
  )

  return {
    sessions,
    reservationsBySession,
    entitlements,
    memberNames: new Map(members.map((m) => [m.id as string, m.fullName])),
  }
}

async function loadBulkWorld(
  ctx: TenantContext,
): Promise<{ entitlements: readonly Entitlement[]; memberNames: ReadonlyMap<string, string> }> {
  const db = adminDb()
  // NOT `listActive`: a bulk preview must be able to SAY that a package is frozen or expired,
  // and it cannot say so about rows it never read.
  const [entitlements, members] = await Promise.all([
    new FirestoreEntitlementRepository(db).listAll(ctx),
    new FirestoreMemberRepository(db).list(ctx),
  ])
  return {
    entitlements,
    memberNames: new Map(members.map((m) => [m.id as string, m.fullName])),
  }
}

export function closureDeps(): ClosureDeps {
  const db = adminDb()
  return {
    repo: new FirestoreOperationsRepository(db),
    clock: systemClock,
    scheduling: {
      repo: new FirestoreSchedulingRepository(db),
      clock: systemClock,
      studioConfig: DEFAULT_STUDIO_CONFIG,
      hours: new FirestoreStudioHours(adminDb()),
    },
    reservations: { repo: new FirestoreReservationRepository(db), clock: systemClock, hours: new FirestoreStudioHours(db) },
    entitlements: { repo: new FirestoreEntitlementRepository(db), clock: systemClock },
    loadWorld: loadClosureWorld,
  }
}

export function bulkDeps(): BulkDeps {
  const db = adminDb()
  return {
    repo: new FirestoreOperationsRepository(db),
    clock: systemClock,
    entitlements: { repo: new FirestoreEntitlementRepository(db), clock: systemClock },
    loadWorld: loadBulkWorld,
  }
}

export function calendarDeps() {
  return { repo: new FirestoreCalendarRepository(adminDb()), clock: systemClock }
}
