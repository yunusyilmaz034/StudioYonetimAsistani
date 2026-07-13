import {
  newCorrelationId,
  type DomainError,
  type EventSource,
  type Result,
  type StaffRole,
  type StaffUserId,
  type TenantContext,
} from '../../../shared'
import {
  decideChangeRole,
  decideCreateStaff,
  decideDeactivateStaff,
  decideReactivateStaff,
} from '../domain/decide'
import type { StaffMember } from '../domain/types'
import type { IdentityDeps } from './ports'

const SOURCE: EventSource = 'reception_web'

const dctx = (deps: IdentityDeps, ctx: TenantContext) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  correlationId: newCorrelationId(),
  source: SOURCE,
})

// Who may work here, and as what (v1.27 S1).
//
// The Firebase Auth account and its custom claims are wired AROUND these, in the Server Action —
// never inside them. The domain decides; infrastructure gives her a password.

export async function createStaff(
  deps: IdentityDeps,
  ctx: TenantContext,
  input: { readonly staff: StaffMember },
): Promise<Result<{ created: boolean }, DomainError>> {
  const existing = await deps.repo.getStaff(ctx, input.staff.id)
  const decided = decideCreateStaff(dctx(deps, ctx), input.staff, existing)
  if (!decided.ok) return decided
  if (decided.value.length === 0) return { ok: true, value: { created: false } } // already there

  await deps.repo.saveStaff(ctx, input.staff, decided.value)
  return { ok: true, value: { created: true } }
}

/**
 * How many owners could still administer this studio if we did nothing?
 *
 * Read at decision time, from the same list the decision is about. It is not stored anywhere — a
 * counter of owners would be a denormalised field that can drift, and the one thing it must never do
 * is drift to 1 when the truth is 0.
 */
async function activeOwners(deps: IdentityDeps, ctx: TenantContext): Promise<number> {
  const all = await deps.repo.listStaff(ctx)
  return all.filter((s) => s.active && s.role === 'owner').length
}

export async function changeStaffRole(
  deps: IdentityDeps,
  ctx: TenantContext,
  input: { readonly staffUserId: StaffUserId; readonly role: StaffRole },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getStaff(ctx, input.staffUserId)
  if (!current) throw new Error(`Staff not found: ${input.staffUserId}`)

  const decided = decideChangeRole(
    dctx(deps, ctx),
    current,
    input.role,
    await activeOwners(deps, ctx),
  )
  if (!decided.ok) return decided
  if (decided.value.events.length === 0) return { ok: true, value: undefined }

  await deps.repo.saveStaff(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: undefined }
}

export async function deactivateStaff(
  deps: IdentityDeps,
  ctx: TenantContext,
  input: { readonly staffUserId: StaffUserId; readonly reason: string },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getStaff(ctx, input.staffUserId)
  if (!current) throw new Error(`Staff not found: ${input.staffUserId}`)

  const decided = decideDeactivateStaff(
    dctx(deps, ctx),
    current,
    input.reason,
    ctx.actor.id as StaffUserId,
    await activeOwners(deps, ctx),
  )
  if (!decided.ok) return decided
  if (decided.value.events.length === 0) return { ok: true, value: undefined }

  await deps.repo.saveStaff(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: undefined }
}

export async function reactivateStaff(
  deps: IdentityDeps,
  ctx: TenantContext,
  input: { readonly staffUserId: StaffUserId },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getStaff(ctx, input.staffUserId)
  if (!current) throw new Error(`Staff not found: ${input.staffUserId}`)

  const decided = decideReactivateStaff(dctx(deps, ctx), current)
  if (!decided.ok) return decided
  if (decided.value.events.length === 0) return { ok: true, value: undefined }

  await deps.repo.saveStaff(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: undefined }
}
