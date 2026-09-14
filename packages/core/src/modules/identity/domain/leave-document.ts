import { err, ok, type ActorRef, type DomainError, type NewEvent, type Result } from '../../../shared'
import { STAFF_LEAVE_DOCUMENT_ADDED, STAFF_LEAVE_DOCUMENT_REMOVED } from '../events'
import type { DecideContext } from './decide'
import type { StaffLeave, StaffLeaveDocument } from './types'

// ── İZNE RAPOR DOSYASI — kurallar (owner, 2026-09-14 · OR-77, karar 4) ─────────────────────
//
// Saf. Dosya bu fonksiyon çağrılmadan önce özel Storage yoluna yüklenmiştir; burada verilen karar yalnızca
// "bu kayıt tutulabilir mi". Kurallar:
//   · Yalnızca İZİN SAHİBİ ya da OWNER ekler/kaldırır (owner, telefonla haber veren adına ekleyebilir).
//   · Yalnızca "rapor" türündeki izne.
//   · Geri çekilmiş ya da reddedilmiş izne eklenmez; bekleyen ve onaylı izne eklenir — rapor çoğu zaman
//     sonradan alınır.
//   · 1–10 sayfa.
//   · Kaldırmanın sebebi zorunlu (#9).

/** Bir rapora en fazla kaç sayfa. On sayfalık bir rapor yok; sınır, yanlışlıkla seçilmiş bir galeriyi durdurur. */
export const LEAVE_DOCUMENT_MAX_PAGES = 10

const sahibi = (actor: ActorRef, leave: StaffLeave) => String(actor.id) === String(leave.staffUserId)
const owner = (actor: ActorRef) => actor.type === 'owner' || actor.type === 'platform_admin'

/**
 * Raporu kim GÖREBİLİR: izin sahibi ve owner. Resepsiyon ve diğer hocalar göremez (OR-77, karar 4).
 * Okuma yolu (Server Action) bunu sormadan tek bir imzalı link üretmez.
 */
export function canSeeLeaveDocuments(actor: ActorRef, leave: StaffLeave): boolean {
  return sahibi(actor, leave) || owner(actor)
}

const base = (ctx: DecideContext, leave: StaffLeave) => ({
  studioId: ctx.studioId,
  branchId: null,
  version: 1,
  occurredAt: ctx.now,
  actor: ctx.actor,
  source: ctx.source,
  subject: { kind: 'staff', id: String(leave.staffUserId) } as const,
  related: {},
  policyRef: null,
  commandId: null,
  causationId: null,
  correlationId: ctx.correlationId,
})

export function decideAddLeaveDocument(
  ctx: DecideContext,
  leave: StaffLeave,
  document: StaffLeaveDocument,
): Result<NewEvent[], DomainError> {
  if (!canSeeLeaveDocuments(ctx.actor, leave)) return err({ code: 'leave_document_forbidden' })
  if (leave.kind !== 'rapor') return err({ code: 'leave_document_rapor_only' })
  if (leave.status === 'cancelled' || leave.status === 'rejected') return err({ code: 'operation_not_applicable' })
  if (document.pages.length === 0) return err({ code: 'document_empty' })
  if (document.pages.length > LEAVE_DOCUMENT_MAX_PAGES) return err({ code: 'leave_document_too_many' })
  return ok([
    {
      ...base(ctx, leave),
      type: STAFF_LEAVE_DOCUMENT_ADDED,
      // Yol YOK: olaya giren bir yol silinemez, dosya silinse bile "raporu buradaydı" bilgisi kalırdı.
      payload: { leaveId: leave.id, staffUserId: String(leave.staffUserId), documentId: document.id, pageCount: document.pages.length },
    },
  ])
}

export function decideRemoveLeaveDocument(
  ctx: DecideContext,
  leave: StaffLeave,
  document: StaffLeaveDocument,
  reason: string,
): Result<NewEvent[], DomainError> {
  if (!canSeeLeaveDocuments(ctx.actor, leave)) return err({ code: 'leave_document_forbidden' })
  if (document.leaveId !== leave.id) return err({ code: 'operation_not_applicable' })
  const sebep = reason.trim()
  if (sebep === '') return err({ code: 'reason_required' })
  return ok([
    {
      ...base(ctx, leave),
      type: STAFF_LEAVE_DOCUMENT_REMOVED,
      payload: { leaveId: leave.id, staffUserId: String(leave.staffUserId), documentId: document.id, reason: sebep },
    },
  ])
}
