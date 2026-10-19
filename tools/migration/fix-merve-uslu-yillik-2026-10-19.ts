import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  cancelEntitlement,
  cancelSale,
  collect,
  instant,
  money,
  sellPackage,
  systemClock,
  voidPayment,
  type BranchId,
  type EntitlementId,
  type MemberId,
  type ProductId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// MERVE FİRDEVS USLU — FITNESS 3 AYLIK → 12 AYLIK, BAŞLANGIÇ AYNI (owner, 2026-10-19)
//
//   pnpm tsx tools/migration/fix-merve-uslu-yillik-2026-10-19.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-merve-uslu-yillik-2026-10-19.ts --apply    # yaz
//
// Owner: *"3 aylık almıştı, farkını ödeyip 1 yıllık aldı… 8.500 ödemişti, 11.000 daha ödedi; paketin
// başlangıç tarihi aynı, 1 yıllık yap."*
//
// Tanı (`tani-merve-uslu-2026-10-19.ts`): 19.09 Fitness 3 Aylık 8.500 satış (21.09 → 20.12), 19.09 500 +
// 21.09 8.000 nakit, ikisi de o satışa. 11.000'lik fark sisteme girilmemiş.
//
// MASANIN ÇEVİRME YOLU (Sevim Aygün, 15.10), aynı use-case'lerle:
//   1) voidPayment ×2 — Eylül ödemeleri (500, 8.000)
//   2) cancelSale     — 3 aylık satış ("1 yıllığa çevrildi")
//   3) cancelEntitlement — 3 aylık paket
//   4) sellPackage    — Fitness 12 Aylık 19.500 (nakit fiyatı), başlangıç 21.09.2026 → 21.09.2027
//   5) collect ×3     — 19.09 500 + 21.09 8.000 (eski saatleriyle) + bugün 11.000 nakit, hepsi yeni satışa
//
// KASA: Eylül tahsilatları KASASIZ yeniden yazılıyor. Kasa Hareketleri ödemeyi `receivedAt` ile okur,
// kasadan bağımsız — Eylül günleri aynı kalır. Bugün açılan Merkez Kasa'ya yalnızca yeni 11.000 girer;
// eskileri kasaya bağlasaydık bugünün beklenen nakdi 8.500 şişerdi (Eylül iptalleri bugünkü oturuma
// dokunmuyor, `voidReachesDrawer`).

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-merve-uslu-yillik-2026-10-19'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  memberId: 'mem_01M2WYFJWA3X2GQ7966G54ZN9R' as MemberId,
  eskiPaket: 'ent_01M2WYGTJJZQJYGN18YH4V9FTY' as EntitlementId,
  eskiSatis: 'sal_01M2WYGTHZC1490MWW3WCJ347Z',
  eskiOdemeler: ['pay_01M2WYGTHZC1490MWW3WCJ347Z', 'pay_01M326C4TV3FMRBFJXA2BVTCFG'],
  yillikUrun: 'prd_01KZBDCZYNYPBDZXSNRVGGPXJE',
  fiyatKurus: 1_950_000,
  baslangic: 1_789_938_000_000, // 21.09.2026 00:00 +03 — eski paketin validFrom'u
  drawerId: 'drw_01KXGHV45ZJ91XCHHSNGN7A00H',
} as const

const REASON =
  'Merve Firdevs Uslu Fitness 3 Aylık (8.500 ödenmiş) 12 Aylık 19.500 ₺\'ye çevrildi; 11.000 ₺ fark nakit ' +
  'ödendi. Başlangıç aynı (21.09.2026). Eylül ödemeleri yeni satışa aynı tarihlerle aktarıldı (owner, 2026-10-19).'

