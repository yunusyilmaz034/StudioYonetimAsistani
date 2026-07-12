import {
  err,
  ok,
  type ActorRef,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type NewEvent,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  MEMBER_DEACTIVATED,
  MEMBER_INVITED,
  MEMBER_PORTAL_ACTIVATED,
  MEMBER_PORTAL_LOGIN,
  MEMBER_PROFILE_UPDATED,
  MEMBER_REGISTERED,
  type MemberDeactivatedPayload,
  type MemberProfileUpdatedPayload,
  type MemberRegisteredPayload,
} from '../events'
import type { Member } from './member'

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
