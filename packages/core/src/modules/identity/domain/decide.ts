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
  type StaffRole,
  type StaffUserId,
  type StudioId,
} from '../../../shared'
import {
  STAFF_CREATED,
  STAFF_DEACTIVATED,
  STAFF_REACTIVATED,
  STAFF_ROLE_CHANGED,
  type StaffCreatedPayload,
  type StaffDeactivatedPayload,
  type StaffReactivatedPayload,
  type StaffRoleChangedPayload,
} from '../events'
import type { StaffMember } from './types'

// Who may work here, and as what (v1.27 S1 · owner, 2026-07-13).
//
// Pure. No I/O, no clock, no id minting — the Auth account and the custom claims are infrastructure,
// and they are wired around this, never inside it.
//
// ── The rule that runs through all four decisions ───────────────────────────────────────────
// **Granting a role is the quietest way to widen access in this system.** Making somebody a
// receptionist hands her every member's phone number and the key to the till; it costs nothing, it
// looks like an administrative chore, and it is the single act most worth being able to explain a
// year later. So every one of these appends an event, and a deactivation carries a mandatory reason.

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

const base = (ctx: DecideContext, staffUserId: StaffUserId) => ({
  studioId: ctx.studioId,
  branchId: null,
  version: 1,
  occurredAt: ctx.now,
  actor: ctx.actor,
  source: ctx.source,
  subject: { kind: 'staff', id: staffUserId } as const,
  related: {},
  policyRef: null,
  commandId: null,
  causationId: null,
  correlationId: ctx.correlationId,
})

/**
 * Only the owner (or the platform admin) may decide who works here.
 *
 * `actor.type`, not `role`: this is a question about WHO is acting, and the actor taxonomy exists so
 * the domain can ask it. Reception must not be able to promote herself, and — the case that actually
 * matters — must not be able to create a second account that can.
 */
function mayAdminister(ctx: DecideContext): boolean {
  return ctx.actor.type === 'owner' || ctx.actor.type === 'platform_admin'
}

export function decideCreateStaff(
  ctx: DecideContext,
  staff: StaffMember,
  existing: StaffMember | null,
): Result<NewEvent<typeof STAFF_CREATED, StaffCreatedPayload>[], DomainError> {
  if (!mayAdminister(ctx)) return err({ code: 'staff_admin_required' })
  if (staff.displayName.trim().length === 0) return err({ code: 'name_required' })
  // Idempotent: re-running the bootstrap script (or double-clicking the button) must not mint a
  // second `staff.created` for the same person and make one hiring read as two.
  if (existing) return ok([])

  return ok([
    {
      ...base(ctx, staff.id),
      type: STAFF_CREATED,
      // The NAME is not here. It is PII, it lives on `/staff`, and the log keeps the opaque id and
      // the role — the part that is analysable and the part that must survive her leaving (#6).
      payload: { staffUserId: staff.id as string, role: staff.role },
    },
  ])
}

/**
 * **A studio always has at least one active owner** (owner, 2026-07-13).
 *
 * She is the only principal who can administer staff. A studio whose last owner was demoted or
 * deactivated has locked EVERY HUMAN out of its own permission system — and the way back is a
 * developer with admin credentials running a break-glass script. The refusal costs a click; the
 * recovery costs a phone call to someone who may be on holiday.
 *
 * Note what this rule does NOT forbid: an owner stepping back once a second owner exists. Succession
 * is a thing a studio does, and the invariant is *"at least one"*, not *"you, forever"*.
 */
function isLastActiveOwner(target: StaffMember, activeOwnerCount: number): boolean {
  return target.role === 'owner' && target.active && activeOwnerCount <= 1
}

export function decideChangeRole(
  ctx: DecideContext,
  current: StaffMember,
  to: StaffRole,
  activeOwnerCount: number,
): Result<
  { next: StaffMember; events: NewEvent<typeof STAFF_ROLE_CHANGED, StaffRoleChangedPayload>[] },
  DomainError
> {
  if (!mayAdminister(ctx)) return err({ code: 'staff_admin_required' })
  if (current.role === to) return ok({ next: current, events: [] }) // idempotent, and not an error

  if (isLastActiveOwner(current, activeOwnerCount)) return err({ code: 'last_owner_required' })

  return ok({
    next: { ...current, role: to },
    events: [
      {
        ...base(ctx, current.id),
        type: STAFF_ROLE_CHANGED,
        // BOTH directions. "Ayşe became a receptionist" does not tell you whether that widened her
        // access or narrowed it, and a year later that is the only thing you want to know.
        payload: { staffUserId: current.id as string, from: current.role, to },
      },
    ],
  })
}

export function decideDeactivateStaff(
  ctx: DecideContext,
  current: StaffMember,
  reason: string,
  actingUserId: StaffUserId,
  activeOwnerCount: number,
): Result<
  { next: StaffMember; events: NewEvent<typeof STAFF_DEACTIVATED, StaffDeactivatedPayload>[] },
  DomainError
> {
  if (!mayAdminister(ctx)) return err({ code: 'staff_admin_required' })
  // A departure with no recorded reason is indistinguishable from an account somebody quietly
  // removed, and this is exactly the kind of act an audit exists for.
  if (reason.trim().length === 0) return err({ code: 'reason_required' })
  // Disabling your own login is a footgun with no upside: you are locked out this second, and the
  // person who can let you back in is the colleague you were about to ask anyway.
  if (current.id === actingUserId) return err({ code: 'cannot_deactivate_self' })
  if (isLastActiveOwner(current, activeOwnerCount)) return err({ code: 'last_owner_required' })
  if (!current.active) return ok({ next: current, events: [] }) // already gone

  return ok({
    next: { ...current, active: false },
    events: [
      {
        ...base(ctx, current.id),
        type: STAFF_DEACTIVATED,
        payload: { staffUserId: current.id as string, reason },
      },
    ],
  })
}

export function decideReactivateStaff(
  ctx: DecideContext,
  current: StaffMember,
): Result<
  { next: StaffMember; events: NewEvent<typeof STAFF_REACTIVATED, StaffReactivatedPayload>[] },
  DomainError
> {
  if (!mayAdminister(ctx)) return err({ code: 'staff_admin_required' })
  if (current.active) return ok({ next: current, events: [] })

  return ok({
    next: { ...current, active: true },
    events: [
      {
        ...base(ctx, current.id),
        type: STAFF_REACTIVATED,
        payload: { staffUserId: current.id as string },
      },
    ],
  })
}
