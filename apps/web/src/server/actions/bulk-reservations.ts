'use server'

import {
  applyBulkCancel,
  DEFAULT_STUDIO_CONFIG,
  applyBulkMove,
  changeTrainer,
  FirestoreEntitlementRepository,
  FirestoreIdentityRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  instant,
  previewBulkCancel,
  previewBulkMove,
  systemClock,
  type BulkCancelRow,
  type BulkMoveRow,
  type BulkOutcome,
  type BulkReservationsDeps,
  type BulkWorld,
  type ClassSessionId,
  type Entitlement,
  type SchedulingDeps,
  type StaffUserId,
  type TenantContext,
} from '@studio/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { observed } from '../log'

// TOPLU REZERVASYON İŞLEMLERİ (v1.27 S7).
//
// Reception's real morning: *"Salı 19:00 iptal — herkesi Çarşamba 19:00'a alalım"*, and *"Ayşe hasta,
// bu haftaki derslerini Zeynep alacak"*. Today each of those is eight clicks per member, and the
// eighth is the one she forgets.
//
// ── They are Server Actions, and they can never be commands ─────────────────────────────────
// Every one of these moves a credit or allocates a seat. The `/commands` whitelist is exactly
// `checkIn.record` and `attendance.mark` and it stays that way (AD-35).
//
// ── Preview, then apply. Always. ────────────────────────────────────────────────────────────
// The preview runs the SAME deciders the apply runs — it is not a second opinion, it is the same
// opinion, shown first. And the apply re-decides inside each transaction, so a plan drawn a minute
// ago can never oversell a room.

const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const nonEmpty = z.string().min(1)

/**
 * The world a bulk act reasons about: the source class, its live roster, the target class, and the
 * ledger row behind each reservation.
 *
 * Loaded ONCE, up front. The alternative — a query per member inside the loop — is how a bulk
 * operation over a full roster becomes forty round trips.
 */
function bulkDeps(): BulkReservationsDeps {
  const db = adminDb()
  const reservations = new FirestoreReservationRepository(db)
  const scheduling = new FirestoreSchedulingRepository(db)
  const entitlements = new FirestoreEntitlementRepository(db)

  return {
    repo: reservations,
    clock: systemClock,
    // AG-1 — the same hours the single-reservation path obeys. The plan refuses a target outside them
    // BEFORE the apply does, so reception never promises a class the engine will not allow.
    hours: new FirestoreStudioHours(db),
    async loadWorld(ctx: TenantContext, input): Promise<BulkWorld> {
      const [session, roster, target] = await Promise.all([
        scheduling.getSession(ctx, input.sessionId),
        reservations.listBySession(ctx, input.sessionId),
        input.targetSessionId
          ? scheduling.getSession(ctx, input.targetSessionId)
          : Promise.resolve(null),
      ])
      if (!session) throw new Error(`Session not found: ${input.sessionId}`)

      // Only the still-open ones. A cancelled or attended reservation is not a thing to cancel or
      // move, and offering it on the screen would be offering an act the domain will refuse.
      const booked = roster.filter((r) => r.status === 'booked')

      const targetRoster = input.targetSessionId
        ? await reservations.listBySession(ctx, input.targetSessionId)
        : []

      const ledger = new Map<string, Entitlement>()
      await Promise.all(
        [...new Set(booked.map((r) => r.entitlementId as string))].map(async (id) => {
          const e = await entitlements.getEntitlement(ctx, id as Entitlement['id'])
          if (e) ledger.set(id, e)
        }),
      )

      return {
        session,
        reservations: booked,
        target: target ?? null,
        targetMemberIds: new Set(
          targetRoster.filter((r) => r.status === 'booked').map((r) => r.memberId as string),
        ),
        entitlements: ledger,
      }
    },
  }
}

const cancelInput = z.object({
  sessionId: nonEmpty,
  // Empty ⇒ the whole roster. The screen always sends the explicit list; this is the honest default
  // for a caller that means "all of them".
  reservationIds: z.array(z.string()).default([]),
})

const moveInput = cancelInput.extend({
  targetSessionId: nonEmpty,
  overrideReason: z.string().nullable().default(null),
})

/** What each cancellation would cost the member. **Writes nothing.** */
export async function previewBulkCancelAction(input: unknown): Promise<readonly BulkCancelRow[]> {
  const p = cancelInput.parse(input)
  const ctx = await requireTenantContext(OPS)
  return previewBulkCancel(bulkDeps(), ctx, {
    sessionId: p.sessionId as ClassSessionId,
    reservationIds: p.reservationIds,
  })
}

export async function applyBulkCancelAction(input: unknown): Promise<BulkOutcome> {
  const p = cancelInput.parse(input)
  const ctx = await requireTenantContext(OPS)

  const outcome = await observed(
    'reservation.bulk_cancel',
    ctx,
    undefined,
    { sessionId: p.sessionId, count: p.reservationIds.length },
    async () => ({ ok: true as const, value: await applyBulkCancel(bulkDeps(), ctx, {
      sessionId: p.sessionId as ClassSessionId,
      reservationIds: p.reservationIds,
    }) }),
  )
  revalidatePath('/reservations')
  revalidatePath('/schedule')
  if (!outcome.ok) throw new Error(outcome.error.code)
  return outcome.value
}

