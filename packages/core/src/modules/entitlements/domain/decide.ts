import {
  daysBetween,
  err,
  instant,
  ok,
  subtractMoney,
  zeroMoney,
  type ActorRef,
  type AggregateKind,
  type CommandId,
  type CorrelationId,
  type DomainError,
  type EventRelated,
  type EventSource,
  type Instant,
  type Money,
  type NewEvent,
  type PaymentId,
  type PolicyId,
  type PolicyRef,
  type ReservationId,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  ENTITLEMENT_ADJUSTED,
  ENTITLEMENT_AMENDED,
  ENTITLEMENT_CANCELLATION_CHARGED,
  ENTITLEMENT_CANCELLATION_REFUNDED,
  ENTITLEMENT_CANCELLED,
  ENTITLEMENT_CREDIT_CONSUMED,
  ENTITLEMENT_CREDIT_HELD,
  ENTITLEMENT_CREDIT_RELEASED,
  ENTITLEMENT_CREDIT_RESTORED,
  ENTITLEMENT_EXTENDED,
  ENTITLEMENT_EXHAUSTED,
  ENTITLEMENT_EXPIRED,
  ENTITLEMENT_FROZEN,
  ENTITLEMENT_UNFROZEN,
  ENTITLEMENT_PAYMENT_RECORDED,
  ENTITLEMENT_PURCHASED,
  ENTITLEMENT_REACTIVATED,
} from '../events'
import {
  available,
  cancellationsUsed,
  type AdjustmentReason,
  type CancellationLedger,
  type CreditLedger,
  type Entitlement,
  type FreezeState,
  type ManualPayment,
  type PaymentMethod,
} from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
  // The command that caused this event, when one did (a credit consumed by an
  // offline attendance mark). null for synchronous writes.
  readonly commandId?: CommandId | null
}

export type LedgerOutcome = { readonly next: Entitlement; readonly events: readonly NewEvent[] }

function policyRefOf(ent: Entitlement): PolicyRef {
  return { policyId: ent.policyRef.policyId as PolicyId, version: ent.policyRef.version }
}

