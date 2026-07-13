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
import type { ClassSession, ClassTemplate, Room, Service, StudioSettings } from '../domain/types'
import type { StudioHours } from '../domain/working-hours'

// One repository for the scheduling aggregates. Each save writes the entity + its
// events in one transaction (non-negotiable #1). Ids are domain ids; the repo maps
// them to Firestore document ids (AD-44 pattern). Client writes are forbidden
// (AD-15) — these run only from Server Actions on the Admin SDK.
export interface SchedulingRepository {
  // D14 — studio-level defaults (level 3 of the cancellation-window chain).
  getStudioSettings(ctx: TenantContext): Promise<StudioSettings | null>
  saveStudioSettings(
    ctx: TenantContext,
    settings: StudioSettings,
    events: readonly NewEvent[],
  ): Promise<void>
  getService(ctx: TenantContext, id: ServiceId): Promise<Service | null>
  saveService(ctx: TenantContext, service: Service, events: readonly NewEvent[]): Promise<void>
  listServices(ctx: TenantContext): Promise<readonly Service[]>

  getRoom(ctx: TenantContext, id: RoomId): Promise<Room | null>
  saveRoom(ctx: TenantContext, room: Room, events: readonly NewEvent[]): Promise<void>
  listRooms(ctx: TenantContext): Promise<readonly Room[]>

  getTemplate(ctx: TenantContext, id: ClassTemplateId): Promise<ClassTemplate | null>
  saveTemplate(ctx: TenantContext, template: ClassTemplate, events: readonly NewEvent[]): Promise<void>
  listTemplates(ctx: TenantContext): Promise<readonly ClassTemplate[]>

  getSession(ctx: TenantContext, id: ClassSessionId): Promise<ClassSession | null>
  saveSession(ctx: TenantContext, session: ClassSession, events: readonly NewEvent[]): Promise<void>

  // Idempotent generation (AD-50): existing occurrence starts for a template.
  listSessionStartsForTemplate(ctx: TenantContext, templateId: ClassTemplateId): Promise<readonly Instant[]>
  // The day's sessions for the attendance/schedule read (startsAt in [from, to)).
  listSessionsForDay(
    ctx: TenantContext,
    fromInclusive: Instant,
    toExclusive: Instant,
  ): Promise<readonly ClassSession[]>
  saveSessions(
    ctx: TenantContext,
    sessions: readonly ClassSession[],
    events: readonly NewEvent[],
  ): Promise<void>
}

/**
 * AG-1 — the studio's opening hours and the calendar's exceptions, resolved together.
 *
 * REQUIRED on every deps object that can create a class or take a seat. An optional guard is a guard
 * that is one refactor away from being forgotten — and this one was already forgotten once: the hours
 * were stored from S2 and enforced nowhere, so the form warned and the engine shrugged.
 */
export interface StudioHoursPort {
  getStudioHours(ctx: TenantContext): Promise<StudioHours>
}

export interface SchedulingDeps {
  readonly repo: SchedulingRepository
  readonly clock: Clock
  readonly studioConfig: StudioConfig
  readonly hours: StudioHoursPort
}
