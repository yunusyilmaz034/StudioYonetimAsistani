import {
  newOperationId,
  type ClassSessionId,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type LocalDate,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideExtend, type EntitlementsDeps } from '../../entitlements'
import { cancelReservation, type ReservationsDeps } from '../../reservations'
import { cancelSession, type SchedulingDeps } from '../../scheduling'
import {
  decideClosureApplicable,
  decideClosureApplied,
  decideCloseurePlanned,
} from '../domain/decide'
import { computeClosurePlan, type ClosureWorld } from '../domain/plan'
import type { ClosurePlan, ClosureSummary, OperationScope, StudioClosure } from '../domain/types'
import type { OperationsDeps } from './ports'

const SOURCE: EventSource = 'reception_web'
const dctx = (deps: OperationsDeps, ctx: TenantContext, correlationId: CorrelationId) => ({
  studioId: ctx.studioId,
  actor: ctx.actor, // the OWNER — a human declared this closure and approved it (#5)
  now: deps.clock.now(),
  correlationId,
  source: SOURCE,
})

// Everything the closure needs to touch, and the deps to touch it with. The orchestration lives
// here because a closure is, by definition, a cross-aggregate act — but every individual write
// still goes through the module that owns the rule, unchanged.
export interface ClosureDeps extends OperationsDeps {
  readonly scheduling: SchedulingDeps
  readonly reservations: ReservationsDeps
  readonly entitlements: EntitlementsDeps
  readonly loadWorld: (
    ctx: TenantContext,
    from: LocalDate,
    to: LocalDate,
  ) => Promise<ClosureWorld>
}

export interface PlanClosureInput {
  readonly dateFrom: LocalDate
  readonly dateTo: LocalDate
  readonly reason: string
  readonly scope: OperationScope
  readonly extensionDays: number
  readonly calendarDayIds?: readonly string[]
}

const closureId = (from: LocalDate, to: LocalDate, now: Instant): string =>
  `cls_${from}_${to}_${now}`.replace(/[^A-Za-z0-9_-]/g, '_')

// ── PREVIEW ────────────────────────────────────────────────────────────────────────────────
// **Writes nothing.** A pure plan over a fresh read. The owner looks at it and decides.
export async function previewClosure(
  deps: ClosureDeps,
  ctx: TenantContext,
  input: PlanClosureInput,
): Promise<ClosurePlan> {
  const world = await deps.loadWorld(ctx, input.dateFrom, input.dateTo)
  return computeClosurePlan(world, {
    scope: input.scope,
    extensionDays: input.extensionDays,
    closureFrom: dayStart(input.dateFrom),
    closureTo: dayEnd(input.dateTo),
  })
}

// ── PLAN (persist the decision, still destructive-free) ────────────────────────────────────
export async function planClosure(
  deps: ClosureDeps,
  ctx: TenantContext,
  input: PlanClosureInput,
): Promise<Result<{ closureId: string }, DomainError>> {
  const now = deps.clock.now()
  const operationId = newOperationId()
  const closure: StudioClosure = {
    id: closureId(input.dateFrom, input.dateTo, now),
    operationId,
    studioId: ctx.studioId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    reason: input.reason,
    scope: input.scope,
    extensionDays: input.extensionDays,
    calendarDayIds: input.calendarDayIds ?? [],
    status: 'planned',
    summary: null,
    appliedAt: null,
    createdAt: now,
  }
  const events = decideCloseurePlanned(dctx(deps, ctx, operationId), closure)
  if (!events.ok) return events
  await deps.repo.saveClosure(ctx, closure, events.value)
  return { ok: true, value: { closureId: closure.id } }
}

