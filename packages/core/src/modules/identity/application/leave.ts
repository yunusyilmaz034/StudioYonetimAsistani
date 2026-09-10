import {
  newCorrelationId,
  newStaffLeaveId,
  ok,
  type DomainError,
  type EventSource,
  type Result,
  type StaffUserId,
  type TenantContext,
} from '../../../shared'
import { decideCancelLeave, decideDecideLeave, decideRequestLeave } from '../domain/decide'
import type { StaffLeave } from '../domain/types'
import type { LeaveKind } from '../events'
import type { StaffLeaveDeps } from './ports'

const SOURCE: EventSource = 'reception_web'

const dctx = (deps: StaffLeaveDeps, ctx: TenantContext) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  correlationId: newCorrelationId(),
  source: SOURCE,
})

// ── İZİN / YOKLUK — use-case'ler (owner onayı, 2026-09-11) ──────────────────────────────────
//
// Üç işlem, ve hepsi aynı şekli izliyor: yükle → karar ver (saf) → tek işlemde yaz.
//
// ONAYDA TAKVİM OKUNUYOR. `affectedSessions` portu, o aralıkta bu eğitmene atanmış ders sayısını
// döndürüyor ve sayı ONAY OLAYINA yazılıyor. Sebebi tek bir cümle: altı ay sonra "kaç dersin
// sahipsiz kalacağını biliyor muydun?" diye sorulduğunda, cevabı olan tek kayıt o.

export async function requestStaffLeave(
  deps: StaffLeaveDeps,
  ctx: TenantContext,
  input: { staffUserId: StaffUserId; kind: LeaveKind; from: number; to: number; note: string },
): Promise<Result<StaffLeave, DomainError>> {
  const mevcut = await deps.repo.listLiveLeavesOf(ctx, input.staffUserId)
  const decided = decideRequestLeave(
    dctx(deps, ctx),
    {
      leaveId: newStaffLeaveId(),
      staffUserId: input.staffUserId,
      kind: input.kind,
      from: input.from as never,
      to: input.to as never,
      note: input.note,
    },
    mevcut,
  )
  if (!decided.ok) return decided
  await deps.repo.saveLeave(ctx, decided.value.next, decided.value.events)
  return ok(decided.value.next)
}

export async function decideStaffLeave(
  deps: StaffLeaveDeps,
  ctx: TenantContext,
  input: { leaveId: string; approve: boolean; reason?: string },
): Promise<Result<StaffLeave, DomainError>> {
  const leave = await deps.repo.getLeave(ctx, input.leaveId)
  if (!leave) return { ok: false, error: { code: 'operation_not_applicable' } }

  // Takvim YALNIZCA onayda okunuyor: reddedilen bir izin hiçbir dersi etkilemiyor, ve okumadığın
  // bir şey için ödeme yapmamak, ölçülmemiş bir hızlandırma değil, hiç yapılmamış bir iştir.
  const karar = input.approve
    ? { approve: true as const, affectedSessions: await deps.affectedSessions(ctx, leave.staffUserId, leave.from, leave.to) }
    : { approve: false as const, reason: input.reason ?? '' }

  const decided = decideDecideLeave(dctx(deps, ctx), leave, karar)
  if (!decided.ok) return decided
  await deps.repo.saveLeave(ctx, decided.value.next, decided.value.events)
  return ok(decided.value.next)
}

export async function cancelStaffLeave(
  deps: StaffLeaveDeps,
  ctx: TenantContext,
  leaveId: string,
): Promise<Result<StaffLeave, DomainError>> {
  const leave = await deps.repo.getLeave(ctx, leaveId)
  if (!leave) return { ok: false, error: { code: 'operation_not_applicable' } }
  const decided = decideCancelLeave(dctx(deps, ctx), leave)
  if (!decided.ok) return decided
  await deps.repo.saveLeave(ctx, decided.value.next, decided.value.events)
  return ok(decided.value.next)
}