const tl = (k: number): string => `${(k / 100).toLocaleString('tr-TR')} ₺`
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Number(v ?? 0))
const gun = (t: number): string => new Date(t).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: [BRANCH],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }
  const ent = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }
  const col = (c: string) => db.collection(`studios/${STUDIO}/${c}`)

  const [eskiPaket, eskiSatis, urun, ...eskiOdeme] = await Promise.all([
    col('entitlements').doc(VAKA.eskiPaket).get(),
    col('sales').doc(VAKA.eskiSatis).get(),
    col('products').doc(VAKA.yillikUrun).get(),
    ...VAKA.eskiOdemeler.map((id) => col('payments').doc(id).get()),
  ])
  if (eskiPaket.get('memberId') !== VAKA.memberId || ms(eskiPaket.get('validFrom')) !== VAKA.baslangic) return dur('eski paket tanıdaki gibi değil.')
  if (eskiSatis.get('memberId') !== VAKA.memberId || Number(eskiSatis.get('total.amount')) !== 850_000) return dur('eski satış tanıdaki gibi değil.')
  if (!urun.exists || urun.get('name') !== 'Fitness - 12 Aylık' || urun.get('durationDays') !== 365) return dur('12 aylık ürün beklenen gibi değil.')
  if (eskiOdeme.some((p) => p.get('memberId') !== VAKA.memberId)) return dur('eski ödemeler tanıdaki gibi değil.')

  // Yeniden çalıştırmada: daha önce verilmiş 12 aylık paket ve satışı.
  const paketler = await col('entitlements').where('memberId', '==', VAKA.memberId).get()
  const yeniPaket = paketler.docs.find((d) => d.get('productId') === VAKA.yillikUrun && d.get('status') !== 'cancelled')
  const satislar = await col('sales').where('memberId', '==', VAKA.memberId).get()
  const yeniSatisBul = (entId: string) =>
    satislar.docs.find((s) => s.get('status') !== 'cancelled' && (s.get('lines') as { entitlementId?: string }[] | undefined)?.some((l) => l.entitlementId === entId))

  const now = Date.now()
  const tahsilatlar = [
    { id: `pay_${RUN}_1`, kurus: Number(eskiOdeme[0]!.get('amount.amount')), at: ms(eskiOdeme[0]!.get('receivedAt')), drawerId: null },
    { id: `pay_${RUN}_2`, kurus: Number(eskiOdeme[1]!.get('amount.amount')), at: ms(eskiOdeme[1]!.get('receivedAt')), drawerId: null },
    { id: `pay_${RUN}_3`, kurus: 1_100_000, at: now, drawerId: VAKA.drawerId },
  ]
  if (tahsilatlar.reduce((s, t) => s + t.kurus, 0) !== VAKA.fiyatKurus) return dur('tahsilatlar 19.500 etmiyor.')
  const varMi = await Promise.all(tahsilatlar.map((t) => col('payments').doc(t.id).get()))

  console.log(`━━ MERVE FİRDEVS USLU · ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'}`)
  eskiOdeme.forEach((p) => console.log(`   iptal ödeme : ${p.id} · ${gun(ms(p.get('receivedAt')))} · ${tl(Number(p.get('amount.amount')))}${p.get('voided') ? ' — ZATEN İPTAL' : ''}`))
  console.log(`   iptal satış : ${VAKA.eskiSatis} · 3 Aylık 8.500${eskiSatis.get('status') === 'cancelled' ? ' — ZATEN İPTAL' : ''}`)
  console.log(`   iptal paket : ${VAKA.eskiPaket}${eskiPaket.get('status') === 'cancelled' ? ' — ZATEN İPTAL' : ''}`)
  console.log(`   yeni paket  : Fitness - 12 Aylık · ${tl(VAKA.fiyatKurus)} · ${gun(VAKA.baslangic)} → +365 gün${yeniPaket ? ` — ZATEN VAR (${yeniPaket.id})` : ''}`)
  tahsilatlar.forEach((t, i) => console.log(`   tahsil      : ${gun(t.at)} · ${tl(t.kurus)} nakit · ${t.drawerId ? 'Merkez Kasa' : 'kasasız'}${varMi[i]!.exists ? ' — ZATEN VAR' : ''}`))
  console.log(`   sebep       : ${REASON}`)
  if (!APPLY) { console.log('\n   --apply ile çalıştır.'); return }

  for (const p of eskiOdeme) {
    if (p.get('voided')) continue
    const r = await voidPayment(fin, ctx, { paymentId: p.id, reason: REASON })
    if (!r.ok) return dur(`ödeme iptali ${p.id}: ${JSON.stringify(r.error)}`)
    console.log(`   ✓ ödeme iptal ${p.id}`)
  }
  if (eskiSatis.get('status') !== 'cancelled') {
    const r = await cancelSale(fin, ctx, { saleId: VAKA.eskiSatis, reason: REASON })
    if (!r.ok) return dur(`satış iptali: ${JSON.stringify(r.error)}`)
    console.log('   ✓ 3 aylık satış iptal')
  }

  let entId = yeniPaket?.id
  let saleId = entId ? yeniSatisBul(entId)?.id : undefined
  if (!entId) {
    const p = urun
    const r = await sellPackage({ finance: fin, entitlements: ent }, ctx, {
      branchId: BRANCH as BranchId,
      subscription: {
        memberId: VAKA.memberId,
        productId: p.id as ProductId,
        productSnapshot: {
          productId: p.id as ProductId,
          name: p.get('name'),
          category: p.get('category'),
          grant: { kind: 'period', durationDays: p.get('durationDays'), access: 'unlimited' },
          listPrice: money(p.get('priceInKurus')),
          serviceIds: p.get('serviceIds'),
          cancellationAllowanceCount: p.get('cancellationAllowanceCount') ?? null,
          dailyReservationLimit: p.get('dailyReservationLimit') ?? null,
          activeReservationLimit: p.get('activeReservationLimit') ?? null,
          entryAllowance: p.get('entryAllowance') ?? null,
        },
        policyRef: { policyId: p.id, version: 1 },
        priceAgreed: money(VAKA.fiyatKurus),
        validFrom: VAKA.baslangic,
        validUntil: null,
        freezeDays: p.get('freezeAllowanceDays') > 0 ? p.get('freezeAllowanceDays') : null,
        creditOverride: null,
        collectedAmount: money(0),
        method: 'cash',
        note: REASON,
      } as never,
      payment: null,
      discountCeilingPercent: null,
    })
    if (!r.ok) return dur(`12 aylık satış: ${JSON.stringify(r.error)}`)
    entId = r.value.entitlementId
    saleId = r.value.saleId
    console.log(`   ✓ 12 aylık ${entId} · satış ${saleId}`)
  }
  if (!saleId) return dur('12 aylık paketin satışı bulunamadı.')

  if (eskiPaket.get('status') !== 'cancelled') {
    const r = await cancelEntitlement(ent, ctx, { entitlementId: VAKA.eskiPaket, reason: REASON, refundPaymentId: null })
    if (!r.ok) return dur(`paket iptali: ${JSON.stringify(r.error)}`)
    console.log('   ✓ 3 aylık paket iptal')
  }

  for (const [i, t] of tahsilatlar.entries()) {
    if (varMi[i]!.exists) continue
    const r = await collect(fin, ctx, {
      paymentId: t.id,
      memberId: VAKA.memberId,
      branchId: BRANCH as BranchId,
      amount: money(t.kurus),
      method: 'cash',
      receivedAt: instant(t.at),
      drawerId: t.drawerId,
      allowNoDrawer: t.drawerId === null,
      giftCardCode: null,
      note: REASON,
      allocateTo: [{ saleId, amount: money(t.kurus), allocationId: `alc_${RUN}_${i + 1}` }],
    })
    if (!r.ok) return dur(`tahsilat ${gun(t.at)}: ${JSON.stringify(r.error)} — betiği yeniden çalıştır, yapılanlar atlanır.`)
    if (r.value.unallocated > 0) console.warn(`   UYARI: ${tl(r.value.unallocated)} tahsis edilemedi.`)
    console.log(`   ✓ ${gun(t.at)} ${tl(t.kurus)}`)
  }

  const [s, e] = await Promise.all([col('sales').doc(saleId).get(), col('entitlements').doc(entId).get()])
  console.log(`\n✅ SON DURUM · ${e.get('productSnapshot.name')} · ${e.get('status')} · ${gun(ms(e.get('validFrom')))} → ${gun(ms(e.get('validUntil')))} · satış ${s.get('status')} · toplam ${tl(Number(s.get('total.amount')))} · ödenen ${tl(Number(s.get('paid.amount')))}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
