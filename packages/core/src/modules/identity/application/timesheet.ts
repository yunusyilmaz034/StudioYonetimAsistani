import { newCorrelationId, type DomainError, type EventSource, type Result, type StaffUserId, type TenantContext } from '../../../shared'
import { decideGenerateTimesheet, decideSignTimesheet } from '../domain/timesheet'
import type { WeeklyTimesheet } from '../domain/types'
import type { StaffTimesheetDeps } from './ports'

// HAFTALIK ÇİZELGE — üret, imzayı işaretle (owner, 2026-10-07).
//
// Snapshot'ı ÇAĞIRAN hazırlar (çalışma süresi aritmetiği `domain/working-time.ts`te, plan ve mola
// verisi okuma katmanında). Buradaki iş yalnızca sürümü vermek ve tek işlemde yazmak.

const SOURCE: EventSource = 'reception_web'

const dctx = (deps: StaffTimesheetDeps, ctx: TenantContext) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  correlationId: newCorrelationId(),
  source: SOURCE,
})

export async function generateTimesheet(
  deps: StaffTimesheetDeps,
  ctx: TenantContext,
  snapshot: Omit<WeeklyTimesheet, 'version' | 'generatedAt' | 'generatedBy' | 'signedAt' | 'signedBy'>,
): Promise<Result<{ version: number }, DomainError>> {
  const mevcut = await deps.repo.getLatestTimesheet(ctx, snapshot.weekStart, snapshot.staffUserId)
  const decided = decideGenerateTimesheet(dctx(deps, ctx), snapshot, mevcut)
  if (!decided.ok) return decided
  await deps.repo.saveTimesheet(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: { version: decided.value.next.version } }
}

export async function signTimesheet(
  deps: StaffTimesheetDeps,
  ctx: TenantContext,
  input: { readonly weekStart: string; readonly staffUserId: StaffUserId },
): Promise<Result<{ version: number }, DomainError>> {
  const sheet = await deps.repo.getLatestTimesheet(ctx, input.weekStart, input.staffUserId)
  if (!sheet) return { ok: false, error: { code: 'timesheet_unchanged' } }
  const decided = decideSignTimesheet(dctx(deps, ctx), sheet)
  if (!decided.ok) return decided
  await deps.repo.saveTimesheet(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: { version: sheet.version } }
}
