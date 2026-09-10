import { describe, expect, it } from 'vitest'

import { instant, type CorrelationId, type StaffUserId, type StudioId } from '../../../shared'
import { decideCancelLeave, decideDecideLeave, decideRequestLeave, type DecideContext } from './decide'
import type { StaffLeave } from './types'

// İZİN: KURALLAR AZ, VE HEPSİ BURADA (owner onayı, 2026-09-11).
//
// Bakiye aritmetiği YOK — bilerek. Bu testlerin konusu, sistemin reddetmesi gereken hâller.

const GUN = 86_400_000
const NOW = instant(1_800_000_000_000)
const EGITMEN = 'usr_egitmen' as StaffUserId
const OWNER = 'usr_owner' as StaffUserId

const ctxOf = (id: StaffUserId, type: 'trainer' | 'owner'): DecideContext => ({
  studioId: 'std_1' as StudioId,
  actor: { type, id },
  now: NOW,
  correlationId: 'cor_1' as CorrelationId,
  source: 'reception_web',
})

const talep = (over: Partial<Parameters<typeof decideRequestLeave>[1]> = {}, mevcut: readonly StaffLeave[] = []) =>
  decideRequestLeave(
    ctxOf(EGITMEN, 'trainer'),
    { leaveId: 'lv_1', staffUserId: EGITMEN, kind: 'izin', from: instant(NOW), to: instant(NOW + 2 * GUN), note: '', ...over },
    mevcut,
  )

const onayli = (over: Partial<StaffLeave> = {}): StaffLeave => ({
  id: 'lv_0',
  staffUserId: EGITMEN,
  kind: 'izin',
  from: instant(NOW),
  to: instant(NOW + 2 * GUN),
  note: '',
  status: 'approved',
  requestedAt: instant(NOW),
  decidedBy: OWNER,
  decidedAt: instant(NOW),
  decisionReason: '',
  ...over,
})

describe('izin talebi', () => {
  it('normal aralık kabul edilir ve bekliyor durumunda doğar', () => {
    const r = talep()
    expect(r.ok && r.value.next.status).toBe('pending')
    expect(r.ok && r.value.events[0]?.type).toBe('staff.leave_requested')
  })

  it('bitiş başlangıçtan önceyse REDDEDİLİR', () => {
    const r = talep({ from: instant(NOW + 2 * GUN), to: instant(NOW) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('invalid_range')
  })

  it('çakışan aralık REDDEDİLİR — iki üst üste izin, "bu gün izinli mi"nin iki cevabıdır', () => {
    const r = talep({ from: instant(NOW + 2 * GUN), to: instant(NOW + 4 * GUN) }, [onayli()])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('leave_overlaps')
  })

  it('reddedilmiş bir izin çakışma saymaz — o günler gerçekten boş', () => {
    expect(talep({}, [onayli({ status: 'rejected' })]).ok).toBe(true)
  })

  it('başkasının adına izin istenemez', () => {
    const r = decideRequestLeave(
      ctxOf(OWNER, 'owner'),
      { leaveId: 'lv_2', staffUserId: EGITMEN, kind: 'izin', from: instant(NOW), to: instant(NOW), note: '' },
      [],
    )
    expect(r.ok).toBe(false)
  })

  // NOTUN KENDİSİ OLAYA GİRMİYOR (#6): serbest metin, PII'nin sızdığı yerdir.
  it('olay notu taşımaz, yalnızca yazılıp yazılmadığını', () => {
    const r = talep({ note: 'Annem hastanede, Ankara’ya gidiyorum' })
    const p = r.ok ? (r.value.events[0]?.payload as { hasNote: boolean; days: number }) : null
    expect(p?.hasNote).toBe(true)
    expect(JSON.stringify(r.ok && r.value.events[0]?.payload)).not.toContain('Ankara')
  })
})

describe('izin kararı', () => {
  const bekleyen = onayli({ status: 'pending', decidedBy: null, decidedAt: null })

  it('owner onaylar ve ETKİLENEN DERS SAYISI olaya yazılır', () => {
    const r = decideDecideLeave(ctxOf(OWNER, 'owner'), bekleyen, { approve: true, affectedSessions: 3 })
    expect(r.ok && r.value.next.status).toBe('approved')
    expect(r.ok && (r.value.events[0]?.payload as { affectedSessions: number }).affectedSessions).toBe(3)
  })

  it('red SEBEPSİZ olmaz', () => {
    const r = decideDecideLeave(ctxOf(OWNER, 'owner'), bekleyen, { approve: false, reason: '   ' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('reason_required')
  })

  // Bu testin varlık sebebi: kendi iznini onaylayabilen bir sistemde onay diye bir şey yoktur,
  // yalnızca bir form vardır.
  it('kimse KENDİ iznini onaylayamaz', () => {
    const r = decideDecideLeave(ctxOf(EGITMEN, 'trainer'), bekleyen, { approve: true, affectedSessions: 0 })
    expect(r.ok).toBe(false)
  })

  it('karar verilmiş bir izin ikinci kez karara açılmaz', () => {
    expect(decideDecideLeave(ctxOf(OWNER, 'owner'), onayli(), { approve: true, affectedSessions: 0 }).ok).toBe(false)
  })
})

describe('izin geri çekme', () => {
  it('sahibi BEKLEYEN talebini geri çekebilir', () => {
    const r = decideCancelLeave(ctxOf(EGITMEN, 'trainer'), onayli({ status: 'pending' }))
    expect(r.ok && r.value.next.status).toBe('cancelled')
  })

  // Onaylanmış izne göre program değişmiş olabilir; tek başına geri almak o değişikliği sessizce
  // geçersiz kılardı.
  it('ONAYLANMIŞ izni sahibi tek başına geri alamaz', () => {
    expect(decideCancelLeave(ctxOf(EGITMEN, 'trainer'), onayli()).ok).toBe(false)
  })

  it('owner onaylanmış izni geri alabilir ve olay bunu ayırt eder', () => {
    const r = decideCancelLeave(ctxOf(OWNER, 'owner'), onayli())
    expect(r.ok && (r.value.events[0]?.payload as { wasApproved: boolean }).wasApproved).toBe(true)
  })
})
