import {
  err,
  hourRangeValid,
  ok,
  type ActorRef,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type NewEvent,
  type ReservationOverride,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  MEMBER_DEACTIVATED,
  MEMBER_ERASED,
  MEMBER_INVITED,
  MEMBER_PORTAL_ACTIVATED,
  MEMBER_PORTAL_LOGIN,
  MEMBER_PROFILE_UPDATED,
  MEMBER_REGISTERED,
  MEMBER_RESTRICTION_CLEARED,
  MEMBER_RESTRICTION_SET,
  type ErasureReason,
  type MemberDeactivatedPayload,
  type MemberErasedPayload,
  type MemberProfileUpdatedPayload,
  type MemberRegisteredPayload,
} from '../events'
import type { Member, MemberRestriction } from './member'

// Pure decision functions: (state, command, context) → events. No I/O, no clock,
// no id minting (that is infrastructure — non-negotiable #7). The context carries
// the injected `now`, the acting principal, the correlation id, and the source.
export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

function base(ctx: DecideContext, member: Member) {
  return {
    studioId: ctx.studioId,
    branchId: member.homeBranchId,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind: 'member', id: member.id } as const,
    related: { memberId: member.id },
    policyRef: null,
    commandId: null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

export function decideRegisterMember(
  ctx: DecideContext,
  member: Member,
): NewEvent<typeof MEMBER_REGISTERED, MemberRegisteredPayload>[] {
  return [
    {
      ...base(ctx, member),
      type: MEMBER_REGISTERED,
      payload: { homeBranchId: member.homeBranchId, joinedAt: member.joinedAt },
    },
  ]
}

// The PII fields whose change is worth recording (names only in the event).
const TRACKED_FIELDS = [
  'fullName',
  'phone',
  'email',
  'birthDate',
  'notes',
  'emergencyContact',
  'homeBranchId',
] as const

// ⚠ OQ-2 DOES NOT APPLY HERE. A member's profile fields ARE the PII — name, phone, birth date.
// Recording their before/after in an event payload would put PII in the log, which is
// non-negotiable #6 and unrecoverable: it is what makes KVKK erasure possible at all. The Audit
// Log therefore shows WHICH fields a profile edit touched, never their values. The values live in
// /members, where they can be erased.
function changedFields(current: Member, next: Member): string[] {
  return TRACKED_FIELDS.filter(
    (f) => JSON.stringify(current[f]) !== JSON.stringify(next[f]),
  )
}

export function decideUpdateProfile(
  ctx: DecideContext,
  current: Member,
  next: Member,
): NewEvent<typeof MEMBER_PROFILE_UPDATED, MemberProfileUpdatedPayload>[] {
  const fields = changedFields(current, next)
  if (fields.length === 0) return []
  return [
    {
      ...base(ctx, next),
      type: MEMBER_PROFILE_UPDATED,
      payload: { changedFields: fields },
    },
  ]
}

export function decideDeactivate(
  ctx: DecideContext,
  current: Member,
  reason: string,
): Result<NewEvent<typeof MEMBER_DEACTIVATED, MemberDeactivatedPayload>[], DomainError> {
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  if (current.status !== 'active') return ok([]) // idempotent: already inactive
  return ok([{ ...base(ctx, current), type: MEMBER_DEACTIVATED, payload: { reason } }])
}


// ── "Kısıtlı Üyelik" (Plus Phase 3) ──────────────────────────────────────────────────────────
//
// Set or clear a member's override of the package rules. Mirrors the adjustment pattern (AD-39): a
// closed-enum reason and a mandatory note — but the note stays on STATE and only the reason + the
// PII-free structured rules enter the log. A malformed hour window is REFUSED, never silently
// reinterpreted (owner: "sessiz varsayım yapma").
function invalidRules(r: ReservationOverride): DomainError | null {
  if (r.allowedWeekdays != null && r.allowedWeekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { code: 'invalid_weekday' }
  }
  if (r.allowedHourRanges != null && r.allowedHourRanges.some((h) => !hourRangeValid(h))) {
    return { code: 'invalid_hour_range' }
  }
  if (r.cancellationAllowance != null && (!Number.isInteger(r.cancellationAllowance) || r.cancellationAllowance < 0)) {
    return { code: 'invalid_allowance' }
  }
  if (r.dailyReservationLimit != null && (!Number.isInteger(r.dailyReservationLimit) || r.dailyReservationLimit < 1)) {
    return { code: 'invalid_limit' }
  }
  if (r.activeReservationLimit != null && (!Number.isInteger(r.activeReservationLimit) || r.activeReservationLimit < 1)) {
    return { code: 'invalid_limit' }
  }
  // Plus Phase 4 — a trainer whitelist must name at least one trainer (an empty list would refuse
  // every booking, which is never what "restrict to trainers" means).
  if (r.allowedTrainerIds != null && (r.allowedTrainerIds.length === 0 || r.allowedTrainerIds.some((t) => t.trim().length === 0))) {
    return { code: 'invalid_trainer' }
  }
  // Plus Phase 4 — a validity window that ends before it starts is refused, never reinterpreted.
  if (r.effectiveFrom != null && r.effectiveUntil != null && r.effectiveUntil <= r.effectiveFrom) {
    return { code: 'invalid_validity_range' }
  }
  return null
}

export function decideSetRestriction(
  ctx: DecideContext,
  current: Member,
  restriction: MemberRestriction,
): Result<{ next: Member; events: NewEvent[] }, DomainError> {
  if (current.status === 'deleted' || current.erased) return err({ code: 'member_not_active' })
  if (restriction.note.trim().length === 0) return err({ code: 'note_required' })
  const bad = invalidRules(restriction)
  if (bad) return err(bad)

  const rules: ReservationOverride = {
    allowedWeekdays: restriction.allowedWeekdays ?? null,
    allowedHourRanges: restriction.allowedHourRanges ?? null,
    allowedTrainerIds: restriction.allowedTrainerIds ?? null,
    effectiveFrom: restriction.effectiveFrom ?? null,
    effectiveUntil: restriction.effectiveUntil ?? null,
    ...(restriction.cancellationAllowance !== undefined ? { cancellationAllowance: restriction.cancellationAllowance } : {}),
    ...(restriction.dailyReservationLimit !== undefined ? { dailyReservationLimit: restriction.dailyReservationLimit } : {}),
    ...(restriction.activeReservationLimit !== undefined ? { activeReservationLimit: restriction.activeReservationLimit } : {}),
  }
  const next: Member = { ...current, restriction }
  return ok({
    next,
    events: [{ ...base(ctx, next), type: MEMBER_RESTRICTION_SET, payload: { reason: restriction.reason, rules } }],
  })
}

export function decideClearRestriction(
  ctx: DecideContext,
  current: Member,
  reason: string,
): Result<{ next: Member; events: NewEvent[] }, DomainError> {
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  if (current.restriction === null) return ok({ next: current, events: [] }) // idempotent
  const next: Member = { ...current, restriction: null }
  return ok({
    next,
    events: [{ ...base(ctx, next), type: MEMBER_RESTRICTION_CLEARED, payload: { reason } }],
  })
}

// ── The portal (v1.21) ────────────────────────────────────────────────────────────────────

// D1/D2 — issue a portal invite. Refused for a member who is not active: an invite is a key to
// an account, and a deactivated member has no business getting one.
export function decideIssueInvite(
  ctx: DecideContext,
  member: Member,
  expiresAt: Instant,
): Result<NewEvent[], DomainError> {
  if (member.status !== 'active') return err({ code: 'member_not_active' })
  return ok([
    {
      ...base(ctx, member),
      type: MEMBER_INVITED,
      payload: { expiresAt }, // never the token
      related: { memberId: member.id },
    },
  ])
}

// The member sets her own password and her account comes alive. Actor: the MEMBER — she did
// this, not the receptionist (non-negotiable #5).
export function decidePortalActivated(ctx: DecideContext, member: Member): NewEvent[] {
  return [
    {
      ...base(ctx, member),
      type: MEMBER_PORTAL_ACTIVATED,
      payload: {},
      related: { memberId: member.id },
    },
  ]
}

export function decidePortalLogin(ctx: DecideContext, member: Member): NewEvent[] {
  return [
    {
      ...base(ctx, member),
      type: MEMBER_PORTAL_LOGIN,
      payload: {},
      related: { memberId: member.id },
    },
  ]
}

// ── KVKK / GDPR erasure (v1.26 · AD-67, owner 2026-07-13) ────────────────────────────────────
//
// The only act in this system that DESTROYS information, which is why it is the most carefully
// guarded one. Three rules, and each has a failure it exists to prevent:
//
//   • **`platform_admin` only.** Erasure is a break-glass act, not an operation. Reception must not
//     be able to make a member disappear, and neither must the owner in the middle of an argument.
//   • **A reason is mandatory, and it is a CLOSED ENUM.** A deletion nobody recorded is
//     indistinguishable from a deletion somebody did to hide something. And a *free-text* reason is
//     the last place PII can hide in a permanent log — the enum makes it analysable, and the human's
//     explanation lives on the tombstone in state, where it can itself be erased.
//   • **Idempotent.** A second erasure emits NO event. She was already forgotten; saying so twice
//     adds nothing to the record and would make an audit look like two separate acts.
export function decideErase(
  ctx: DecideContext,
  current: Member,
  reason: ErasureReason,
  note: string | null,
): Result<{ next: Member; events: NewEvent<typeof MEMBER_ERASED, MemberErasedPayload>[] }, DomainError> {
  // The actor, not the role: `role` says what a principal may generally do, `actor.type` says WHO is
  // acting. An erasure is only ever a human at a terminal running a break-glass script.
  if (ctx.actor.type !== 'platform_admin') return err({ code: 'erasure_requires_platform_admin' })

  if (current.erased) {
    // Already forgotten. No event, no change — and no error either: re-running a break-glass script
    // because the first run's output scrolled away must be safe.
    return ok({ next: current, events: [] })
  }

  const next: Member = {
    ...current,
    // Every string that could identify her. The phone's uniqueness key goes too — leaving it would
    // keep her number in the index, which is precisely the thing she asked us to forget.
    fullName: '[silindi]',
    phone: '' as Member['phone'],
    phoneNormalized: '',
    email: null,
    birthDate: null,
    notes: null,
    emergencyContact: null,
    status: 'inactive',
    erased: { at: ctx.now, reason, note },
  }

  return ok({
    next,
    events: [
      {
        ...base(ctx, current),
        type: MEMBER_ERASED,
        // memberId is opaque and already on every event she ever caused. It now resolves to nobody —
        // which is what erasure IS here: not amnesia, but severing behaviour from a person.
        payload: { memberId: current.id as string, reason, erasedAt: ctx.now },
      },
    ],
  })
}