export async function previewBulkMoveAction(input: unknown): Promise<readonly BulkMoveRow[]> {
  const p = moveInput.parse(input)
  const ctx = await requireTenantContext(OPS)
  return previewBulkMove(bulkDeps(), ctx, {
    sessionId: p.sessionId as ClassSessionId,
    targetSessionId: p.targetSessionId as ClassSessionId,
    reservationIds: p.reservationIds,
    overrideReason: p.overrideReason,
  })
}

export async function applyBulkMoveAction(input: unknown): Promise<BulkOutcome> {
  const p = moveInput.parse(input)
  const ctx = await requireTenantContext(OPS)

  const outcome = await observed(
    'reservation.bulk_move',
    ctx,
    undefined,
    { sessionId: p.sessionId, targetSessionId: p.targetSessionId, count: p.reservationIds.length },
    async () => ({ ok: true as const, value: await applyBulkMove(bulkDeps(), ctx, {
      sessionId: p.sessionId as ClassSessionId,
      targetSessionId: p.targetSessionId as ClassSessionId,
      reservationIds: p.reservationIds,
      overrideReason: p.overrideReason,
    }) }),
  )
  revalidatePath('/reservations')
  revalidatePath('/schedule')
  if (!outcome.ok) throw new Error(outcome.error.code)
  return outcome.value
}

// ── Toplu eğitmen değişikliği ───────────────────────────────────────────────────────────────
//
// "Ayşe hasta." It is one sentence and it touches every class she teaches this week. The reason is
// MANDATORY and it is stamped into every `session.trainer_changed` event — because in three weeks
// somebody will ask why Zeynep taught Tuesday, and the answer must be in the log rather than in
// somebody's memory.

const schedulingDeps = (): SchedulingDeps => ({
  repo: new FirestoreSchedulingRepository(adminDb()),
  clock: systemClock,
  studioConfig: DEFAULT_STUDIO_CONFIG,
  hours: new FirestoreStudioHours(adminDb()),
})

/**
 * The trainers, for the picker. Reception may read this — she already sees every trainer's name on
 * the schedule — but it is deliberately NOT `listStaffAction`, which is owner-only and carries roles
 * and account state she has no business holding.
 */
export async function listTrainersAction(): Promise<readonly { id: string; name: string }[]> {
  const ctx = await requireTenantContext(OPS)
  const staff = await new FirestoreIdentityRepository(adminDb()).listStaff(ctx)
  return staff
    .filter((s) => s.active && s.role === 'trainer')
    .map((s) => ({ id: s.id as string, name: s.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
}

export interface TrainerSessionRow {
  readonly sessionId: string
  readonly startsAt: number
  readonly serviceName: string
  readonly bookedCount: number
}

/** Which classes would change hands. **Writes nothing.** */
export async function listTrainerSessionsAction(input: unknown): Promise<readonly TrainerSessionRow[]> {
  const p = z
    .object({ trainerId: nonEmpty, fromMs: z.number(), toMs: z.number() })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  const sessions = await new FirestoreSchedulingRepository(adminDb()).listSessionsForDay(
    ctx,
    instant(p.fromMs),
    instant(p.toMs),
  )
  return sessions
    .filter((s) => (s.trainerId as string | null) === p.trainerId && s.status !== 'cancelled')
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((s) => ({
      sessionId: s.id as string,
      startsAt: s.startsAt,
      serviceName: s.serviceName,
      bookedCount: s.bookedCount,
    }))
}

export async function applyBulkTrainerChangeAction(input: unknown): Promise<BulkOutcome> {
  const p = z
    .object({
      sessionIds: z.array(z.string()).min(1),
      trainerId: nonEmpty.nullable(),
      reason: nonEmpty, // never optional: a class that changed hands for no recorded reason is a mystery
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  const staff = await new FirestoreIdentityRepository(adminDb()).listStaff(ctx)
  const trainerName = p.trainerId
    ? (staff.find((s) => (s.id as string) === p.trainerId)?.displayName ?? null)
    : null
  if (p.trainerId && trainerName === null) throw new Error('Eğitmen bulunamadı.')

  const deps = schedulingDeps()
  const failed: { reservationId: string; memberName: string; code: string }[] = []
  let applied = 0

  for (const sessionId of p.sessionIds) {
    const res = await changeTrainer(deps, ctx, {
      sessionId: sessionId as ClassSessionId,
      trainerId: (p.trainerId ?? null) as StaffUserId | null,
      trainerName,
      reason: p.reason,
    })
    if (res.ok) applied++
    else failed.push({ reservationId: sessionId, memberName: sessionId, code: res.error.code })
  }

  revalidatePath('/schedule')
  revalidatePath('/my-classes')
  return { operationId: '' as BulkOutcome['operationId'], applied, failed }
}
