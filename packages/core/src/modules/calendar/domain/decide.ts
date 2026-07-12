import {
  err,
  ok,
  type ActorRef,
  type AggregateKind,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type NewEvent,
  type Result,
  type StudioId,
} from '../../../shared'
import {
  STUDIO_CALENDAR_DAY_MARKED,
  STUDIO_CALENDAR_DAY_REMOVED,
  STUDIO_CALENDAR_DAY_UPDATED,
  STUDIO_CALENDAR_IMPORTED,
} from '../events'
import type { StudioCalendarDay } from './types'

export interface DecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly now: Instant
  readonly correlationId: CorrelationId
  readonly source: EventSource
}

function base(ctx: DecideContext, id: string) {
  return {
    studioId: ctx.studioId,
    branchId: null,
    version: 1,
    occurredAt: ctx.now,
    actor: ctx.actor,
    source: ctx.source,
    subject: { kind: 'policy' as AggregateKind, id }, // the reserved kind closest to "studio-level rule"
    related: {},
    policyRef: null,
    commandId: null,
    causationId: null,
    correlationId: ctx.correlationId,
  }
}

// A day whose range is inverted is not a day; it is a typo. Refuse it here rather than let it
// silently match nothing (or, worse, everything).
function validRange(d: StudioCalendarDay): DomainError | null {
  if (d.dateTo < d.dateFrom) return { code: 'invalid_time_range' }
  if (d.timeFrom !== null && d.timeTo !== null && d.timeTo <= d.timeFrom) {
    return { code: 'invalid_time_range' }
  }
  if (d.title.trim().length === 0) return { code: 'reason_required' }
  return null
}

export function decideMarkDay(ctx: DecideContext, day: StudioCalendarDay): Result<NewEvent[], DomainError> {
  const bad = validRange(day)
  if (bad) return err(bad)
  return ok([
    {
      ...base(ctx, day.id),
      type: STUDIO_CALENDAR_DAY_MARKED,
      payload: {
        dateFrom: day.dateFrom,
        dateTo: day.dateTo,
        type: day.type,
        source: day.source,
      },
    },
  ])
}

export function decideUpdateDay(
  ctx: DecideContext,
  current: StudioCalendarDay,
  next: StudioCalendarDay,
): Result<NewEvent[], DomainError> {
  const bad = validRange(next)
  if (bad) return err(bad)
  const changedFields: string[] = []
  if (current.dateFrom !== next.dateFrom) changedFields.push('dateFrom')
  if (current.dateTo !== next.dateTo) changedFields.push('dateTo')
  if (current.timeFrom !== next.timeFrom) changedFields.push('timeFrom')
  if (current.timeTo !== next.timeTo) changedFields.push('timeTo')
  if (current.type !== next.type) changedFields.push('type')
  if (current.title !== next.title) changedFields.push('title')
  if (current.note !== next.note) changedFields.push('note')
  if (changedFields.length === 0) return ok([]) // idempotent no-op
  return ok([
    { ...base(ctx, next.id), type: STUDIO_CALENDAR_DAY_UPDATED, payload: { changedFields } },
  ])
}

export function decideRemoveDay(ctx: DecideContext, day: StudioCalendarDay): NewEvent[] {
  return [
    {
      ...base(ctx, day.id),
      type: STUDIO_CALENDAR_DAY_REMOVED,
      payload: { dateFrom: day.dateFrom, dateTo: day.dateTo, type: day.type },
    },
  ]
}

// The provenance of an import run. The days themselves are state; this is the fact that a human
// asked a named provider for a year and got N days back.
export function decideImported(
  ctx: DecideContext,
  provider: string,
  year: number,
  counts: { imported: number; updated: number; skipped: number },
): NewEvent[] {
  return [
    {
      ...base(ctx, `${provider}:${year}`),
      type: STUDIO_CALENDAR_IMPORTED,
      payload: {
        provider,
        year,
        daysImported: counts.imported,
        daysUpdated: counts.updated,
        daysSkipped: counts.skipped,
      },
    },
  ]
}
