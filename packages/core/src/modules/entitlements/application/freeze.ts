import {
  addLocalDays,
  localDateAt,
  type DomainError,
  type EntitlementId,
  type Instant,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideFreeze, decideUnfreeze, freezeDaysRemaining } from '../domain/decide'
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
  },
): Promise<Result<void, DomainError>> {
  const ent = await loadEntitlement(deps, ctx, input.entitlementId)
  const outcome = decideFreeze(
    decideContext(deps, ctx),
    ent,
    input.from,
    input.hasUpcomingReservation,
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
): Promise<{ readonly unfrozen: number }> {
  const today = localDateAt(now, utcOffsetMinutes) as string
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
  return { unfrozen }
}

/** The LocalDate her budget runs out on, or null if she is not frozen. */
function budgetEndsOn(ent: Entitlement): string | null {
  const f = ent.freeze
  if (!f?.activeFrom) return null
  return addLocalDays(f.activeFrom, freezeDaysRemaining(f))
}
