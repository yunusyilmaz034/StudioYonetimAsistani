import { describe, expect, it } from 'vitest'

import {
  fixedClock,
  instant,
  money,
  type CommandId,
  type DomainError,
  type EntitlementId,
  type Instant,
  type MemberId,
  type NewEvent,
  type ProductId,
  type ReservationId,
  type Result,
  type StaffUserId,
  type StudioId,
  type TenantContext,
} from '../../../shared'
import type { Entitlement } from '../../entitlements'
import type { ClassSession, SchedulingPolicy } from '../../scheduling'
import type { MemberSnapshot } from '../../members'
import { correctReservation } from './correct'
import { markAttendance } from './mark-attendance'
import { sweepAutoResolve } from './auto-resolve'
import type { ReservationRepository, ResolveTxInput } from './ports'
import type { Reservation } from '../domain/types'

const NOW = instant(1_000_000_000_000)
const H = 3_600_000

const ctx: TenantContext = {
  studioId: 'std_1' as StudioId,
  branchIds: [],
  role: 'receptionist',
  actor: { type: 'receptionist', id: 'usr_1' as StaffUserId },
}

const pol = (p: Partial<SchedulingPolicy> = {}): SchedulingPolicy => ({
  maxDaysInAdvance: 14,
  cancellationWindowHours: 6,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: false,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 15,
  ...p,
})

const session = (over: Partial<ClassSession> = {}, p: SchedulingPolicy = pol()): ClassSession => ({
  id: 'cls_1' as unknown as ClassSession['id'],
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as unknown as ClassSession['branchId'],
  serviceId: 'svc_1' as unknown as ClassSession['serviceId'],
  roomId: null,
  trainerId: null,
  templateId: null,
  category: 'pilates_group',
  startsAt: instant(NOW - 2 * H),
  endsAt: instant(NOW - H),
  capacity: 8,
  status: 'scheduled',
  cancellation: null,
  policyRef: { serviceId: 'svc_1' as unknown as ClassSession['serviceId'], version: 2 },
  policySnapshot: p,
  bookedCount: 1,
  attendedCount: 0,
  serviceName: 'Reformer',
  roomName: null,
  trainerName: null,
  branchName: 'Merkez',
  ...over,
})

const creditEnt = (over: Partial<Entitlement> = {}): Entitlement => ({
  id: 'ent_1' as EntitlementId,
  studioId: 'std_1' as StudioId,
  memberId: 'mem_1' as MemberId,
  productId: 'prd_1' as ProductId,
  productSnapshot: {
    productId: 'prd_1' as ProductId,
    name: 'Pilates 8',
    category: 'pilates_group',
    grant: { kind: 'credits', credits: 8, validForDays: 30 },
    listPrice: money(420_000),
  },
  policyRef: { policyId: 'pol_1', version: 3 },
  status: 'active',
  validFrom: instant(NOW - 30 * H),
  validUntil: instant(NOW + 30 * 24 * H),
  credits: { granted: 8, held: 1, consumed: 0, restored: 0, revoked: 0, expired: 0 },
  freeze: null,
  priceAgreed: money(294_000),
  paidTotal: money(0),
  manualPayment: null,
  purchasedAt: instant(NOW - 30 * H),
  ...over,
})

const SNAP: MemberSnapshot = {
  memberId: 'mem_1' as MemberId,
  displayName: 'Ayşe Y.',
  phoneLast4: '4567',
  membershipStatus: 'active',
}

const reservation = (over: Partial<Reservation> = {}): Reservation => ({
  id: 'res_1' as ReservationId,
  studioId: 'std_1' as StudioId,
  branchId: 'brn_1' as unknown as Reservation['branchId'],
  classSessionId: 'cls_1' as unknown as Reservation['classSessionId'],
  memberId: 'mem_1' as MemberId,
  entitlementId: 'ent_1' as EntitlementId,
  status: 'booked',
  creditEffect: 'held',
  sessionStartsAt: instant(NOW - 2 * H),
  sessionEndsAt: instant(NOW - H),
  sessionCategory: 'pilates_group',
  memberSnapshot: SNAP,
  bookedAt: instant(NOW - 3 * H),
  bookedBy: ctx.actor,
  resolvedAt: null,
  resolvedBy: null,
  attendanceSource: null,
  policyRef: { policyId: 'svc_1', version: 2 },
  ...over,
})

