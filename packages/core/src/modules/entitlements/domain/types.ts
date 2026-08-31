import type {
  Category,
  EntitlementId,
  Instant,
  MemberId,
  Money,
  ProductId,
  ServiceId,
  StudioId,
} from '../../../shared'

// The entitlement aggregate and its credit ledger (Doc 2 §5). This is the money
// core: one aggregate, two shapes (credits | period), discriminated by grant.kind.
// PURE domain types — no firebase-admin, no clock, no zod.

// ── What buying a product gives you (Doc 2 §5.1). Frozen into the entitlement at
//    purchase, so a later catalogue edit can never rewrite what a member bought. ──
export type CreditGrant = {
  readonly kind: 'credits'
  readonly credits: number
  readonly validForDays: number
}
export type PeriodGrant = {
  readonly kind: 'period'
  readonly durationDays: number
  readonly access: 'unlimited'
}
export type Grant = CreditGrant | PeriodGrant

// What the member actually bought, frozen at purchase (Doc 2 §5.2). `category` is a
// closed enum because the category wall (I-9.7) compares it to the session's.
//
// `serviceIds` (D12, v1.21) is the SERVICE-level right — the explicit list of services this
// purchase covers, copied from the product at purchase. Editing the product tomorrow cannot
// reach it, which is the whole point: a right already sold is never rewritten.
//
// **Absent is not missing data — absent is the record of what was sold.** An entitlement
// bought before D12 has no list, and keeps the category-wide right it was sold under. It is
// NEVER backfilled from today's product definition: that would retroactively narrow a right a
// member paid for (owner, 2026-07-12).
export type ProductSnapshot = {
  readonly productId: ProductId
  readonly name: string
  readonly category: Category
  readonly grant: Grant
  readonly listPrice: Money
  readonly serviceIds?: readonly ServiceId[] // absent ⇒ legacy, category-wide
  // ── Package rules (Plus Phase 3), frozen at purchase like everything else in the snapshot. A
  //    later catalogue edit never reaches a right already sold. ABSENT ⇒ pre-Phase-3 purchase, which
  //    keeps the unlimited behaviour it was sold under. null ⇒ unlimited; a number ⇒ a counted limit,
  //    the package DEFAULT the member override is resolved against at reservation time. ──
  readonly cancellationAllowanceCount?: number | null
  readonly dailyReservationLimit?: number | null
  readonly activeReservationLimit?: number | null
  // ── Fitness serbest-giriş cap (v1.27). The MAX number of door check-ins this membership allows,
  //    frozen at purchase. ABSENT or null ⇒ unlimited access (a normal period membership). A number ⇒
  //    a soft cap: each fitness check-in consumes one entry; over-use is recorded, not blocked. ──
  readonly entryAllowance?: number | null
}

export type EntitlementStatus = 'active' | 'frozen' | 'expired' | 'cancelled'

// Manual, record-only payment for a subscription (v1.14). Deliberately NOT a payment
// aggregate or allocation engine — a clean seam that a future `payments` module can
// migrate from. Revenue is `collectedAmount` on `recordedAt` (Doc 2 §6). null ⇔ comp
// / sold-on-account (balanceDue > 0 is legal, OQ-10).
export const PaymentMethods = ['cash', 'credit_card', 'bank_transfer'] as const
export type PaymentMethod = (typeof PaymentMethods)[number]

export type ManualPayment = {
  readonly collectedAmount: Money
  readonly method: PaymentMethod
  readonly note: string | null
  readonly recordedAt: Instant
}

// The credit ledger — six monotonically non-decreasing counters (I-3). `available`
// is DERIVED (never stored as truth), denormalised for reads (AD-14):
//   available = granted + restored − consumed − held − revoked − expired
export type CreditLedger = {
  readonly granted: number // what the product gave. Set at purchase, never touched again.
  readonly held: number // open reservations not yet resolved
  readonly consumed: number // spent through a RESOLVED reservation
  readonly restored: number // a consumed credit given back
  readonly revoked: number // an admin adjustment took a credit away — never `consumed`
  readonly expired: number // burned at validUntil, unused — the churn signal
}

