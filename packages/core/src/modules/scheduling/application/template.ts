import {
  newClassTemplateId,
  type BranchId,
  type ClassTemplateId,
  type DomainError,
  type LocalDate,
  type Result,
  type RoomId,
  type ServiceId,
  type StaffUserId,
  type TenantContext,
} from '../../../shared'
import { decideCreateTemplate, decideDeactivateTemplate } from '../domain/decide'
import type { ClassTemplate, Weekday } from '../domain/types'
import { decideContext } from './service'
import type { SchedulingDeps } from './ports'

export interface CreateTemplateInput {
  readonly serviceId: ServiceId
  readonly branchId: BranchId
  readonly roomId: RoomId | null
  readonly trainerId: StaffUserId | null
  readonly dayOfWeek: Weekday
  readonly startTime: string
  readonly durationMinutes: number
  readonly capacity: number
  readonly validFrom: string
  readonly validUntil: string
}

export async function createTemplate(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: CreateTemplateInput,
): Promise<Result<{ templateId: ClassTemplateId }, DomainError>> {
  const template: ClassTemplate = {
    id: newClassTemplateId(),
    studioId: ctx.studioId,
    branchId: input.branchId,
    serviceId: input.serviceId,
    roomId: input.roomId,
    trainerId: input.trainerId,
    dayOfWeek: input.dayOfWeek,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    capacity: input.capacity,
    validFrom: input.validFrom as LocalDate,
    validUntil: input.validUntil as LocalDate,
    active: true,
  }
  await deps.repo.saveTemplate(ctx, template, decideCreateTemplate(decideContext(deps, ctx), template))
  return { ok: true, value: { templateId: template.id } }
}

export async function deactivateTemplate(
  deps: SchedulingDeps,
  ctx: TenantContext,
  input: { templateId: ClassTemplateId; reason: string },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getTemplate(ctx, input.templateId)
  if (!current) throw new Error(`Template not found: ${input.templateId}`)
  const events = decideDeactivateTemplate(decideContext(deps, ctx), current, input.reason)
  if (!events.ok) return events
  await deps.repo.saveTemplate(ctx, { ...current, active: false }, events.value)
  return { ok: true, value: undefined }
}