// A fake repository that runs the pure `decide` callback against in-memory state and
// applies its result — the same contract the Firestore transaction implements.
class FakeRepo implements ReservationRepository {
  readonly events: NewEvent[] = []
  constructor(
    readonly reservations: Map<string, Reservation>,
    readonly sessions: Map<string, ClassSession>,
    readonly entitlements: Map<string, Entitlement>,
  ) {}

  async getReservation(_c: TenantContext, id: ReservationId): Promise<Reservation | null> {
    return this.reservations.get(id) ?? null
  }
  async book(): Promise<Result<{ reservationId: ReservationId }, DomainError>> {
    throw new Error('not used')
  }
  async cancel(): Promise<Result<void, DomainError>> {
    throw new Error('not used')
  }
  async resolve(_c: TenantContext, input: ResolveTxInput): Promise<Result<void, DomainError>> {
    const r = this.reservations.get(input.reservationId)
    if (!r) throw new Error('reservation missing')
    const s = this.sessions.get(r.classSessionId)!
    const e = this.entitlements.get(r.entitlementId)!
    const decided = input.decide(r, s, e)
    if (!decided.ok) return decided
    this.reservations.set(r.id, decided.value.reservation)
    if (decided.value.nextEntitlement) this.entitlements.set(e.id, decided.value.nextEntitlement)
    this.events.push(...decided.value.events)
    return { ok: true, value: undefined }
  }
  async listResolvableBooked(_c: TenantContext, before: Instant): Promise<readonly Reservation[]> {
    return [...this.reservations.values()].filter((r) => r.status === 'booked' && r.sessionEndsAt <= before)
  }
  async listBySessionStartRange(
    _c: TenantContext,
    from: Instant,
    to: Instant,
  ): Promise<readonly Reservation[]> {
    return [...this.reservations.values()].filter((r) => r.sessionStartsAt >= from && r.sessionStartsAt < to)
  }
  async listBySession(_c: TenantContext, id: string): Promise<readonly Reservation[]> {
    return [...this.reservations.values()].filter((r) => r.classSessionId === id)
  }
  async listByMember(_c: TenantContext, memberId: string): Promise<readonly Reservation[]> {
    return [...this.reservations.values()]
      .filter((r) => r.memberId === memberId)
      .sort((a, b) => b.sessionStartsAt - a.sessionStartsAt)
  }
}

const single = (r: Reservation, s: ClassSession, e: Entitlement) =>
  new FakeRepo(new Map([[r.id, r]]), new Map([[s.id, s]]), new Map([[e.id, e]]))

const deps = (repo: FakeRepo) => ({ repo, clock: fixedClock(NOW) })