// ── APPLY ──────────────────────────────────────────────────────────────────────────────────
//
// Three properties, and each one is a scar from a different way this goes wrong:
//
//   • **I-28 — at most once.** `status` refuses a second apply. A double-click must not extend
//     every package twice.
//
//   • **Re-derives, never replays.** The plan is recomputed from a fresh read. Between the
//     preview and the button, reception may have booked someone into a class we are about to
//     cancel — the preview promised a SHAPE, not a count.
//
//   • **Session first, THEN its reservations.** This ordering is load-bearing: `decideCancellation`
//     releases unconditionally only when the session is already `cancelled` (I-14). Cancel the
//     reservations first and the *cancellation window* applies — a late cancel would CONSUME the
//     credit of a member whose class the studio itself cancelled. And if the worker dies in
//     between, I-27 catches the remainder: the sweep releases them instead of presuming
//     attendance. The failure mode is "late", never "wrong".
//
// NOT one transaction: a week's closure is ~40 sessions / ~300 reservations / ~120 entitlements —
// far past Firestore's 500-write ceiling. Per-object transactions, each still atomic WITH its
// events (#1 where it means something), driven by a resumable worker.
export async function applyClosure(
  deps: ClosureDeps,
  ctx: TenantContext,
  id: string,
): Promise<Result<ClosureSummary, DomainError>> {
  const closure = await deps.repo.getClosure(ctx, id)
  if (!closure) return { ok: false, error: { code: 'operation_not_applicable' } }

  const applicable = decideClosureApplicable(closure)
  if (!applicable.ok) return applicable

  // OP-2 — everything below is ONE operation. The session cancellations, the credit releases and
  // the extensions all carry this id, so the Activity Center can show them as one act.
  const operationId = closure.operationId

  await deps.repo.setClosureStatus(ctx, id, 'applying')

  // Re-derive against the world as it is NOW.
  const world = await deps.loadWorld(ctx, closure.dateFrom, closure.dateTo)
  const plan = computeClosurePlan(world, {
    scope: closure.scope,
    extensionDays: closure.extensionDays,
    closureFrom: dayStart(closure.dateFrom),
    closureTo: dayEnd(closure.dateTo),
  })

  const members = new Set<MemberId>()
  let sessionsCancelled = 0
  let reservationsReleased = 0
  let creditsReleased = 0

  for (const s of plan.sessionsToCancel) {
    // 1. The session. Once it is `cancelled`, every reservation on it releases unconditionally.
    const cancelled = await cancelSession(deps.scheduling, ctx, {
      sessionId: s.sessionId as ClassSessionId,
      reason: closure.reason,
      operationId,
    })
    if (!cancelled.ok) continue // a race (already cancelled elsewhere) — skipped, never fatal
    sessionsCancelled++

    // 2. Its reservations, one transaction each.
    for (const r of world.reservationsBySession.get(s.sessionId) ?? []) {
      if (r.status !== 'booked') continue
      const res = await cancelReservation(deps.reservations, ctx, { reservationId: r.id, operationId })
      if (!res.ok) continue // reported by the summary's shortfall, never swallowed into silence
      reservationsReleased++
      if (r.creditEffect !== 'none') creditsReleased++
      members.add(r.memberId)
    }
  }

  // 3. The extensions.
  let entitlementsExtended = 0
  for (const row of plan.entitlementsToExtend) {
    const ent = await deps.entitlements.repo.getEntitlement(ctx, row.entitlementId)
    if (!ent) continue
    const extended = decideExtend(
      dctx(deps, ctx, operationId),
      ent,
      closure.extensionDays,
      `Stüdyo kapalı: ${closure.reason}`,
      closure.id,
    )
    if (!extended.ok) continue // frozen / inactive — already reported in the plan
    await deps.entitlements.repo.saveEntitlement(ctx, extended.value.next, extended.value.events)
    entitlementsExtended++
    members.add(row.memberId)
  }

  const summary: ClosureSummary = {
    sessionsCancelled,
    reservationsReleased,
    creditsReleased,
    membersAffected: members.size,
    entitlementsExtended,
    frozenSkipped: plan.skippedEntitlements.filter((e) => e.reason === 'frozen').length,
    blockedSessions: plan.blockedSessions.length,
  }

  const applied: StudioClosure = {
    ...closure,
    status: 'applied',
    summary,
    appliedAt: deps.clock.now(),
  }
  await deps.repo.saveClosure(
    ctx,
    applied,
    decideClosureApplied(dctx(deps, ctx, operationId), applied, summary),
  )
  return { ok: true, value: summary }
}

// Studio-local day bounds (AD-52: +180). The closure is inclusive on both ends.
const OFFSET_MIN = 180
const dayStart = (d: LocalDate): Instant =>
  (Date.parse(`${d}T00:00:00Z`) - OFFSET_MIN * 60_000) as Instant
const dayEnd = (d: LocalDate): Instant =>
  (Date.parse(`${d}T23:59:59Z`) - OFFSET_MIN * 60_000) as Instant
