import {
  DEFAULT_STUDIO_CONFIG,
  newCorrelationId,
  newStaffShiftId,
  type BranchId,
  type DomainError,
  type EventSource,
  type Result,
  type StaffUserId,
  type TenantContext,
} from '../../../shared'
import { decideCloseShiftAtLastCrossing, decideStaffCrossing, type StaffCrossingDecision } from '../domain/decide'
import type { StaffShiftDeps } from './ports'

// TURNİKEDEN MESAİ — yükle, karar ver, yaz (owner, 2026-09-13 · OR-74).
//
// İKİ AŞAMA, bilerek: `prepare` yalnızca okur, `commit` yazar. Arada turnike kodu harcanıyor
// (`checkin` modülü) ve sıra üye geçişindekiyle aynı: karar reddederse kod harcanmaz, kol dönmez.

const dctx = (deps: StaffShiftDeps, ctx: TenantContext, source: EventSource) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  correlationId: newCorrelationId(),
  source,
})

export interface StaffCrossingDeps extends StaffShiftDeps {
  /** Stüdyonun UTC farkı — "günün ilk geçişi"ndeki GÜN. Verilmezse varsayılan stüdyo ayarı. */
  readonly utcOffsetMinutes?: number
}

export async function prepareStaffCrossing(
  deps: StaffCrossingDeps,
  ctx: TenantContext,
  input: {
    readonly staffUserId: StaffUserId
    readonly deviceId: string
    readonly branchId: BranchId
    readonly direction: 'in' | 'out' | null
  },
): Promise<Result<StaffCrossingDecision, DomainError>> {
  const acik = await deps.repo.getOpenShift(ctx, input.staffUserId)
  return decideStaffCrossing(
    dctx(deps, ctx, 'reception_web'),
    {
      ...input,
      newShiftId: newStaffShiftId(),
      utcOffsetMinutes: deps.utcOffsetMinutes ?? DEFAULT_STUDIO_CONFIG.utcOffsetMinutes,
    },
    acik,
  )
}

export async function commitStaffCrossing(
  deps: StaffShiftDeps,
  ctx: TenantContext,
  decision: StaffCrossingDecision,
): Promise<void> {
  // Vardiya belge(ler)i ve olaylar TEK işlemde (#1).
  await deps.repo.saveShifts(ctx, decision.shifts, decision.events)
}

/**
 * Gece işi (23:00): her açık vardiyayı son turnike geçişine kapatır.
 *
 * Geçişi olmayan vardiyalar ATLANIR — elle açılmışlar ve bitişleri gözlenmedi. Sayılar döndürülüyor
 * ki log "kaç vardiya kapandı, kaçına dokunulmadı" desin: sessiz bir atlama, bozuk bir iş gibi görünür.
 */
export async function closeShiftsAtLastCrossing(
  deps: StaffShiftDeps,
  ctx: TenantContext,
): Promise<{ closed: number; skipped: number }> {
  const acik = await deps.repo.listOpenShifts(ctx)
  let closed = 0
  let skipped = 0
  for (const shift of acik) {
    const decided = decideCloseShiftAtLastCrossing(dctx(deps, ctx, 'system_sweep'), shift)
    if (!decided.ok || decided.value === null) {
      skipped++
      continue
    }
    await deps.repo.saveShift(ctx, decided.value.shift, decided.value.events)
    closed++
  }
  return { closed, skipped }
}
