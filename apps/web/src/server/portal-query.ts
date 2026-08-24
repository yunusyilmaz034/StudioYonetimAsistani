import {
  occupiedSeats,
  available,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  moneyByEntitlement,
  systemClock,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  instant,
  isEligibleForService,
  selectEntitlement,
  type Category,
  type ClassSession,
  type Entitlement,
  type MemberId,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'

// The member portal's reads (v1.21, Batches 6–7).
//
// Every one of them is scoped by a `memberId` that came out of the VERIFIED session cookie —
// never out of a request body. There is no parameter to forge because there is no parameter:
// the callers take a `MemberContext`, not a member id.
//
// Eligibility is NOT re-derived here. It calls `isEligibleForService` — the same predicate the
// booking decider uses — so the agenda can never show a class the server would refuse, nor hide
// one it would have allowed.

const DAY_MS = 86_400_000

// "Fit Paket" gibi kapsayıcı bir ders türünde, bu seansın gerçekte ne olduğunu ADIN İÇİNE koyar.
//
// Composed here rather than stored: `serviceName` is denormalised onto the session and reports group
// by it, so writing "Fit Paket · CrossFit" into the row would split one class type into as many as
// there are weeks. The member needs the words; the ledger needs the type.
//
// It rides in `serviceName` because that is the only field the member app already renders — so
// every installed build shows it, with no store release.
function displayName(s: { serviceName: string; contentLabel?: string }): string {
  return s.contentLabel?.trim() ? `${s.serviceName} · ${s.contentLabel.trim()}` : s.serviceName
}

export const PORTAL_LIMITS = {
  agendaDays: 30, // how far ahead she may look/book (bounded by policy.maxDaysInAdvance too)
  pastReservations: 20,
} as const

export interface PortalPackage {
  readonly entitlementId: string
  readonly productName: string
  readonly category: string
  readonly remaining: number | null // null = unlimited (a period package has no counter)
  readonly validUntil: number
  readonly balanceDue: number
}

export interface PortalReservation {
  readonly reservationId: string
  readonly sessionId: string
  readonly serviceName: string
  readonly trainerName: string | null
  readonly roomName: string | null
  readonly category: string
  readonly startsAt: number
  readonly endsAt: number
  readonly status: string
  readonly cancellationWindowHours: number
  readonly lateCancellationConsumesCredit: boolean
}

export interface PortalDashboard {
  readonly memberName: string
  readonly upcoming: readonly PortalReservation[]
  readonly packages: readonly PortalPackage[]
  readonly balanceDue: number
}

// ── Dashboard ─────────────────────────────────────────────────────────────────────────────
export async function loadPortalDashboard(
  ctx: TenantContext,
  memberId: MemberId,
  nowMs: number,
): Promise<PortalDashboard> {
  const db = adminDb()
  const [member, entitlements, reservations] = await Promise.all([
    new FirestoreMemberRepository(db).findById(ctx, memberId),
    new FirestoreEntitlementRepository(db).listActiveByMember(ctx, memberId),
    new FirestoreReservationRepository(db).listByMember(ctx, memberId),
  ])
  if (!member) throw new Error('member not found')

  const upcomingRes = reservations
    .filter((r) => r.status === 'booked' && r.sessionStartsAt > nowMs)
    .sort((a, b) => a.sessionStartsAt - b.sessionStartsAt)
    .slice(0, 5)

  const sessions = await loadSessions(ctx, upcomingRes.map((r) => r.classSessionId))

  // Her balance comes from the LEDGER (Alpha Review). It used to be read off the entitlement — with
  // `Number(e.priceAgreed)` on a `Money` OBJECT, which is `NaN`. The member portal has been showing
  // her a number that was never a number.
  const ledger = await moneyByEntitlement(
    { repo: new FirestoreFinanceRepository(adminDb()), clock: systemClock },
    ctx,
    memberId,
  )

  return {
    memberName: member.fullName,
    upcoming: upcomingRes.flatMap((r) => {
      const s = sessions.get(r.classSessionId)
      return s ? [toPortalReservation(r.id, r.status, s)] : []
    }),
    packages: entitlements.map((e) => ({
      entitlementId: e.id,
      productName: e.productSnapshot.name,
      category: e.productSnapshot.category,
      remaining: e.credits ? (e.status === 'active' ? available(e.credits) : 0) : null,
      validUntil: e.validUntil,
      balanceDue: ledger.get(e.id as string)?.due.amount ?? 0,
    })),
    balanceDue: entitlements.reduce((n, e) => n + (ledger.get(e.id as string)?.due.amount ?? 0), 0),
  }
}

// ── The agenda: what a member may SEE ─────────────────────────────────────────────────────
//
// visible(session) = (some active entitlement is eligible for its service, at its start time)
//                AND (the PT slot is open, OR it is reserved for HER)
//
// A member with the right package but NO credit left still SEES her classes — she just cannot
// book them, and the screen says why. Hiding them would be a lie about what the studio offers.
export interface PortalSession {
  readonly sessionId: string
  readonly serviceName: string
  readonly category: string
  readonly trainerName: string | null
  readonly roomName: string | null
  readonly startsAt: number
  readonly endsAt: number
  readonly capacity: number
  readonly bookedCount: number
  readonly cancellationWindowHours: number
  readonly isAssignedToMe: boolean
  readonly alreadyBooked: boolean
  // Why she cannot book it (null = she can). Computed server-side from the SAME rules the
  // decider enforces; the client never decides this.
  readonly blockedReason: 'full' | 'no_credit' | 'self_booking_off' | 'past' | null
  /**
   * What booking this class will actually COST her — computed from the same selector the booking
   * uses, so the confirmation screen cannot promise one thing while the domain does another.
   *
   * `null` when she cannot book it at all. It exists because Fit Paket made the answer stop being
   * obvious: at the same class a credit-holder spends a credit and an unlimited membership spends
   * nothing, and until now the screen said neither (owner, 2026-08-22: "çat diye rezerve ediyor").
   */
  readonly cost:
    | { readonly kind: 'credit'; readonly remainingAfter: number }
    | { readonly kind: 'unlimited' }
    | null
}

export interface PortalAgenda {
  readonly sessions: readonly PortalSession[]
  readonly hasActivePackage: boolean
}

export async function loadPortalAgenda(
  ctx: TenantContext,
  memberId: MemberId,
  nowMs: number,
): Promise<PortalAgenda> {
  const db = adminDb()
  const sched = new FirestoreSchedulingRepository(db)

  const [entitlements, reservations, sessions] = await Promise.all([
    new FirestoreEntitlementRepository(db).listActiveByMember(ctx, memberId),
    new FirestoreReservationRepository(db).listByMember(ctx, memberId),
    sched.listSessionsForDay(ctx, instant(nowMs), instant(nowMs + PORTAL_LIMITS.agendaDays * DAY_MS)),
  ])

  const bookedSessionIds = new Set(
    reservations.filter((r) => r.status === 'booked').map((r) => r.classSessionId as string),
  )

  const visible: PortalSession[] = []
  for (const s of sessions) {
    if (s.status !== 'scheduled') continue
    if (s.startsAt <= nowMs) continue

    // D13 — a PT slot reserved for someone else is invisible to her. An OPEN slot is not.
    const assigned = s.assignedMemberId ?? null
    if (assigned !== null && assigned !== memberId) continue

    // D12 — the union of what her packages cover, judged at the session's start time.
    const eligible = entitlements.filter((e) =>
      isEligibleForServiceAt(e, s, instant(s.startsAt)),
    )
    const anyCategoryMatch = entitlements.some((e) => coversAt(e, s))
    if (eligible.length === 0 && !anyCategoryMatch) continue

    visible.push({
      sessionId: s.id,
      serviceName: displayName(s),
      category: s.category,
      trainerName: s.trainerName,
      roomName: s.roomName,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      capacity: s.capacity,
      bookedCount: occupiedSeats(s),
      cancellationWindowHours: s.policySnapshot.cancellationWindowHours,
      isAssignedToMe: assigned === memberId,
      alreadyBooked: bookedSessionIds.has(s.id),
      blockedReason: blockedReason(s, eligible),
      cost: bookingCost(s, eligible),
    })
  }

  visible.sort((a, b) => a.startsAt - b.startsAt)
  return { sessions: visible, hasActivePackage: entitlements.length > 0 }
}

/**
 * What the booking will take, decided by the SAME `selectEntitlement` the booking runs — never a
 * second guess written for the screen. A credit package spends one credit; an unlimited membership
 * spends nothing. Anything we cannot answer stays `null` rather than being narrated hopefully.
 */
function bookingCost(s: ClassSession, eligible: readonly Entitlement[]): PortalSession['cost'] {
  const chosen = selectEntitlement(eligible, s, instant(s.startsAt))
  if (!chosen) return null
  if (!chosen.credits) return { kind: 'unlimited' }
  // `available` already subtracts what is held, so this is the number she will see afterwards.
  return { kind: 'credit', remainingAfter: Math.max(0, available(chosen.credits) - 1) }
}

// A session she can see but not book, and the honest reason.
function blockedReason(s: ClassSession, eligible: readonly Entitlement[]): PortalSession['blockedReason'] {
  if (!s.policySnapshot.allowMemberSelfBooking) return 'self_booking_off'
  if (eligible.length === 0) return 'no_credit' // right package, nothing left to spend
  if (s.bookedCount >= s.capacity) return 'full'
  return null
}

// WHO THIS SESSION ADMITS — read from the session, never assumed to be its own category.
//
// 2026-08-21: the Fit Paket sessions were invisible to fitness members. `decideBooking` had been
// widened and `selectEntitlement` had been widened, but THIS file still compared against
// `s.category`, so the agenda filtered out exactly the members the class was opened for. The booking
// rule said yes and the screen never offered it — the drift the domain file warns about, in the one
// place I did not look.
//
// It is a function rather than three inline expressions because there were three copies here too,
// and three copies is how it happened in the first place.
const admitsOf = (s: ClassSession): readonly Category[] => s.admission?.categories ?? [s.category]

const isEligibleForServiceAt = (e: Entitlement, s: ClassSession, at: number) =>
  isEligibleForService(e, admitsOf(s), s.serviceId, instant(at), s.admission != null)

// The same walls minus the credit check: is this the KIND of class her package covers, even if
// she has nothing left to spend on it? That is what keeps a spent-out member's agenda visible.
const coversAt = (e: Entitlement, s: ClassSession): boolean =>
  e.status === 'active' &&
  s.startsAt <= e.validUntil &&
  admitsOf(s).includes(e.productSnapshot.category) &&
  // Same waiver as the booking rule: a declared admission covers the service too, or the agenda
  // would hide a class the domain would happily book.
  (s.admission != null ||
    e.productSnapshot.serviceIds === undefined ||
    e.productSnapshot.serviceIds.includes(s.serviceId))

// ── Profile (D9) ──────────────────────────────────────────────────────────────────────────
export interface PortalProfile {
  readonly fullName: string
  readonly phone: string
  readonly birthDate: string | null
  readonly email: string | null
  readonly emergencyName: string | null
  readonly emergencyPhone: string | null
}

export async function loadPortalProfile(
  ctx: TenantContext,
  memberId: MemberId,
): Promise<PortalProfile> {
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, memberId)
  if (!member) throw new Error('member not found')
  return {
    fullName: member.fullName,
    phone: member.phone,
    birthDate: member.birthDate,
    email: member.email,
    emergencyName: member.emergencyContact?.name ?? null,
    emergencyPhone: member.emergencyContact?.phone ?? null,
  }
}

