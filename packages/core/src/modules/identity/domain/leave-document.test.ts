import { describe, expect, it } from 'vitest'

import { instant, type CorrelationId, type StaffUserId, type StudioId } from '../../../shared'
import type { DecideContext } from './decide'
import { canSeeLeaveDocuments, decideAddLeaveDocument, decideRemoveLeaveDocument, LEAVE_DOCUMENT_MAX_PAGES } from './leave-document'
import type { StaffLeave, StaffLeaveDocument } from './types'

// İZNE RAPOR DOSYASI (owner, 2026-09-14 · OR-77, karar 4). Sağlık verisi: bu testlerin asıl konusu
// kimin EKLEYEMEYECEĞİ ve GÖREMEYECEĞİ.

const NOW = instant(1_800_000_000_000)
const HOCA = 'usr_hoca' as StaffUserId

const ctxOf = (type: 'owner' | 'receptionist' | 'trainer', id: string): DecideContext => ({
  studioId: 'std_1' as StudioId,
  actor: { type, id: id as StaffUserId },
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
})
const SAHIBI = ctxOf('trainer', HOCA)
const OWNER = ctxOf('owner', 'usr_owner')
const RESEPSIYON = ctxOf('receptionist', 'usr_rec')
const BASKA_HOCA = ctxOf('trainer', 'usr_baska')

const izin = (over: Partial<StaffLeave> = {}): StaffLeave => ({
  id: 'lv_1',
  staffUserId: HOCA,
  kind: 'rapor',
  from: NOW,
  to: instant(NOW + 86_400_000),
  note: '',
  status: 'pending',
  requestedAt: NOW,
  decidedBy: null,
  decidedAt: null,
  decisionReason: '',
  ...over,
})
const belge = (sayfa = 1, over: Partial<StaffLeaveDocument> = {}): StaffLeaveDocument => ({
  id: 'lvd_1',
  leaveId: 'lv_1',
  staffUserId: HOCA,
  pages: Array.from({ length: sayfa }, (_, i) => `studios/std_1/staffLeaves/lv_1/documents/${i}.jpg`),
  uploadedAt: NOW,
  uploadedBy: HOCA,
  ...over,
})

describe('kim görebilir', () => {
  it('izin sahibi ve owner görür; resepsiyon ve başka hoca GÖREMEZ', () => {
    expect(canSeeLeaveDocuments(SAHIBI.actor, izin())).toBe(true)
    expect(canSeeLeaveDocuments(OWNER.actor, izin())).toBe(true)
    expect(canSeeLeaveDocuments(RESEPSIYON.actor, izin())).toBe(false)
    expect(canSeeLeaveDocuments(BASKA_HOCA.actor, izin())).toBe(false)
  })
})

describe('rapor eklemek', () => {
  it('izin sahibi bekleyen izne ekler; olayda yol yok', () => {
    const r = decideAddLeaveDocument(SAHIBI, izin(), belge(2))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value[0]?.type).toBe('staff.leave_document_added')
    expect(r.value[0]?.payload).toEqual({ leaveId: 'lv_1', staffUserId: HOCA, documentId: 'lvd_1', pageCount: 2 })
    expect(JSON.stringify(r.value[0])).not.toContain('studios/')
  })

  it('owner, telefonla haber veren adına ONAYLI izne ekleyebilir — rapor çoğu zaman sonradan gelir', () => {
    expect(decideAddLeaveDocument(OWNER, izin({ status: 'approved' }), belge()).ok).toBe(true)
  })

  it('REDDEDER: resepsiyon ve başka hoca', () => {
    expect(decideAddLeaveDocument(RESEPSIYON, izin(), belge())).toEqual({ ok: false, error: { code: 'leave_document_forbidden' } })
    expect(decideAddLeaveDocument(BASKA_HOCA, izin(), belge())).toEqual({ ok: false, error: { code: 'leave_document_forbidden' } })
  })

  it('REDDEDER: rapor olmayan izin', () => {
    expect(decideAddLeaveDocument(SAHIBI, izin({ kind: 'izin' }), belge())).toEqual({ ok: false, error: { code: 'leave_document_rapor_only' } })
  })

  it('REDDEDER: geri çekilmiş ya da reddedilmiş izin', () => {
    expect(decideAddLeaveDocument(SAHIBI, izin({ status: 'cancelled' }), belge())).toEqual({ ok: false, error: { code: 'operation_not_applicable' } })
    expect(decideAddLeaveDocument(SAHIBI, izin({ status: 'rejected' }), belge())).toEqual({ ok: false, error: { code: 'operation_not_applicable' } })
  })

  it('REDDEDER: sayfasız; sınır — on sayfa geçer, on bir sayfa geçmez', () => {
    expect(decideAddLeaveDocument(SAHIBI, izin(), belge(0))).toEqual({ ok: false, error: { code: 'document_empty' } })
    expect(decideAddLeaveDocument(SAHIBI, izin(), belge(LEAVE_DOCUMENT_MAX_PAGES)).ok).toBe(true)
    expect(decideAddLeaveDocument(SAHIBI, izin(), belge(LEAVE_DOCUMENT_MAX_PAGES + 1))).toEqual({
      ok: false,
      error: { code: 'leave_document_too_many' },
    })
  })
})

describe('rapor kaldırmak', () => {
  it('sebeple kaldırılır', () => {
    const r = decideRemoveLeaveDocument(SAHIBI, izin(), belge(), 'Yanlış fotoğraf')
    expect(r.ok && r.value[0]?.payload).toEqual({ leaveId: 'lv_1', staffUserId: HOCA, documentId: 'lvd_1', reason: 'Yanlış fotoğraf' })
  })

  it('REDDEDER: sebepsiz — kaldırmak bir düzeltmedir (#9)', () => {
    expect(decideRemoveLeaveDocument(SAHIBI, izin(), belge(), '  ')).toEqual({ ok: false, error: { code: 'reason_required' } })
  })

  it('REDDEDER: resepsiyon; ve başka bir izne ait belge', () => {
    expect(decideRemoveLeaveDocument(RESEPSIYON, izin(), belge(), 'x')).toEqual({ ok: false, error: { code: 'leave_document_forbidden' } })
    expect(decideRemoveLeaveDocument(OWNER, izin(), belge(1, { leaveId: 'lv_2' }), 'x')).toEqual({
      ok: false,
      error: { code: 'operation_not_applicable' },
    })
  })
})
