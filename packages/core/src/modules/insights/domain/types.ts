// AI Insights L1 (Plus Phase 10) — the product vision's "Phase 2". The event log was built for this
// from day one. L1 is a DETERMINISTIC, rule-based advisor: it turns the facts the studio already
// records into a ranked "what needs attention today" list, each with a suggested next step that
// deep-links to an EXISTING tool. It never acts — a human decides (roadmap §10; owner rule).
//
// The module is PURE and PII-free: an insight carries opaque ids + numbers, never a name. The web
// layer resolves names for display (the same discipline as events, #6). No event, no aggregate — an
// insight is derived on read and self-clears when the owner acts on the underlying fact.

export type InsightKind =
  | 'expiring_soon' // an active package's time is running out → renewal / churn signal
  // The same clock, but with lessons still on it. Split from `expiring_soon` on 2026-08-20 because
  // the two are different conversations: one is "shall we renew?", the other is "you have four
  // lessons left and five days to use them". Only the second one can still be saved, and merging
  // them buried it — the studio lost 25 credits that way, and the members who lost them did not
  // renew. The money was already collected; what expires is the relationship.
  | 'expiring_with_credits'
  | 'low_credit' // few credits left → renewal opportunity
  | 'outstanding_balance' // sold, not fully paid → collect
  | 'empty_session' // an upcoming class with no/low bookings → fill it
  | 'dormant_member' // has an active package but has stopped coming → the behavioural churn signal
  // ── PF-41 (2026-07-27) — two jobs that sat on the watch list and never reached the checklist ──
  // The dashboard already computed both; nothing turned them into work anyone was told to do.
  | 'credits_exhausted' // package still valid, credits at ZERO → the renewal conversation, at its latest
  | 'unreconciled_payment' // money arrived and belongs to nobody → until it is matched, someone paid and

export type InsightSeverity = 'info' | 'attention' | 'urgent'

// What the owner should DO — each maps to an existing tool the web deep-links to. The advisor suggests;
// it never performs (never auto-acts).
export type InsightAction =
  | 'offer_renewal'
  | 'collect_balance'
  | 'fill_session'
  | 'contact_member'
  // PF-41 — matching a payment to the person who made it. Not "collect": the money is already in.
  | 'reconcile_payment'
  // 2026-08-20 — get her INTO a class before the credits she has already paid for expire. Not a
  // renewal: there is nothing to sell yet, and selling here would be answering the wrong question.
  | 'invite_to_book'

// PF-41 — an unattributed payment has no member and no session; its subject IS the payment. Widening
// this rather than forcing a fake member id keeps "we do not know whose this is" sayable.
export type InsightSubjectType = 'member' | 'session' | 'payment'

export interface InsightSubject {
  readonly type: InsightSubjectType
  readonly id: string
}

export interface Insight {
  // Deterministic: `${kind}__${subjectId}` (+ a discriminator where a subject can have several, e.g.
  // the entitlementId). Stable across a day so a UI can key and a future snooze can target it.
  readonly id: string
  readonly kind: InsightKind
  readonly severity: InsightSeverity
  readonly subject: InsightSubject
  // Opaque join keys the web uses to build a deep link + resolve the display name. NO PII.
  readonly refs: Readonly<Record<string, string>>
  // The numbers behind the insight (daysLeft, remaining, dueKurus, daysOpen, …). The web formats them.
  readonly metrics: Readonly<Record<string, number>>
  readonly suggestedAction: InsightAction
  // Rank within a severity band — higher is more pressing (more overdue, fewer days left).
  readonly urgency: number
}

// Thresholds are DATA, never an `if` buried in a rule (#4's spirit): a studio may one day tune when a
// balance becomes "urgent". Defaults live in `rules.ts`.
export interface InsightConfig {
  readonly balanceUrgentDays: number
  readonly balanceAttentionDays: number
  readonly expiringUrgentDays: number
  readonly expiringAttentionDays: number
  readonly lowCreditAttentionAtOrBelow: number
  readonly emptySessionAttentionHours: number
  // Days since a member with an active package last came. Longer = more likely gone for good.
  readonly dormantAttentionDays: number
  readonly dormantUrgentDays: number
  // PF-41 — an unmatched payment is somebody's money sitting unattributed. A day is a filing delay;
  // a week is a member who paid and, as far as the system knows, did not.
  readonly unreconciledUrgentDays: number
}

// The seam that makes this "AI Insights L1" and not just a report: a source produces insights from the
// facts. L1 ships ONE deterministic rule source; a future L2 LLM narrator implements the SAME
// interface and is merged in — no reshaping of the consumer (the "design the extension point" rule).
export interface InsightSource {
  readonly id: string
  generate(facts: InsightFacts, config: InsightConfig): readonly Insight[]
}

// The normalized facts the rules read — mapped by the web layer from the owner dashboard (a 1-read
// bounded query). PII-free: ids + numbers only.
export interface ExpiringFact {
  readonly memberId: string
  readonly entitlementId: string
  readonly daysLeft: number
  /** Credits still unused. `null` ⇒ a period package; `0` ⇒ a credit package already spent. */
  readonly remainingCredits?: number | null
}
export interface LowCreditFact {
  readonly memberId: string
  readonly entitlementId: string
  readonly remaining: number
}
export interface BalanceFact {
  readonly memberId: string
  readonly saleId: string
  readonly dueKurus: number
  readonly daysOpen: number
}
export interface EmptySessionFact {
  readonly sessionId: string
  readonly capacity: number
  readonly booked: number
  readonly hoursAway: number
}
// A member with an active package who has not come in `daysSinceActivity` days — the behavioural churn
// the whole event model exists to surface (whether her package is ALSO expiring is a separate insight).
export interface DormantFact {
  readonly memberId: string
  readonly daysSinceActivity: number
}

export interface ExhaustedFact {
  readonly memberId: string
  readonly entitlementId: string
  /** Days the package is still valid for. Credits are gone; the TIME left is what makes it urgent. */
  readonly daysLeft: number
}

export interface UnreconciledPaymentFact {
  readonly collectionId: string
  readonly amountKurus: number
  readonly daysOpen: number
}

export interface InsightFacts {
  readonly expiring: readonly ExpiringFact[]
  readonly lowCredit: readonly LowCreditFact[]
  readonly balances: readonly BalanceFact[]
  readonly emptySessions: readonly EmptySessionFact[]
  readonly dormant: readonly DormantFact[]
  // PF-41 — OPTIONAL so every existing caller and test keeps compiling and keeps meaning what it
  // meant: absent is "not supplied", which is exactly what it was before these existed.
  readonly exhausted?: readonly ExhaustedFact[]
  readonly unreconciled?: readonly UnreconciledPaymentFact[]
}