// ── My reservations ───────────────────────────────────────────────────────────────────────
export async function loadPortalReservations(
  ctx: TenantContext,
  memberId: MemberId,
  nowMs: number,
): Promise<{ upcoming: readonly PortalReservation[]; past: readonly PortalReservation[] }> {
  const db = adminDb()
  const reservations = await new FirestoreReservationRepository(db).listByMember(ctx, memberId)
  const relevant = [...reservations].sort((a, b) => b.sessionStartsAt - a.sessionStartsAt)

  const upcomingRaw = relevant.filter((r) => r.status === 'booked' && r.sessionStartsAt > nowMs)
  const pastRaw = relevant
    .filter((r) => !(r.status === 'booked' && r.sessionStartsAt > nowMs))
    .slice(0, PORTAL_LIMITS.pastReservations)

  const sessions = await loadSessions(
    ctx,
    [...upcomingRaw, ...pastRaw].map((r) => r.classSessionId),
  )
  const map = (rs: typeof relevant) =>
    rs.flatMap((r) => {
      const s = sessions.get(r.classSessionId)
      return s ? [toPortalReservation(r.id, r.status, s)] : []
    })

  return {
    upcoming: map(upcomingRaw).sort((a, b) => a.startsAt - b.startsAt),
    past: map(pastRaw),
  }
}

async function loadSessions(
  ctx: TenantContext,
  ids: readonly string[],
): Promise<Map<string, ClassSession>> {
  const sched = new FirestoreSchedulingRepository(adminDb())
  const unique = [...new Set(ids)]
  const sessions = await Promise.all(unique.map((id) => sched.getSession(ctx, id as never)))
  const map = new Map<string, ClassSession>()
  for (const s of sessions) if (s) map.set(s.id, s)
  return map
}

function toPortalReservation(reservationId: string, status: string, s: ClassSession): PortalReservation {
  return {
    reservationId,
    sessionId: s.id,
    serviceName: displayName(s),
    trainerName: s.trainerName,
    roomName: s.roomName,
    category: s.category,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    status,
    // D14 — the window this session was STAMPED with. Never re-derived, never a hard-coded 6.
    cancellationWindowHours: s.policySnapshot.cancellationWindowHours,
    lateCancellationConsumesCredit: s.policySnapshot.lateCancellationConsumesCredit,
  }
}
