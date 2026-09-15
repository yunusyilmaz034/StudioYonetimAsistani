import { describe, expect, it } from 'vitest'

import { instant, money, type CorrelationId, type EntitlementId, type MemberId, type ProductId, type ServiceId, type StudioId } from '../../../shared'
import { decideSyncSnapshotToProduct } from './decide'
import type { Entitlement } from './types'

// PAKETİ ÜRÜNLE EŞİTLE (owner, 2026-09-15): ürün satıştan sonra PT kategorisine düzeltildi, satılmış iki paket
// eski kategoride kaldı ve PT seansına alınamadı.
const NOW = instant(1_789_500_000_000)
const ctx = { studioId: 'std_1' as StudioId, actor: { type: 'owner' as const, id: 'usr_1' as never }, now: NOW, correlationId: 'cor_1' as CorrelationId, source: 'reception_web' }
const PT = 'svc_pt' as ServiceId
const ent = (over: Partial<Entitlement> = {}, snap: Record<string, unknown> = {}): Entitlement =>
  ({
    id: 'ent_1' as EntitlementId,
    studioId: 'std_1' as StudioId,
    memberId: 'mem_1' as MemberId,
    productId: 'prd_pt' as ProductId,
    productSnapshot: { productId: 'prd_pt' as ProductId, name: 'PT PİLATES 6 AY', category: 'pilates_group', serviceIds: [PT], grant: { kind: 'credits', credits: 48, validForDays: 180 }, listPrice: money(4_500_000), ...snap },
    policyRef: { policyId: 'prd_pt', version: 1 },
    status: 'active',
    validFrom: NOW,
    validUntil: instant(NOW + 180 * 86_400_000),
    credits: { granted: 48, held: 0, consumed: 0, restored: 0, revoked: 0, expired: 0 },
    freeze: null,
    cancellationLedger: { used: 0, refunded: 0 },
    entryLedger: { consumed: 0, restored: 0 },
    priceAgreed: money(3_000_000),
    paidTotal: money(3_000_000),
    manualPayment: null,
    purchasedAt: NOW,
    ...over,
  }) as Entitlement
const urun = { productId: 'prd_pt' as ProductId, category: 'private' as const, serviceIds: [PT] }

describe('decideSyncSnapshotToProduct', () => {
  it('kategoriyi ürünle eşitler; kredi, fiyat, süre aynı kalır; olay değişikliği ve sebebi taşır', () => {
    const r = decideSyncSnapshotToProduct(ctx, ent(), urun, ' satış sonrası kategori düzeltmesi ')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.productSnapshot.category).toBe('private')
    expect(r.value.next.credits).toEqual(ent().credits)
    expect(r.value.next.priceAgreed).toEqual(ent().priceAgreed)
    expect(r.value.next.validUntil).toBe(ent().validUntil)
    expect(r.value.events[0]?.type).toBe('entitlement.amended')
    expect(r.value.events[0]?.payload).toEqual({ changedFields: ['category'], changes: { category: { from: 'pilates_group', to: 'private' } }, reason: 'satış sonrası kategori düzeltmesi' })
  })
  it('zaten eşitse olay yazmaz', () => {
    const r = decideSyncSnapshotToProduct(ctx, ent({}, { category: 'private' }), urun, 'x')
    expect(r.ok && r.value.events).toEqual([])
  })
  it('hizmet kapsamı farklıysa onu da eşitler', () => {
    const r = decideSyncSnapshotToProduct(ctx, ent({}, { category: 'private', serviceIds: [] }), urun, 'x')
    expect(r.ok && r.value.events[0]?.payload).toMatchObject({ changedFields: ['serviceIds'] })
  })
  it('dondurulmuş paket de eşitlenir', () => {
    expect(decideSyncSnapshotToProduct(ctx, ent({ status: 'frozen' }), urun, 'x').ok).toBe(true)
  })
  it('REDDEDER: sebepsiz; başka ürün; hibrit; süresi dolmuş ya da iptal edilmiş paket', () => {
    expect(decideSyncSnapshotToProduct(ctx, ent(), urun, '  ')).toEqual({ ok: false, error: { code: 'reason_required' } })
    expect(decideSyncSnapshotToProduct(ctx, ent(), { ...urun, productId: 'prd_x' as ProductId }, 'x')).toEqual({ ok: false, error: { code: 'operation_not_applicable' } })
    expect(decideSyncSnapshotToProduct(ctx, ent({}, { components: [{ category: 'fitness' }] }), urun, 'x')).toEqual({ ok: false, error: { code: 'operation_not_applicable' } })
    expect(decideSyncSnapshotToProduct(ctx, ent({ status: 'expired' }), urun, 'x')).toEqual({ ok: false, error: { code: 'operation_not_applicable' } })
    expect(decideSyncSnapshotToProduct(ctx, ent({ status: 'cancelled' }), urun, 'x')).toEqual({ ok: false, error: { code: 'operation_not_applicable' } })
  })
})
