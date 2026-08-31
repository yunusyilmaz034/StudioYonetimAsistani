import {
  addLocalDays,
  localDateAt,
  type DomainError,
  type EntitlementId,
  type Instant,
  type Result,
  type TenantContext,
} from '../../../shared'
import {
  decideCancelFreezeSchedule,
  decideFreeze,
  decideScheduleFreeze,
  decideStartScheduledFreeze,
  decideUnfreeze,
  freezeDaysRemaining,
  type FreezePlan,
  type FreezeSchedule,
} from '../domain/decide'
import type { Entitlement } from '../domain/types'
import { decideContext, loadEntitlement } from './context'
import type { EntitlementsDeps } from './ports'

// FREEZE (v1.27 S3 · owner, 2026-07-13 · closes DEBT-009).
//
// The domain decides; this loads, transacts, and — for the sweep — finds the rows whose budget has
// run out. It knows no numbers: the budget is `product.freezeAllowanceDays`, copied onto the
// entitlement at purchase, and the studio's terms are the catalogue's, as they always were.

export async function freezeEntitlement(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  input: {
    readonly entitlementId: EntitlementId
    /** Today, in the studio's timezone — resolved by the caller, never by the domain. */
    readonly from: string
    /**
     * Does she have a class booked that has not happened yet?
     *
     * The caller answers this because the reservations live in another aggregate — and the answer
     * is a REFUSAL, never a fix: cancelling her class for her would move a credit she never asked us
     * to move, and she would learn about it from a ledger rather than from us.
     */
    readonly hasUpcomingReservation: boolean
    /** How long, why, and (optionally) in whose words. Required since 2026-07-28 — a freeze whose
     *  end nobody can state is a freeze nobody can plan around. */
    readonly plan: FreezePlan
  },
): Promise<Result<void, DomainError>> {
  const ent = await loadEntitlement(deps, ctx, input.entitlementId)
  const outcome = decideFreeze(
    decideContext(deps, ctx),
    ent,
    input.from,
    input.hasUpcomingReservation,
    input.plan,
  )
  if (!outcome.ok) return outcome

  await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
  return { ok: true, value: undefined }
}

export async function unfreezeEntitlement(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  input: { readonly entitlementId: EntitlementId; readonly to: string; readonly auto?: boolean },
): Promise<Result<void, DomainError>> {
  const ent = await loadEntitlement(deps, ctx, input.entitlementId)
  const outcome = decideUnfreeze(decideContext(deps, ctx), ent, input.to, input.auto ?? false)
  if (!outcome.ok) return outcome

  await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
  return { ok: true, value: undefined }
}


/**
 * Book a freeze for LATER (owner, 2026-08-31).
 *
 * Nothing stops today: she stays active until the window begins, and the nightly sweep starts it.
 * The caller answers `hasReservationInWindow` because the reservations live in another aggregate —
 * and note that the question is about the WINDOW, not about "any upcoming class". Under the old
 * immediate-only freeze the two were the same thing; they are not any more, and asking the broad
 * question would refuse a member in September because she has a class booked in December.
 */
export async function scheduleFreeze(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  input: {
    readonly entitlementId: EntitlementId
    /** Today, in the studio's timezone — resolved by the caller, never by the domain. */
    readonly today: string
    readonly hasReservationInWindow: boolean
    readonly plan: FreezeSchedule
  },
): Promise<Result<void, DomainError>> {
  const ent = await loadEntitlement(deps, ctx, input.entitlementId)
  const outcome = decideScheduleFreeze(
    decideContext(deps, ctx),
    ent,
    input.today,
    input.hasReservationInWindow,
    input.plan,
  )
  if (!outcome.ok) return outcome
  await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
  return { ok: true, value: undefined }
}

/** She changed her plans. Nothing was frozen, so no day is paid back and no date moves. */
export async function cancelFreezeSchedule(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  input: { readonly entitlementId: EntitlementId; readonly reason: string },
): Promise<Result<void, DomainError>> {
  const ent = await loadEntitlement(deps, ctx, input.entitlementId)
  const outcome = decideCancelFreezeSchedule(decideContext(deps, ctx), ent, input.reason)
  if (!outcome.ok) return outcome
  await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
  return { ok: true, value: undefined }
}