function base(ctx: DecideContext, ent: Entitlement, related: EventRelated) {
  return {
    studioId: ctx.studioId,
    branchId: null,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind: 'entitlement' as AggregateKind, id: ent.id },
    related,
    policyRef: policyRefOf(ent),
    commandId: ctx.commandId ?? null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

const relOf = (ent: Entitlement, reservationId?: ReservationId): EventRelated =>
  reservationId
    ? { memberId: ent.memberId, entitlementId: ent.id, reservationId }
    : { memberId: ent.memberId, entitlementId: ent.id }

const withCredits = (ent: Entitlement, credits: CreditLedger): Entitlement => ({ ...ent, credits })
const withCancellation = (ent: Entitlement, cancellationLedger: CancellationLedger): Entitlement => ({
  ...ent,
  cancellationLedger,
})

// ── Cancellation allowance (Plus Phase 3). Pure ledger moves; NO refusal here — the caller
//    (reservations' decideCancellation) knows the effective allowance and refuses at zero. These only
//    record that the meter moved. `charge` on an in-window cancel that spends the right; `refund` when
//    a compensating undo/correction gives it back. ──
export function decideChargeCancellation(
  ctx: DecideContext,
  ent: Entitlement,
  reservationId: ReservationId,
): LedgerOutcome {
  const ledger: CancellationLedger = { ...ent.cancellationLedger, used: ent.cancellationLedger.used + 1 }
  const next = withCancellation(ent, ledger)
  return {
    next,
    events: [
      {
        ...base(ctx, next, relOf(next, reservationId)),
        type: ENTITLEMENT_CANCELLATION_CHARGED,
        payload: { reservationId, cancellationsUsedAfter: cancellationsUsed(ledger) },
      },
    ],
  }
}

export function decideRefundCancellation(
  ctx: DecideContext,
  ent: Entitlement,
  reservationId: ReservationId,
  reason: string,
): LedgerOutcome {
  const ledger: CancellationLedger = { ...ent.cancellationLedger, refunded: ent.cancellationLedger.refunded + 1 }
  const next = withCancellation(ent, ledger)
  return {
    next,
    events: [
      {
        ...base(ctx, next, relOf(next, reservationId)),
        type: ENTITLEMENT_CANCELLATION_REFUNDED,
        payload: { reservationId, reason, cancellationsUsedAfter: cancellationsUsed(ledger) },
      },
    ],
  }
}

// ── Purchase — creates the entitlement (Doc 2 §5.2). No refusal path here; the
//    application constructs a valid aggregate. Carries policyVersion (I-12). ──
export function decidePurchase(ctx: DecideContext, ent: Entitlement): readonly NewEvent[] {
  return [
    {
      ...base(ctx, ent, relOf(ent)),
      type: ENTITLEMENT_PURCHASED,
      payload: {
        productId: ent.productId,
        grant: ent.productSnapshot.grant,
        priceAgreed: ent.priceAgreed,
        listPrice: ent.productSnapshot.listPrice,
        validFrom: ent.validFrom,
        validUntil: ent.validUntil,
      },
    },
  ]
}

// ── Booking HOLDS a credit; available drops immediately (E1). Reservation-side
//    preconditions (I-9: session, capacity, category) live in the reservations
//    module; here we enforce only the entitlement-side guards. ──
export function decideHold(
  ctx: DecideContext,
  ent: Entitlement,
  reservationId: ReservationId,
): Result<LedgerOutcome, DomainError> {
  const ledger = ent.credits
  if (!ledger) return err({ code: 'not_a_credit_entitlement' })
  if (ent.status !== 'active') return err({ code: 'entitlement_not_active' })
  const avail = available(ledger)
  if (avail < 1) return err({ code: 'insufficient_credits', available: avail })

  const nextLedger: CreditLedger = { ...ledger, held: ledger.held + 1 }
  const next = withCredits(ent, nextLedger)
  return ok({
    next,
    events: [
      {
        ...base(ctx, next, relOf(next, reservationId)),
        type: ENTITLEMENT_CREDIT_HELD,
        payload: { reservationId, creditsAvailableAfter: available(nextLedger) },
      },
    ],
  })
}

// ── In-window cancel or studio-cancelled class: release the hold. No counter
//    moves (Doc 2 §5.3) — held simply decrements, available returns. ──
export function decideRelease(
  ctx: DecideContext,
  ent: Entitlement,
  reservationId: ReservationId,
  reason: string,
): Result<LedgerOutcome, DomainError> {
  const ledger = ent.credits
  if (!ledger) return err({ code: 'not_a_credit_entitlement' })
  if (ledger.held < 1) return err({ code: 'no_held_credit' })

  const nextLedger: CreditLedger = { ...ledger, held: ledger.held - 1 }
  const next = withCredits(ent, nextLedger)
  return ok({
    next,
    events: [
      {
        ...base(ctx, next, relOf(next, reservationId)),
        type: ENTITLEMENT_CREDIT_RELEASED,
        payload: { reservationId, reason, creditsAvailableAfter: available(nextLedger) },
      },
    ],
  })
}

// ── Resolution (attended | no-show | late cancel) CONSUMES: held→consumed. The
//    last consumed credit also emits `exhausted`. ──
export function decideConsume(
  ctx: DecideContext,
  ent: Entitlement,
  reservationId: ReservationId,
  reason: string,
): Result<LedgerOutcome, DomainError> {
  const ledger = ent.credits
  if (!ledger) return err({ code: 'not_a_credit_entitlement' })
  if (ledger.held < 1) return err({ code: 'no_held_credit' })

  const nextLedger: CreditLedger = { ...ledger, held: ledger.held - 1, consumed: ledger.consumed + 1 }
  const next = withCredits(ent, nextLedger)
  const avail = available(nextLedger)
  const events: NewEvent[] = [
    {
      ...base(ctx, next, relOf(next, reservationId)),
      type: ENTITLEMENT_CREDIT_CONSUMED,
      payload: { reservationId, reason, creditsAvailableAfter: avail },
    },
  ]
  if (avail === 0) {
    events.push({ ...base(ctx, next, relOf(next)), type: ENTITLEMENT_EXHAUSTED, payload: {} })
  }
  return ok({ next, events })
}

// ── Attendance correction hands a consumed credit back: restored++ (consumed
//    stays — I-3 monotonic). Never a silent edit (D5). ──
export function decideRestore(
  ctx: DecideContext,
  ent: Entitlement,
  reservationId: ReservationId,
  reason: string,
): Result<LedgerOutcome, DomainError> {
  const ledger = ent.credits
  if (!ledger) return err({ code: 'not_a_credit_entitlement' })

  const nextLedger: CreditLedger = { ...ledger, restored: ledger.restored + 1 }
  const next = withCredits(ent, nextLedger)
  return ok({
    next,
    events: [
      {
        ...base(ctx, next, relOf(next, reservationId)),
        type: ENTITLEMENT_CREDIT_RESTORED,
        payload: { reservationId, reason, creditsAvailableAfter: available(nextLedger) },
      },
    ],
  })
}

// ── Extension (D21/D22, v1.22) — the studio owed her TIME back. ──
//
// It moves `validUntil` and nothing else: no credit is granted, no counter moves. A closure did
// not give her more classes; it gave her back the days she could not use.
//
// A frozen entitlement is REFUSED here, not silently extended: freeze arithmetic is deliberately
// unbuilt (DEBT-009), and extending a frozen package would be doing it by the back door.
export function decideExtend(
  ctx: DecideContext,
  ent: Entitlement,
  days: number,
  reason: string,
  operationId: string | null,
): Result<{ next: Entitlement; events: NewEvent[] }, DomainError> {
  if (days <= 0) return err({ code: 'invalid_time_range' })
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  if (ent.status === 'frozen') return err({ code: 'entitlement_frozen' })
  if (ent.status !== 'active') return err({ code: 'entitlement_not_active' })

  const toValidUntil = instant(ent.validUntil + days * 86_400_000)
  const next: Entitlement = { ...ent, validUntil: toValidUntil }

  return ok({
    next,
    events: [
      {
        ...base(ctx, next, {}),
        type: ENTITLEMENT_EXTENDED,
        payload: {
          days,
          fromValidUntil: ent.validUntil,
          toValidUntil,
          reason,
          operationId,
        },
      },
    ],
  })
}

// ── Admin adjustment (AD-39, I-20). `note` mandatory; a decrease below zero is
//    REFUSED, never clamped (I-1). Positive → restored, negative → revoked; never
//    `granted`, never `consumed`. ──
export function decideAdjust(
  ctx: DecideContext,
  ent: Entitlement,
  delta: number,
  reason: AdjustmentReason,
  note: string,
): Result<LedgerOutcome, DomainError> {
  if (note.trim().length === 0) return err({ code: 'note_required' })
  const ledger = ent.credits
  if (!ledger) return err({ code: 'not_a_credit_entitlement' })
  if (!Number.isInteger(delta) || delta === 0) return err({ code: 'invalid_adjustment' })

  const avail = available(ledger)
  if (avail + delta < 0) return err({ code: 'insufficient_credits', available: avail })

  const nextLedger: CreditLedger =
    delta > 0
      ? { ...ledger, restored: ledger.restored + delta }
      : { ...ledger, revoked: ledger.revoked - delta }
  const next = withCredits(ent, nextLedger)
  return ok({
    next,
    events: [
      {
        ...base(ctx, next, relOf(next)),
        type: ENTITLEMENT_ADJUSTED,
        payload: { delta, reason, note, creditsAvailableAfter: available(nextLedger) },
      },
    ],
  })
}

// ── Expiry sweep (actor: system). An entitlement may not expire while credits are
//    held (I-19) — the auto-resolver runs first. Unused credits → expired, the
//    churn signal (I-4). ──
export function decideExpire(ctx: DecideContext, ent: Entitlement): Result<LedgerOutcome, DomainError> {
  if (ent.status !== 'active') return err({ code: 'entitlement_not_active' })
  const ledger = ent.credits
  if (ledger && ledger.held > 0) return err({ code: 'held_credits_block_expiry', held: ledger.held })

  const creditsExpired = ledger ? available(ledger) : 0
  const next: Entitlement = ledger
    ? { ...withCredits(ent, { ...ledger, expired: ledger.expired + creditsExpired }), status: 'expired' }
    : { ...ent, status: 'expired' }
  return ok({
    next,
    events: [
      {
        ...base(ctx, next, relOf(next)),
        type: ENTITLEMENT_EXPIRED,
        payload: { grantKind: ent.productSnapshot.grant.kind, creditsExpired },
      },
    ],
  })
}

// ── Cancel the entitlement (admin). ──
export function decideCancel(
  ctx: DecideContext,
  ent: Entitlement,
  reason: string,
  refundPaymentId: PaymentId | null,
): Result<LedgerOutcome, DomainError> {
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  if (ent.status === 'cancelled' || ent.status === 'expired') {
    return err({ code: 'entitlement_not_active' })
  }
  const next: Entitlement = { ...ent, status: 'cancelled' }
  return ok({
    next,
    events: [
      {
        ...base(ctx, next, relOf(next)),
        type: ENTITLEMENT_CANCELLED,
        // `priceAgreed` and `productId` are ADDITIVE (v1.23): the dashboard's sales figure must go
        // NET when a sale is reversed (owner, D-1), and a projector may read only events — never a
        // state document. Without the amount in the event, the number could not be un-sold without
        // giving the projection a second source of truth. No version bump, no backfill: a
        // cancellation written before today simply carries no amount, and is not subtracted.
        payload: { reason, refundPaymentId, priceAgreed: next.priceAgreed, productId: next.productId },
      },
    ],
  })
}

// ── Manual payment recording (v1.14). Record-only — no allocation engine, no
//    payment aggregate. `paidTotal` mirrors the collected amount; `balanceDue =
//    priceAgreed − collected` (may be negative on overpayment, positive on account). ──
export function decideRecordPayment(
  ctx: DecideContext,
  ent: Entitlement,
  input: { collectedAmount: Money; method: PaymentMethod; note: string | null },
): Result<LedgerOutcome, DomainError> {
  if (input.collectedAmount.amount < 0) return err({ code: 'invalid_amount' })
  const manualPayment: ManualPayment = {
    collectedAmount: input.collectedAmount,
    method: input.method,
    note: input.note,
    recordedAt: ctx.now,
  }
  const next: Entitlement = { ...ent, manualPayment, paidTotal: input.collectedAmount }
  const balanceDue = subtractMoney(ent.priceAgreed, input.collectedAmount)
  return ok({
    next,
    events: [
      {
        ...base(ctx, next, relOf(next)),
        type: ENTITLEMENT_PAYMENT_RECORDED,
        payload: {
          collectedAmount: input.collectedAmount,
          method: input.method,
          note: input.note,
          priceAgreed: ent.priceAgreed,
          balanceDue,
        },
      },
    ],
  })
}

// ── Generic amend (v1.14): edit dates, price, or the manual payment, each with a
//    before/after and a mandatory reason (AD-22). Credits are NOT amended here — they
//    go through `decideAdjust`. No-op edits emit nothing. ──
export interface AmendPatch {
  readonly validFrom?: Instant
  readonly validUntil?: Instant
  readonly priceAgreed?: Money
  readonly manualPayment?: ManualPayment | null
}

const sameManualPayment = (a: ManualPayment | null, b: ManualPayment | null): boolean => {
  if (a === null || b === null) return a === b
  return a.collectedAmount.amount === b.collectedAmount.amount && a.method === b.method && a.note === b.note
}

export function decideAmend(
  ctx: DecideContext,
  ent: Entitlement,
  patch: AmendPatch,
  reason: string,
): Result<LedgerOutcome, DomainError> {
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  let next: Entitlement = ent

  if (patch.validFrom !== undefined && patch.validFrom !== ent.validFrom) {
    changes.validFrom = { from: ent.validFrom, to: patch.validFrom }
    next = { ...next, validFrom: patch.validFrom }
  }
  if (patch.validUntil !== undefined && patch.validUntil !== ent.validUntil) {
    changes.validUntil = { from: ent.validUntil, to: patch.validUntil }
    next = { ...next, validUntil: patch.validUntil }
  }
  if (patch.priceAgreed !== undefined && patch.priceAgreed.amount !== ent.priceAgreed.amount) {
    changes.priceAgreed = { from: ent.priceAgreed, to: patch.priceAgreed }
    next = { ...next, priceAgreed: patch.priceAgreed }
  }
  if (patch.manualPayment !== undefined && !sameManualPayment(ent.manualPayment, patch.manualPayment)) {
    changes.manualPayment = { from: ent.manualPayment, to: patch.manualPayment }
    next = {
      ...next,
      manualPayment: patch.manualPayment,
      paidTotal: patch.manualPayment?.collectedAmount ?? zeroMoney(ent.priceAgreed.currency),
    }
  }

  const changedFields = Object.keys(changes)
  if (changedFields.length === 0) return ok({ next: ent, events: [] })
  return ok({
    next,
    events: [{ ...base(ctx, next, relOf(next)), type: ENTITLEMENT_AMENDED, payload: { changedFields, changes, reason } }],
  })
}

// ── Reactivate a cancelled subscription (v1.14) — the inverse of cancel. Only a
//    cancelled entitlement may be reactivated (expired is terminal). ──
export function decideReactivate(
  ctx: DecideContext,
  ent: Entitlement,
  reason: string,
): Result<LedgerOutcome, DomainError> {
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  if (ent.status !== 'cancelled') return err({ code: 'entitlement_not_cancelled' })
  const next: Entitlement = { ...ent, status: 'active' }
  return ok({
    next,
    events: [{ ...base(ctx, next, relOf(next)), type: ENTITLEMENT_REACTIVATED, payload: { reason } }],
  })
}

// ── FREEZE (v1.27 S3 · owner, 2026-07-13 · closes DEBT-009) ──────────────────────────────────
//
// The arithmetic, settled by the owner and written here once:
//
//   1. **The extension happens at UNFREEZE**, and it is the days the membership actually stood
//      still: `validUntil += (to − from)`. Freezing moves no date, because at freeze time nobody
//      knows how long it will last — and a system that guessed would have to un-guess later, in a
//      member's favour or against it.
//
//   2. **The budget is a ceiling the system enforces**, not a number a human is trusted to
//      remember. A Fitness 3-month membership buys one week of freeze; on the seventh day the
//      nightly sweep unfreezes her automatically and extends her membership by exactly the seven
//      days she paid for. *An unlimited freeze is an unlimited membership, sold at the price of a
//      three-month one.*
//
//   3. **A member with an upcoming booking is REFUSED**, not silently fixed. Cancelling her class
//      for her would move a credit she did not ask us to move; the domain says no and the screen
//      says why (owner: "Hiçbir kredi veya rezervasyon otomatik değiştirilmesin").
//
// Nothing here knows the number seven. The budget is `product.freezeAllowanceDays`, copied onto the
// entitlement at purchase — data, as the catalogue always was (#12, AD-41). Pilates has none, and
// so `freeze` is `null`, and the domain refuses.

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days between two LocalDates. A freeze from the 10th to the 15th cost five days. */
export function freezeDaysBetween(from: string, to: string): number {
  return daysBetween(from, to)
}

/** Her remaining budget. The screen shows it; the sweep enforces it. */
export function freezeDaysRemaining(f: FreezeState): number {
  return Math.max(0, f.entitledDays - f.usedDays)
}

export function decideFreeze(
  ctx: DecideContext,
  ent: Entitlement,
  from: string, // LocalDate — today, in the studio's timezone
  hasUpcomingReservation: boolean,
): Result<LedgerOutcome, DomainError> {
  if (ent.status === 'frozen') return err({ code: 'entitlement_already_frozen' })
  if (ent.status !== 'active') return err({ code: 'entitlement_not_active' })

  // Pilates packages have no freeze allowance, so they carry no FreezeState at all. The refusal is
  // the product's terms, not a missing feature.
  const f = ent.freeze
  if (!f || f.entitledDays <= 0) return err({ code: 'freeze_not_allowed' })
  if (freezeDaysRemaining(f) <= 0) return err({ code: 'freeze_budget_exhausted' })

  // Owner, 2026-07-13: refuse, and say why. We do not cancel her class for her — that would move a
  // credit she never asked us to move, and she would find out from a ledger rather than from us.
  if (hasUpcomingReservation) return err({ code: 'freeze_blocked_by_reservation' })

  const next: Entitlement = {
    ...ent,
    status: 'frozen',
    freeze: { ...f, activeFrom: from },
  }

  return ok({
    next,
    events: [
      {
        ...base(ctx, ent, { entitlementId: ent.id, memberId: ent.memberId }),
        type: ENTITLEMENT_FROZEN,
        // It moves NO date. It records only that the clock stopped, and what she had left to spend.
        payload: { from, entitledDays: f.entitledDays, usedDaysBefore: f.usedDays },
      },
    ],
  })
}

/**
 * @param to    LocalDate the freeze ends on.
 * @param auto  TRUE when the nightly sweep ended it because her budget ran out. Nobody asked for
 *              this, and the audit must not read as though somebody did.
 */
export function decideUnfreeze(
  ctx: DecideContext,
  ent: Entitlement,
  to: string,
  auto: boolean,
): Result<LedgerOutcome, DomainError> {
  if (ent.status !== 'frozen') return err({ code: 'entitlement_not_frozen' })
  const f = ent.freeze
  if (!f?.activeFrom) return err({ code: 'entitlement_not_frozen' })

  // What it actually cost — CAPPED at what she had left. A member who stayed frozen ten days on a
  // seven-day budget is extended by seven, not ten. She bought a week; she gets a week. (The sweep
  // normally ends it on day seven anyway; this cap is the second line of defence, for the case where
  // the sweep did not run.)
  const elapsed = Math.max(0, freezeDaysBetween(f.activeFrom, to))
  const days = Math.min(elapsed, freezeDaysRemaining(f))

  const validUntilBefore = ent.validUntil
  const validUntilAfter = instant((validUntilBefore as number) + days * DAY_MS)

  const next: Entitlement = {
    ...ent,
    status: 'active',
    validUntil: validUntilAfter,
    freeze: {
      ...f,
      usedDays: f.usedDays + days,
      periods: [...f.periods, { from: f.activeFrom, to }],
      activeFrom: null,
    },
  }

  return ok({
    next,
    events: [
      {
        ...base(ctx, ent, { entitlementId: ent.id, memberId: ent.memberId }),
        type: ENTITLEMENT_UNFROZEN,
        payload: {
          from: f.activeFrom,
          to,
          days,
          usedDaysAfter: f.usedDays + days,
          // The number that MOVED. She is judged by this date; a date that changed with no record is
          // a date she can dispute and we cannot defend (AD-19).
          validUntilBefore: validUntilBefore as number,
          validUntilAfter: validUntilAfter as number,
          auto,
        },
      },
    ],
  })
}
