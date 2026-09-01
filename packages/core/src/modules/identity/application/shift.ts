import {
  newCorrelationId,
  newStaffShiftId,
  type BranchId,
  type DomainError,
  type EventSource,
  type Result,
  type StaffUserId,
  type TenantContext,
} from '../../../shared'
import { decideEndShift, decideStartShift } from '../domain/decide'
import type { StaffShift } from '../domain/types'
import type { StaffShiftDeps } from './ports'

// MESAİ — yükle, karar ver, tek işlemde yaz (owner, 2026-09-01).
//
// Owner: *"personel de giriş çıkış yapabilsin pdks gibi değil de en azından saat kaçta girdi çıktı
// görsek yeterli."*
//
// Turnikeden AYRI tutuluyor, bilerek: personel gün içinde defalarca geçiyor ve her geçişi mesai
// saymak "saat kaçta geldi" sorusunu cevapsız bırakırdı. Geçiş sürtünmesiz, vardiya bilinçli.

const SOURCE: EventSource = 'reception_web'

const dctx = (deps: StaffShiftDeps, ctx: TenantContext) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  correlationId: newCorrelationId(),
  source: SOURCE,
})

export async function startShift(
  deps: StaffShiftDeps,
  ctx: TenantContext,
  input: { readonly staffUserId: StaffUserId; readonly branchId: BranchId | null },
): Promise<Result<{ shiftId: string }, DomainError>> {
  const acik = await deps.repo.getOpenShift(ctx, input.staffUserId)
  const id = newStaffShiftId()
  const decided = decideStartShift(dctx(deps, ctx), { ...input, shiftId: id }, acik)
  if (!decided.ok) return decided

  const shift: StaffShift = {
    id,
    staffUserId: input.staffUserId,
    branchId: input.branchId,
    startedAt: deps.clock.now(),
    endedAt: null,
  }
  await deps.repo.saveShift(ctx, shift, decided.value)
  return { ok: true, value: { shiftId: id } }
}

export async function endShift(
  deps: StaffShiftDeps,
  ctx: TenantContext,
  input: { readonly staffUserId: StaffUserId },
): Promise<Result<{ minutes: number }, DomainError>> {
  const acik = await deps.repo.getOpenShift(ctx, input.staffUserId)
  const decided = decideEndShift(dctx(deps, ctx), acik)
  if (!decided.ok) return decided

  // `acik` burada kesin dolu: karar boş vardiyayı zaten reddetti.
  await deps.repo.saveShift(ctx, { ...acik!, endedAt: deps.clock.now() }, decided.value)
  return { ok: true, value: { minutes: decided.value[0]!.payload.minutes } }
}