/**
 * THE SWEEP — nightly, `actor: system`.
 *
 * **An unlimited freeze is an unlimited membership, sold at the price of a three-month one.** A
 * member who never asks to be unfrozen is unfrozen on the day her budget runs out, and her
 * membership is extended by exactly the days she paid for.
 *
 * It ends the freeze on the day the budget is exhausted — `activeFrom + remaining` — and NOT on the
 * day the sweep happens to run. A sweep that failed on Tuesday must not cost the member Wednesday:
 * the date is derived from her freeze, not from the clock that noticed it.
 */
export async function runFreezeBudgetSweep(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  now: Instant,
  utcOffsetMinutes: number,
): Promise<{ readonly unfrozen: number; readonly started: number }> {
  const today = localDateAt(now, utcOffsetMinutes) as string

  // ── First, START the windows that have come due (owner, 2026-08-31) ────────────────────────
  //
  // Before unfreezing, because the two are the same job seen from both ends and doing them in this
  // order lets a one-day freeze booked for today begin and end on the same night rather than
  // waiting an extra day for a second sweep.
  //
  // `listActive` rather than a dedicated query: a scheduled freeze leaves the row ACTIVE (that is
  // the point), and a studio has hundreds of active entitlements, not millions. A new index for a
  // nightly loop over a small collection would be a cost with no reader — and index mistakes are a
  // production-only trap here (OR-14).
  let started = 0
  for (const ent of await deps.repo.listActive(ctx)) {
    const from = ent.freeze?.scheduledFrom
    if (!from || from > today) continue
    const res = await startScheduledFreeze(deps, ctx, ent.id, today)
    if (res.ok) started++
  }

  const frozen = await deps.repo.listFrozen(ctx)

  let unfrozen = 0
  for (const ent of frozen) {
    const due = budgetEndsOn(ent)
    if (!due || due > today) continue // still inside her budget — nothing to do

    const res = await unfreezeEntitlement(deps, ctx, {
      entitlementId: ent.id,
      to: due, // the day it ran out, not the day we noticed
      auto: true,
    })
    if (res.ok) unfrozen++
  }
  return { unfrozen, started }
}

/** The sweep turning one booked window into a running freeze. */
async function startScheduledFreeze(
  deps: EntitlementsDeps,
  ctx: TenantContext,
  entitlementId: EntitlementId,
  today: string,
): Promise<Result<void, DomainError>> {
  const ent = await loadEntitlement(deps, ctx, entitlementId)
  const outcome = decideStartScheduledFreeze(decideContext(deps, ctx), ent, today)
  if (!outcome.ok) return outcome
  await deps.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
  return { ok: true, value: undefined }
}

/**
 * The LocalDate this freeze ends on, or null if she is not frozen.
 *
 * TWO limits now, and the EARLIER one wins (owner, 2026-07-28):
 *   · the plan she agreed to — "beş gün donduralım"
 *   · what was APPROVED for this freeze, which cannot be exceeded whatever anyone planned
 *
 * The approval is her budget in every ordinary case, and more than her budget when the desk used
 * its initiative (2026-07-31). Reading the budget here instead would have the sweep resume her on
 * day seven of a fortnight everybody agreed to — the one place an override could be silently undone.
 *
 * A freeze started before plans existed has no `plannedUntil`, and falls back to the budget exactly
 * as it always did. Absent means "nobody recorded a plan", not "planned for zero days".
 */
function budgetEndsOn(ent: Entitlement): string | null {
  const f = ent.freeze
  if (!f?.activeFrom) return null
  const budgetEnd = addLocalDays(f.activeFrom, f.grantedDays ?? freezeDaysRemaining(f))
  const planned = f.plannedUntil ?? null
  return planned && planned < budgetEnd ? planned : budgetEnd
}