// ── Cancellation allowance ledger (Plus Phase 3) ────────────────────────────────────────────
// The package's free-cancellation right, spent as a ledger (never a mutable counter): `used` is
// in-window cancellations charged; `refunded` is the ones a compensating undo/correction gave back.
// Net = used − refunded, rebuildable from the log. The MAX (the allowance) is NOT stored here — it is
// resolved fresh at cancel time from the product snapshot + member override, so a member override can
// raise or lower it without rewriting the entitlement.
export type CancellationLedger = {
  readonly used: number
  readonly refunded: number
}
export function cancellationsUsed(l: CancellationLedger): number {
  return l.used - l.refunded
}

// ── Entry ledger (v1.27) — fitness serbest-giriş cap. Same shape/discipline as the cancellation
//    ledger: `consumed` is door check-ins that spent an entry; `restored` is the ones a correction
//    gave back. Net = consumed − refunded, rebuildable from the log. The MAX (entryAllowance) is NOT
//    stored here — it lives on the product snapshot, so a later edit never rewrites the entitlement.
export type EntryLedger = {
  readonly consumed: number // a DOOR took it — a visit happened
  readonly restored: number // given back (a mistaken check-in, or a desk correction)
  // An admin took one away — NEVER `consumed` (2026-08-27). The credit ledger has had this
  // separation since the beginning and the rule is written down: *"consumed means a class took
  // it."* The entry meter simply never got the bucket, so "set her remaining to 5" had nowhere
  // honest to go: writing it as `consumed` would invent a visit nobody made, and the only
  // alternative was to resize the package. Optional so that every document written before today
  // reads back unchanged.
  readonly revoked?: number
}
export function entriesUsed(l: EntryLedger): number {
  return l.consumed + (l.revoked ?? 0) - l.restored
}

// Freeze is modelled here so the aggregate shape is stable and I-8 holds, but the
// freeze/unfreeze OPERATIONS are deferred (their arithmetic is an open question).
export type FreezePeriod = {
  readonly from: string // LocalDate
  readonly to: string // LocalDate
}
// Why a member's membership was stopped. A CLOSED ENUM, and closed on purpose (owner, 2026-07-28):
// the event log is permanent and free text is the last place personal data hides. "Ayşe hanımın
// ameliyatı" typed into a permanent record is health data nobody can take back out when she asks.
// The human's own words live on `note` below, which is STATE and can itself be erased — the same
// split credit adjustments already use (AD-39).
export type FreezeReason = 'tatil' | 'saglik' | 'is' | 'diger'
export const FreezeReasons: readonly FreezeReason[] = ['tatil', 'saglik', 'is', 'diger']

