import {
  newCorrelationId,
  newStaffLeaveDocumentId,
  newStaffLeaveId,
  ok,
  type DomainError,
  type EventSource,
  type Result,
  type StaffUserId,
  type TenantContext,
} from '../../../shared'
import { decideCancelLeave, decideDecideLeave, decideRequestLeave } from '../domain/decide'
import { canSeeLeaveDocuments, decideAddLeaveDocument, decideRemoveLeaveDocument } from '../domain/leave-document'
import type { StaffLeave, StaffLeaveDocument } from '../domain/types'
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

// ── İZNE RAPOR DOSYASI (owner, 2026-09-14 · OR-77, karar 4) ────────────────────────────────
//
// Dosya çoktan özel Storage yoluna yüklenmiştir; burası kaydı keser, kararı verir, kaydı ve olayı tek
// işlemde yazar. Storage'a dokunmaz — kova çağıranın (Server Action) sorumluluğunda.

export async function addLeaveDocument(
  deps: StaffLeaveDeps,
  ctx: TenantContext,
  input: { readonly leaveId: string; readonly pages: readonly string[] },
): Promise<Result<{ documentId: string }, DomainError>> {
  const leave = await deps.repo.getLeave(ctx, input.leaveId)
  if (!leave) return { ok: false, error: { code: 'operation_not_applicable' } }
  const document: StaffLeaveDocument = {
    id: newStaffLeaveDocumentId(),
    leaveId: leave.id,
    staffUserId: leave.staffUserId,
    pages: input.pages,
    uploadedAt: deps.clock.now(),
    uploadedBy: ctx.actor.id as StaffUserId,
  }
  const decided = decideAddLeaveDocument(dctx(deps, ctx), leave, document)
  if (!decided.ok) return decided
  await deps.repo.saveLeaveDocument(ctx, document, decided.value)
  return ok({ documentId: document.id })
}

/** Kaldırılan belgenin Storage yollarını döndürür; nesneleri silmek çağıranın işi. */
export async function removeLeaveDocument(
  deps: StaffLeaveDeps,
  ctx: TenantContext,
  input: { readonly leaveId: string; readonly documentId: string; readonly reason: string },
): Promise<Result<{ pages: readonly string[] }, DomainError>> {
  const [leave, document] = await Promise.all([
    deps.repo.getLeave(ctx, input.leaveId),
    deps.repo.getLeaveDocument(ctx, input.leaveId, input.documentId),
  ])
  if (!leave) return { ok: false, error: { code: 'operation_not_applicable' } }
  if (!document) return { ok: false, error: { code: 'document_not_found' } }
  const decided = decideRemoveLeaveDocument(dctx(deps, ctx), leave, document, input.reason)
  if (!decided.ok) return decided
  await deps.repo.deleteLeaveDocument(ctx, leave.id, document.id, decided.value)
  return ok({ pages: document.pages })
}

/**
 * Görme yetkisi yoksa BOŞ döner. "Rapor yok" ile "göremezsin" aynı görünür, bilerek: bir sağlık raporunun
 * VARLIĞI da bir bilgidir ve resepsiyonun ekranına sızmamalı.
 */
export async function listLeaveDocuments(
  deps: StaffLeaveDeps,
  ctx: TenantContext,
  leave: StaffLeave,
): Promise<readonly StaffLeaveDocument[]> {
  if (!canSeeLeaveDocuments(ctx.actor, leave)) return []
  return deps.repo.listLeaveDocuments(ctx, leave.id)
}
