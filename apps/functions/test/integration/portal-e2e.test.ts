import { createHash, randomBytes } from 'node:crypto'

import {
  available,
  bookReservation,
  cancelReservation,
  completeActivation,
  createService,
  DEFAULT_STUDIO_CONFIG,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  instant,
  isEligibleForService,
  issueMemberInvite,
  money,
  purchaseEntitlement,
  registerMember,
  resolveInvite,
  scheduleSession,
  systemClock,
  toMemberSnapshot,
  type BranchId,
  type MemberId,
  type SchedulingPolicy,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// DEBT-014 — the member portal, driven end to end against the emulator.
//
// Every RULE the portal depends on has been unit-tested since v1.21 — eligibility, invite tokens,
// claims, visibility, the security rules. What was never tested is the WIRING: a missing `await`,
// a wrong id, a transaction that half-commits. `pnpm check` cannot see any of those.
//
// This drives the real use-cases against a real Firestore. It builds its OWN fixtures rather than
// leaning on the demo seed: a test that fails when someone edits the seed is a test nobody trusts.

const SID = 'std_portal_e2e' as StudioId
const BRANCH = 'brn_e2e' as BranchId

const POLICY: SchedulingPolicy = {
  maxDaysInAdvance: 30,
  cancellationWindowHours: 6,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: true,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 180,
  allowMemberSelfBooking: true, // D11 — self-booking is opt-in; it gives away scarce capacity
}

const OFFSET = DEFAULT_STUDIO_CONFIG.utcOffsetMinutes
const localDate = (ms: number) => new Date(ms + OFFSET * 60_000).toISOString().slice(0, 10)

let app: ReturnType<typeof initializeApp>
let db: Firestore

const staffCtx: TenantContext = {
  studioId: SID,
  branchIds: [BRANCH],
  role: 'receptionist',
  actor: { type: 'receptionist', id: 'usr_e2e' as never },
}
const memberCtx = (id: MemberId): TenantContext => ({
  studioId: SID,
  branchIds: [],
  role: 'member',
  actor: { type: 'member', id },
})

beforeAll(() => {
  app = initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-sos' }, 'portal-e2e')
  db = getFirestore(app)
})

afterAll(async () => {
  await deleteApp(app)
})

describe('the member portal, end to end', () => {
  it('invites, activates, books and cancels — and the credit comes back', async () => {
    const memberRepo = new FirestoreMemberRepository(db)
    const schedRepo = new FirestoreSchedulingRepository(db)
    const entRepo = new FirestoreEntitlementRepository(db)
    const resRepo = new FirestoreReservationRepository(db)
    const memberDeps = { repo: memberRepo, clock: systemClock }
    const schedDeps = {
      repo: schedRepo,
      clock: systemClock,
      studioConfig: DEFAULT_STUDIO_CONFIG,
    }
    const entDeps = { repo: entRepo, clock: systemClock }
    const resDeps = { repo: resRepo, entitlements: entRepo, clock: systemClock }

    // ── fixtures: a service, a member, a package she owns ────────────────────────────────
    const reformer = await createService(schedDeps, staffCtx, {
      name: 'Reformer',
      category: 'pilates_group',
      policy: POLICY,
    })
    if (!reformer.ok) throw new Error('createService failed')

    const mat = await createService(schedDeps, staffCtx, {
      name: 'Mat',
      category: 'pilates_group', // SAME category, different service — this is what D12 is for
      policy: POLICY,
    })
    if (!mat.ok) throw new Error('createService failed')

    const phone = `+9053${Math.floor(10_000_000 + Math.random() * 89_999_999)}`
    const reg = await registerMember(memberDeps, staffCtx, {
      fullName: 'E2E Üye',
      phone,
      homeBranchId: BRANCH,
      email: null,
      birthDate: null,
      notes: null,
      emergencyContact: null,
    })
    if (!reg.ok) throw new Error(`registerMember failed: ${JSON.stringify(reg.error)}`)
    const memberId = reg.value.memberId

    const purchase = await purchaseEntitlement(entDeps, staffCtx, {
      memberId,
      productId: 'prd_e2e' as never,
      productSnapshot: {
        productId: 'prd_e2e' as never,
        name: 'Reformer 10',
        category: 'pilates_group',
        grant: { kind: 'credits', credits: 10, validForDays: 90 },
        listPrice: money(500_000),
        serviceIds: [reformer.value.serviceId], // D12 — the right is to REFORMER, not to a category
      },
      policyRef: { policyId: 'prd_e2e', version: 1 },
      priceAgreed: money(500_000),
      validFrom: Date.now(),
      freezeDays: null,
    })
    if (!purchase.ok) throw new Error('purchaseEntitlement failed')
    const entitlementId = purchase.value.entitlementId

    // ── 1. invite → supersede → activate, once and only once ─────────────────────────────
    const hashOf = (t: string) => createHash('sha256').update(t).digest('hex')
    const firstToken = randomBytes(32).toString('base64url')
    const first = await issueMemberInvite(memberDeps, staffCtx, {
      memberId,
      tokenHash: hashOf(firstToken),
    })
    expect(first.ok).toBe(true)

    const secondToken = randomBytes(32).toString('base64url')
    await issueMemberInvite(memberDeps, staffCtx, { memberId, tokenHash: hashOf(secondToken) })

    // A new invite SUPERSEDES the old one. This is also the password-reset path: the link she was
    // sent last week must stop working the moment she asks for a new one.
    const stale = await resolveInvite(memberDeps, staffCtx, hashOf(firstToken))
    expect(stale.ok, 'a superseded invite still opened the door').toBe(false)

    const live = await resolveInvite(memberDeps, staffCtx, hashOf(secondToken))
    expect(live.ok).toBe(true)
    if (!live.ok) return

    const activated = await completeActivation(memberDeps, memberCtx(memberId), live.value)
    expect(activated.ok).toBe(true)

    // SINGLE-USE. An invite link is a bearer credential; a second activation from a forwarded
    // e-mail is exactly the attack it must not permit.
    const replay = await resolveInvite(memberDeps, staffCtx, hashOf(secondToken))
    expect(replay.ok, 'the invite was reusable — a forwarded link would activate her account').toBe(
      false,
    )

    // ── 2. the invite token NEVER enters the event log (#6) ──────────────────────────────
    const events = await db.collection('studios').doc(SID).collection('events').get()
    const types = events.docs.map((d) => d.data().type as string)
    expect(types).toContain('member.invited')
    expect(types).toContain('member.portal_activated')

    const activation = events.docs.find((d) => d.data().type === 'member.portal_activated')
    // The whole point of the actor taxonomy: SHE activated her account, not reception.
    expect((activation?.data().actor as { type: string })?.type).toBe('member')

    const payloads = JSON.stringify(events.docs.map((d) => d.data().payload ?? {}))
    expect(payloads.includes(secondToken), 'the invite token leaked into the event log').toBe(false)
    expect(payloads.includes(phone), 'her phone number leaked into the event log').toBe(false)

    // ── 3. eligibility — D12: her Reformer package does not open Mat ─────────────────────
    const entitlement = await entRepo.getEntitlement(staffCtx, entitlementId)
    if (!entitlement) throw new Error('entitlement vanished')
    const classTime = instant(Date.now() + 24 * 3600_000)
    expect(
      isEligibleForService(entitlement, 'pilates_group', reformer.value.serviceId, classTime),
    ).toBe(true)
    expect(
      isEligibleForService(entitlement, 'pilates_group', mat.value.serviceId, classTime),
      'a Reformer package opened a Mat class — the category wall alone is not eligibility',
    ).toBe(false)

    // ── 4. she books her own class, and the credit is HELD (not consumed) ────────────────
    const tomorrow = localDate(Date.now() + 24 * 3600_000)
    const session = await scheduleSession(schedDeps, staffCtx, {
      serviceId: reformer.value.serviceId,
      branchId: BRANCH,
      branchName: 'E2E',
      roomId: null,
      trainerId: null,
      trainerName: null,
      date: tomorrow,
      startTime: '10:00',
      durationMinutes: 50,
      capacity: 8,
    })
    if (!session.ok) throw new Error(`scheduleSession failed: ${JSON.stringify(session.error)}`)

    const member = await memberRepo.findById(staffCtx, memberId)
    if (!member) throw new Error('member vanished')

    const booked = await bookReservation(resDeps, memberCtx(memberId), {
      sessionId: session.value.sessionId,
      entitlementId,
      memberId,
      memberSnapshot: toMemberSnapshot(member),
    })
    expect(booked.ok, `booking refused: ${JSON.stringify(booked.ok ? '' : booked.error)}`).toBe(true)
    if (!booked.ok) return

    const afterBooking = await entRepo.getEntitlement(staffCtx, entitlementId)
    // A booking HOLDS a credit; it does not consume one. Otherwise a member with one credit books
    // five classes — and the hold is what makes it reversible.
    expect(available(afterBooking!.credits!)).toBe(9)
    expect(afterBooking!.credits!.held).toBe(1)
    expect(afterBooking!.credits!.consumed).toBe(0)

    // ── 5. she cancels INSIDE the window — the credit is released, no counter moves ──────
    const cancelled = await cancelReservation(resDeps, memberCtx(memberId), {
      reservationId: booked.value.reservationId,
    })
    expect(cancelled.ok).toBe(true)

    const afterCancel = await entRepo.getEntitlement(staffCtx, entitlementId)
    expect(available(afterCancel!.credits!)).toBe(10)
    expect(afterCancel!.credits!.held).toBe(0)
    // Released, NOT consumed. A cancellation inside the window must leave the ledger exactly as it
    // found it — if `consumed` moved here, the member paid for a class she cancelled in time.
    expect(afterCancel!.credits!.consumed).toBe(0)
  })
})
