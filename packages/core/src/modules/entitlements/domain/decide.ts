import {
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
  ENTITLEMENT_CANCELLED,
  ENTITLEMENT_CREDIT_CONSUMED,
  ENTITLEMENT_CREDIT_HELD,
  ENTITLEMENT_CREDIT_RELEASED,
  ENTITLEMENT_CREDIT_RESTORED,
  ENTITLEMENT_EXTENDED,
  ENTITLEMENT_EXHAUSTED,
  ENTITLEMENT_EXPIRED,
  ENTITLEMENT_PAYMENT_RECORDED,
  ENTITLEMENT_PURCHASED,
  ENTITLEMENT_REACTIVATED,
} from '../events'
import {
  available,
  type AdjustmentReason,
  type CreditLedger,
  type Entitlement,
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
        payload: { reason, refundPaymentId },
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
