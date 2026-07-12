import { describe, expect, it } from 'vitest'

import { isPresented, present } from './present'
import { KIND_OF, type ActivityEvent } from '@/server/activity-query'

// The presenter's contract (owner rule 1, 2026-07-13): a technical event name NEVER reaches the
// screen. This test is what makes that a build failure instead of a blank row an owner discovers
// at 21:15.

const event = (over: Partial<ActivityEvent>): ActivityEvent =>
  ({
    eventId: 'evt_1',
    type: 'reservation.booked',
    kind: 'reservation',
    occurredAt: 1_752_300_682_000,
    recordedAt: 1_752_300_682_000,
    actorType: 'receptionist',
    actorId: 'usr_1',
    actorName: 'Reyhan',
    memberId: 'mem_1',
    memberName: 'Ayşe',
    operationId: 'cor_1',
    undoPolicy: 'compensating',
    payload: {},
    related: {},
    ...over,
  }) as ActivityEvent

describe('the activity presenter', () => {
  it('has a Turkish sentence for EVERY event type in the catalogue', () => {
    const missing = Object.keys(KIND_OF).filter((type) => !isPresented(type))
    expect(missing, `bu event tipleri için Türkçe cümle yok: ${missing.join(', ')}`).toEqual([])
  })

  it('never puts a technical event name on screen', () => {
    for (const type of Object.keys(KIND_OF)) {
      const p = present(event({ type }))
      // A sentence ends in a full stop — but it never CONTAINS the technical name, and no
      // snake_case identifier leaks through from a payload.
      expect(p.title).not.toContain(type)
      expect(p.title).not.toMatch(/[a-z]+_[a-z]+/)
      expect(p.detail ?? '').not.toContain(type)
    }
  })

  it('writes the sentences the owner asked for', () => {
    // The event carries the GRANT, not a product name (AD-41: the catalogue is data).
    expect(
      present(
        event({
          type: 'entitlement.purchased',
          payload: {
            grant: { kind: 'credits', credits: 8, validForDays: 60 },
            priceAgreed: 500_000,
          },
        }),
      ).title,
    ).toBe('Ayşe’ye 8 derslik paket tanımlandı.')

    // The payload field is `collectedAmount` — reading `amount` printed an em dash for every
    // payment the studio ever took.
    expect(
      present(event({ type: 'entitlement.payment_recorded', payload: { collectedAmount: 500_000 } }))
        .title,
    ).toBe('5.000 ₺ ödeme alındı.')

    expect(
      present(
        event({
          type: 'entitlement.extended',
          payload: { days: 5, fromValidUntil: 1_752_300_000_000, toValidUntil: 1_752_732_000_000 },
        }),
      ).title,
    ).toBe('Ayşe’nin üyeliği 5 gün uzatıldı.')

    const closure = present(
      event({
        type: 'studio_closure.applied',
        payload: {
          reason: 'Kurban Bayramı',
          sessionsCancelled: 54,
          reservationsReleased: 54,
          entitlementsExtended: 121,
        },
      }),
    )
    expect(closure.title).toBe('"Kurban Bayramı" operasyonu uygulandı.')
    expect(closure.detail).toContain('54 seans iptal edildi')
    expect(closure.detail).toContain('121 paket uzatıldı')
  })

  it('surfaces the reason (OP-3) instead of burying it in a payload', () => {
    const p = present(
      event({ type: 'entitlement.adjusted', payload: { delta: 2, reason: 'gift', note: 'Doğum günü' } }),
    )
    expect(p.title).toBe('Ayşe’nin paketine 2 kredi eklendi.')
    expect(p.detail).toContain('hediye')
    expect(p.reason).toBe('gift')
  })

  it('says "Silinmiş üye" rather than a raw id when a member was erased', () => {
    const p = present(event({ type: 'reservation.booked', memberName: 'Silinmiş üye' }))
    expect(p.title).toBe('Silinmiş üye için rezervasyon yapıldı.')
  })
})
