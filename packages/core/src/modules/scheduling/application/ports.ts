import type {
  ClassSessionId,
  ClassTemplateId,
  Clock,
  Instant,
  NewEvent,
  RoomId,
  ServiceId,
  StudioConfig,
  TenantContext,
} from '../../../shared'
import type { ClassSession, ClassTemplate, Room, Service } from '../domain/types'

// One repository for the scheduling aggregates. Each save writes the entity + its
// events in one transaction (non-negotiable #1). Ids are domain ids; the repo maps
// them to Firestore document ids (AD-44 pattern). Client writes are forbidden
// (AD-15) — these run only from Server Actions on the Admin SDK.
export interface SchedulingRepository {
  getService(ctx: TenantContext, id: ServiceId): Promise<Service | null>
  saveService(ctx: TenantContext, service: Service, events: readonly NewEvent[]): Promise<void>

  getRoom(ctx: TenantContext, id: RoomId): Promise<Room | null>
  saveRoom(ctx: TenantContext, room: Room, events: readonly NewEvent[]): Promise<void>

  getTemplate(ctx: TenantContext, id: ClassTemplateId): Promise<ClassTemplate | null>
  saveTemplate(ctx: TenantContext, template: ClassTemplate, events: readonly NewEvent[]): Promise<void>

  getSession(ctx: TenantContext, id: ClassSessionId): Promise<ClassSession | null>
  saveSession(ctx: TenantContext, session: ClassSession, events: readonly NewEvent[]): Promise<void>

  // Idempotent generation (AD-50): existing occurrence starts for a template.
  listSessionStartsForTemplate(ctx: TenantContext, templateId: ClassTemplateId): Promise<readonly Instant[]>
  saveSessions(
    ctx: TenantContext,
    sessions: readonly ClassSession[],
    events: readonly NewEvent[],
  ): Promise<void>
}

export interface SchedulingDeps {
  readonly repo: SchedulingRepository
  readonly clock: Clock
  readonly studioConfig: StudioConfig
}