describe('markAttendance (offline command → resolve transaction)', () => {
  it('attended consumes the held credit and stamps the commandId', async () => {
    const r = reservation()
    const e = creditEnt()
    const repo = single(r, session(), e)
    const res = await markAttendance(deps(repo), ctx, {
      reservationId: r.id,
      outcome: 'attended',
      occurredAt: instant(NOW - 30 * 60_000),
      commandId: 'cmd_1' as CommandId,
    })
    expect(res.ok).toBe(true)
    expect(repo.reservations.get(r.id)?.status).toBe('attended')
    const led = repo.entitlements.get(e.id)?.credits
    expect(led).toMatchObject({ held: 0, consumed: 1 })
    // reservation.attended + entitlement.credit_consumed, both under one command.
    expect(repo.events).toHaveLength(2)
    expect(repo.events.every((ev) => ev.commandId === 'cmd_1')).toBe(true)
  })

  it('clamps a future occurredAt to now (never ahead of recordedAt)', async () => {
    const r = reservation()
    const repo = single(r, session(), creditEnt())
    await markAttendance(deps(repo), ctx, {
      reservationId: r.id,
      outcome: 'attended',
      occurredAt: instant(NOW + 10 * H), // a fast client clock
      commandId: 'cmd_1' as CommandId,
    })
    expect(repo.events[0]?.occurredAt).toBe(NOW)
  })

  it('no_show without a burn policy releases the hold', async () => {
    const r = reservation()
    const e = creditEnt()
    const repo = single(r, session(), e)
    await markAttendance(deps(repo), ctx, {
      reservationId: r.id,
      outcome: 'no_show',
      occurredAt: NOW,
      commandId: 'cmd_1' as CommandId,
    })
    expect(repo.reservations.get(r.id)?.status).toBe('no_show')
    expect(repo.entitlements.get(e.id)?.credits).toMatchObject({ held: 0, consumed: 0 })
  })
})

describe('sweepAutoResolve (nightly, system)', () => {
  it('resolves an ended reservation and skips one still inside its grace window', async () => {
    const ended = reservation({ id: 'res_ended' as ReservationId })
    const justEnded = reservation({
      id: 'res_fresh' as ReservationId,
      classSessionId: 'cls_fresh' as unknown as Reservation['classSessionId'],
      sessionEndsAt: instant(NOW - 60_000), // ended 1m ago; grace 15m ⇒ too early
    })
    const repo = new FakeRepo(
      new Map([
        [ended.id, ended],
        [justEnded.id, justEnded],
      ]),
      new Map([
        [session().id, session()],
        ['cls_fresh', session({ id: 'cls_fresh' as unknown as ClassSession['id'], endsAt: instant(NOW - 60_000) })],
      ]),
      new Map([[creditEnt().id, creditEnt()]]),
    )
    const summary = await sweepAutoResolve(deps(repo), ctx)
    expect(summary).toEqual({ resolved: 1, skipped: 1, failed: 0 })
    expect(repo.reservations.get('res_ended')?.status).toBe('attended')
    expect(repo.reservations.get('res_ended')?.attendanceSource).toBe('system_default')
    expect(repo.reservations.get('res_fresh')?.status).toBe('booked')
  })
})

describe('correctReservation (compensating, credit comes back)', () => {
  it('attended → no_show restores the consumed credit', async () => {
    const resolved = reservation({ status: 'attended', creditEffect: 'consumed' })
    const e = creditEnt({ credits: { granted: 8, held: 0, consumed: 1, restored: 0, revoked: 0, expired: 0 } })
    const repo = single(resolved, session(), e)
    const res = await correctReservation(deps(repo), ctx, {
      reservationId: resolved.id,
      toOutcome: 'no_show',
      reason: 'Üye gelmedi',
    })
    expect(res.ok).toBe(true)
    expect(repo.reservations.get(resolved.id)?.status).toBe('no_show')
    expect(repo.entitlements.get(e.id)?.credits).toMatchObject({ consumed: 1, restored: 1 })
  })

  it('refuses the reverse (a released credit cannot be re-consumed) — DEBT-010', async () => {
    const resolved = reservation({ status: 'no_show', creditEffect: 'released' })
    const e = creditEnt({ credits: { granted: 8, held: 0, consumed: 0, restored: 0, revoked: 0, expired: 0 } })
    const repo = single(resolved, session(), e)
    const res = await correctReservation(deps(repo), ctx, {
      reservationId: resolved.id,
      toOutcome: 'attended',
      reason: 'Aslında geldi',
    })
    expect(res).toEqual({ ok: false, error: { code: 'correction_credit_unsupported' } })
    // nothing written — the reservation stays as it was.
    expect(repo.reservations.get(resolved.id)?.status).toBe('no_show')
  })
})