export type FreezeState = {
  readonly entitledDays: number
  readonly usedDays: number
  readonly periods: readonly FreezePeriod[]
  readonly activeFrom: string | null // LocalDate ⇔ currently frozen
  // The day the sweep resumes her (owner, 2026-07-28). Before this a freeze ran until somebody
  // lifted it or the budget ran out, so nobody — not the member, not the desk — could say when she
  // was coming back. Absent on freezes started before this existed: not a plan of zero days, simply
  // a plan nobody recorded.
  readonly plannedUntil?: string | null // LocalDate
  /**
   * How many days were APPROVED for the freeze currently running (owner, 2026-07-31).
   *
   * Normally identical to what her budget allows. It differs only when the desk deliberately
   * exceeded the allowance — "bazı üyelere inisiyatif kullanabiliyoruz" — and it exists because the
   * unfreeze has to know what was promised. Without it, a member frozen for fourteen days on a
   * seven-day package would be extended by seven: stopped for a fortnight, paid back a week.
   *
   * Absent on freezes started before this existed, and on none that are running today; those fall
   * back to the budget exactly as they did.
   */
  readonly grantedDays?: number | null
  readonly reason?: FreezeReason
  /** The human's explanation. STATE, never an event — free text is where PII hides. */
  readonly note?: string | null
  /**
   * A freeze agreed for LATER (owner, 2026-08-31): the LocalDate it will start on.
   *
   * Present ⇔ a window is booked and has not begun. She is still `active` and may still come to
   * class before it starts — a scheduled freeze is not a freeze, and the day the clock stops is
   * still the day `entitlement.frozen` says it stopped.
   *
   * `plannedUntil` and `grantedDays` describe the booked window while this is set, and go on
   * describing the running one after the sweep starts it. `activeFrom` is what separates the two.
   */
  readonly scheduledFrom?: string | null // LocalDate
  /**
   * The same window as INSTANTS — so a pure eligibility check can use it (DEBT-037, repaid the day
   * it was taken).
   *
   * A booked window is two calendar dates; `isEligibleForService` holds only `Instant`s and must
   * stay ignorant of the studio's timezone. Rather than teach it, or thread a local date through
   * four call sites that would each have to learn the offset, the conversion is done ONCE by the
   * caller that already knows it — the same arrangement `from` uses everywhere else here.
   *
   * It is the same fact twice, and it is justified by CORRECTNESS rather than speed: without it a
   * member can book a class into days the studio has already agreed to stop for. Rebuildable from
   * `scheduledFrom`/`plannedUntil` and the studio offset if it ever drifts.
   */
  readonly scheduledFromAt?: number | null
  readonly scheduledUntilAt?: number | null
  /**
   * Why the desk went past the allowance (owner, 2026-08-31).
   *
   * Initiative has been allowed since 2026-07-31, but it was silent: the event recorded HOW MANY
   * days were over, and nothing recorded WHY. The owner asked for both — the reason is required at
   * the moment of the exception, when the person still knows it, rather than reconstructed from a
   * date months later.
   *
   * STATE, never an event, for the same reason `note` is: "ameliyat sonrası" typed into a permanent
   * log is health data nobody can take back out. The EVENT carries `overageDays`, which is the part
   * the owner will query ("how often do we go past our own terms?"); the words stay erasable.
   */
  readonly overrideReason?: string | null
}

// D3 — the rules AS THEY WERE at purchase. Mirrors shared PolicyRef.
export type PolicyVersionRef = {
  readonly policyId: string
  readonly version: number
}

export type Entitlement = {
  readonly id: EntitlementId
  readonly studioId: StudioId
  readonly memberId: MemberId
  readonly productId: ProductId
  readonly productSnapshot: ProductSnapshot
  readonly policyRef: PolicyVersionRef

  readonly status: EntitlementStatus
  readonly validFrom: Instant
  readonly validUntil: Instant // freeze moves this forward (freeze op deferred)

  readonly credits: CreditLedger | null // null ⇔ period entitlement
  readonly freeze: FreezeState | null // null ⇔ freezing not permitted
  // Plus Phase 3 — the free-cancellation ledger. Present on every entitlement (init {0,0}); inert
  // when the package allowance resolves to unlimited. Legacy docs default to {0,0} on read.
  readonly cancellationLedger: CancellationLedger
  // v1.27 — the fitness entry ledger. Present on every entitlement (init {0,0}); inert unless the
  // product snapshot carries an entryAllowance. Legacy docs default to {0,0} on read.
  readonly entryLedger: EntryLedger

  // What was owed, and what has been collected (payment is optional, OQ-10).
  readonly priceAgreed: Money
  readonly paidTotal: Money // denormalised; mirrors manualPayment.collectedAmount (v1.14)
  readonly manualPayment: ManualPayment | null // the record-only payment seam (v1.14)

  readonly purchasedAt: Instant
}

export const AdjustmentReasons = ['gift', 'correction', 'migration', 'support'] as const
export type AdjustmentReason = (typeof AdjustmentReasons)[number]

// ── Derived ledger value. Never stored as truth; recomputed and denormalised. ──
export function available(l: CreditLedger): number {
  return l.granted + l.restored - l.consumed - l.held - l.revoked - l.expired
}
