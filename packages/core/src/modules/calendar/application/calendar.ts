import {
  newCorrelationId,
  type BranchId,
  type DomainError,
  type EventSource,
  type LocalDate,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideImported, decideMarkDay, decideRemoveDay, decideUpdateDay } from '../domain/decide'
import type {
  CalendarDayType,
  HolidayProvider,
  StudioCalendarDay,
} from '../domain/types'
import type { CalendarDeps } from './ports'

const SOURCE: EventSource = 'reception_web'
const dctx = (deps: CalendarDeps, ctx: TenantContext, correlationId = newCorrelationId()) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  correlationId,
  source: SOURCE,
})

// The id is derived from the range + type so that the same manual day, marked twice, is the same
// document — not two rows that disagree with each other.
const dayId = (from: LocalDate, to: LocalDate, type: string, suffix = ''): string =>
  `cal_${from}_${to}_${type}${suffix}`.replace(/[^A-Za-z0-9_-]/g, '_')

export interface MarkDayInput {
  readonly dateFrom: LocalDate
  readonly dateTo: LocalDate
  readonly timeFrom?: string | null
  readonly timeTo?: string | null
  readonly type: CalendarDayType
  readonly title: string
  readonly note?: string | null
  readonly branchIds?: readonly BranchId[] | null
}

export async function markCalendarDay(
  deps: CalendarDeps,
  ctx: TenantContext,
  input: MarkDayInput,
): Promise<Result<{ id: string }, DomainError>> {
  const id = dayId(input.dateFrom, input.dateTo, input.type)
  const existing = await deps.repo.getDay(ctx, id)

  const day: StudioCalendarDay = {
    id,
    studioId: ctx.studioId,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    timeFrom: input.timeFrom ?? null,
    timeTo: input.timeTo ?? null,
    type: input.type,
    title: input.title,
    note: input.note ?? null,
    branchIds: input.branchIds ?? null,
    source: 'manual',
    providerRef: null,
    createdAt: existing?.createdAt ?? deps.clock.now(),
  }

  const events = existing
    ? decideUpdateDay(dctx(deps, ctx), existing, day)
    : decideMarkDay(dctx(deps, ctx), day)
  if (!events.ok) return events
  if (events.value.length === 0) return { ok: true, value: { id } } // nothing changed

  await deps.repo.saveDay(ctx, day, events.value)
  return { ok: true, value: { id } }
}

export async function removeCalendarDay(
  deps: CalendarDeps,
  ctx: TenantContext,
  id: string,
): Promise<Result<void, DomainError>> {
  const day = await deps.repo.getDay(ctx, id)
  if (!day) return { ok: true, value: undefined } // idempotent
  await deps.repo.removeDay(ctx, id, decideRemoveDay(dctx(deps, ctx), day))
  return { ok: true, value: undefined }
}

export interface ImportSummary {
  readonly imported: number
  readonly updated: number
  readonly skipped: number
}

// D23.1 — import official holidays from a PROVIDER (a port), snapshot them into our calendar.
//
// Three rules that make this safe to run twice, or next year, or after the provider changes its
// mind:
//   • **Upsert by providerRef** — the same holiday is the same row.
//   • **Never touch a MANUAL day.** The owner's edits outrank the source; if she deleted or
//     re-typed a day, an import must not silently restore it. Those are `skipped`.
//   • **Never delete.** An import proposes; it does not prune. A holiday that vanished from the
//     source (because the source changed) is still a day the studio may have planned around.
export async function importHolidays(
  deps: CalendarDeps,
  ctx: TenantContext,
  provider: HolidayProvider,
  input: { country: string; year: number },
): Promise<Result<ImportSummary, DomainError>> {
  const holidays = await provider.listHolidays(input.country, input.year)
  const now = deps.clock.now()

  const toSave: StudioCalendarDay[] = []
  let imported = 0
  let updated = 0
  let skipped = 0

  for (const h of holidays) {
    const existing = await deps.repo.findByProviderRef(ctx, provider.name, h.externalId)

    if (existing && existing.source === 'manual') {
      skipped++ // the owner has taken ownership of this day; the source does not get it back
      continue
    }

    const day: StudioCalendarDay = {
      id: existing?.id ?? dayId(h.dateFrom, h.dateTo, h.type, `_${provider.name}_${h.externalId}`),
      studioId: ctx.studioId,
      dateFrom: h.dateFrom,
      dateTo: h.dateTo,
      timeFrom: null,
      timeTo: null,
      type: h.type,
      title: h.title,
      note: null,
      branchIds: null,
      source: 'provider',
      providerRef: { provider: provider.name, externalId: h.externalId, importedAt: now },
      createdAt: existing?.createdAt ?? now,
    }
    toSave.push(day)
    if (existing) updated++
    else imported++
  }

  const counts = { imported, updated, skipped }
  await deps.repo.saveImported(
    ctx,
    toSave,
    decideImported(dctx(deps, ctx), provider.name, input.year, counts),
  )
  return { ok: true, value: counts }
}
