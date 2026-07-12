import type { Clock, LocalDate, NewEvent, TenantContext } from '../../../shared'
import type { StudioCalendarDay } from '../domain/types'

export interface CalendarRepository {
  // The whole studio's calendar for a range. Small by nature (a year is a few dozen rows), so
  // the screens and the planners read it whole and ask `lookup.ts` the questions.
  listDays(ctx: TenantContext, from: LocalDate, to: LocalDate): Promise<readonly StudioCalendarDay[]>
  getDay(ctx: TenantContext, id: string): Promise<StudioCalendarDay | null>
  findByProviderRef(
    ctx: TenantContext,
    provider: string,
    externalId: string,
  ): Promise<StudioCalendarDay | null>

  saveDay(ctx: TenantContext, day: StudioCalendarDay, events: readonly NewEvent[]): Promise<void>
  removeDay(ctx: TenantContext, id: string, events: readonly NewEvent[]): Promise<void>
  // An import writes many days + ONE provenance event. Batched, not transactional across the
  // whole run: a calendar row is not a credit, and a half-finished import is re-runnable
  // (upsert by providerRef) rather than dangerous.
  saveImported(
    ctx: TenantContext,
    days: readonly StudioCalendarDay[],
    events: readonly NewEvent[],
  ): Promise<void>
}

export interface CalendarDeps {
  readonly repo: CalendarRepository
  readonly clock: Clock
}
