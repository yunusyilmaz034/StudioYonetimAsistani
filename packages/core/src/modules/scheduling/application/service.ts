import {
  newCorrelationId,
  newServiceId,
  type Category,
  type DomainError,
  type EventSource,
  type Result,
  type ServiceId,
  type TenantContext,
} from '../../../shared'
import {
  decideCreateService,
  decideDeactivateService,
  decidePublishServicePolicy,
  decideReactivateService,
  decideUpdateService,
  type DecideContext,
} from '../domain/decide'
import type { SchedulingPolicy, Service } from '../domain/types'
import type { SchedulingDeps } from './ports'

const SOURCE: EventSource = 'reception_web'

export function decideContext(deps: SchedulingDeps, ctx: TenantContext): DecideContext {
  return {
    studioId: ctx.studioId,
    actor: ctx.actor,
    now: deps.clock.now(),
    correlationId: newCorrelationId(),
    source: SOURCE,
  }
}

async function loadService(deps: SchedulingDeps, ctx: TenantContext, id: ServiceId): Promise<Service> {
  const s = await deps.repo.getService(ctx, id)
  if (!s) throw new Error(`Service not found: ${id}`)
  return s
}

const POLICY_FIELDS: readonly (keyof SchedulingPolicy)[] = [
  'maxDaysInAdvance',
  'cancellationWindowHours',
  'lateCancellationConsumesCredit',
  'noShowConsumesCredit',
  'attendanceDefaultOutcome',
  'autoResolveAfterMinutes',
]

export interface CreateServiceInput {
  readonly name: string
  readonly category: Category
  readonly policy: SchedulingPolicy
}

export async function createService(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: CreateServiceInput,
): Promise<Result<{ serviceId: ServiceId }, DomainError>> {
  const service: Service = {
    id: newServiceId(),
    studioId: ctx.studioId,
    name: input.name,
    category: input.category,
    policy: input.policy,
    policyVersion: 1,
    active: true,
  }
  await deps.repo.saveService(ctx, service, decideCreateService(decideContext(deps, ctx), service))
  return { ok: true, value: { serviceId: service.id } }
}

export async function updateService(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { serviceId: ServiceId; name: string },
): Promise<Result<void, DomainError>> {
  const current = await loadService(deps, ctx, input.serviceId)
  const next: Service = { ...current, name: input.name }
  await deps.repo.saveService(ctx, next, decideUpdateService(decideContext(deps, ctx), current, next))
  return { ok: true, value: undefined }
}

export async function publishServicePolicy(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { serviceId: ServiceId; policy: SchedulingPolicy },
): Promise<Result<void, DomainError>> {
  const current = await loadService(deps, ctx, input.serviceId)
  const changedFields = POLICY_FIELDS.filter((f) => current.policy[f] !== input.policy[f]).map(String)
  const next: Service = { ...current, policy: input.policy, policyVersion: current.policyVersion + 1 }
  await deps.repo.saveService(
    ctx,
    next,
    decidePublishServicePolicy(decideContext(deps, ctx), next, changedFields),
  )
  return { ok: true, value: undefined }
}

export async function deactivateService(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { serviceId: ServiceId; reason: string },
): Promise<Result<void, DomainError>> {
  const current = await loadService(deps, ctx, input.serviceId)
  const events = decideDeactivateService(decideContext(deps, ctx), current, input.reason)
  if (!events.ok) return events
  await deps.repo.saveService(ctx, { ...current, active: false }, events.value)
  return { ok: true, value: undefined }
}

export async function reactivateService(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { serviceId: ServiceId },
): Promise<Result<void, DomainError>> {
  const current = await loadService(deps, ctx, input.serviceId)
  await deps.repo.saveService(
    ctx,
    { ...current, active: true },
    decideReactivateService(decideContext(deps, ctx), current),
  )
  return { ok: true, value: undefined }
}
