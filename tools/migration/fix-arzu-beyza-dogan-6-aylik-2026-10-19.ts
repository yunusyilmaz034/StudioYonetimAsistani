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
import { getFirestore, Timestamp, type DocumentSnapshot } from 'firebase-admin/firestore'

// ARZU DOĞAN — 12 AYLIK → ARZU 6 AYLIK + KIZI BEYZA DOĞAN 6 AYLIK, FARK 6.000 (Işıl → owner, 2026-10-19)
//
//   pnpm tsx tools/migration/fix-arzu-beyza-dogan-6-aylik-2026-10-19.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-arzu-beyza-dogan-6-aylik-2026-10-19.ts --apply    # yaz
//
// Işıl: *"12 aylık eklenmişti, şimdi onu 6 aylık kendisine 6 aylık kızına yapacak, para farkını ödetecek…
// 14+14 28, 22 düşeceğim, 6 ödeyecek."* Owner: kızı Beyza Doğan; Beyza bugün (19.10) başlar; Arzu'nun
// 6 aylığı 12 aylığın başlangıcıyla (14.10), düz 6 ay — 12 aylıktaki fazladan ay taşınmaz.
//
// Tanı (`tani-arzu-dogan-2026-10-19.ts`): 15.09 Fitness 12 Aylık 22.000 (kart fiyatı), PAYTR linkiyle tek
// ödeme 22.000 `online`, 14.10.2026 → 14.11.2027. 6 Aylık kart fiyatı 14.000 (nakit 12.750).
//
// Ödeme bir üyenin satışına ancak KENDİ ödemesiyle bağlanır (`decideAllocate`). Bu yüzden 22.000'lik tek
// PAYTR ödemesi iptal edilip aynı an + aynı sağlayıcı referansıyla İKİYE yazılıyor: Arzu 14.000 (satışı
// kapanır), Beyza 8.000 (satışı 6.000 borçlu kalır — panoda görünür, ödeyince masa tahsil eder). Online
// ödeme kasaya girmez; ödeme iptali ledger kaydıdır, karta iade ya da PAYTR çağrısı DEĞİLDİR.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-arzu-beyza-dogan-6-aylik-2026-10-19'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  arzu: 'mem_01KXN38ZT0TSY6NZ1BWW06CK6B' as MemberId,
  beyza: 'mem_01M2AWAJP8SMD5HEH6E1PN0WAD' as MemberId,
  eskiPaket: 'ent_01M2J50F7GMYQ6224F6W3FFSEQ' as EntitlementId,
  eskiSatis: 'sal_01M2J50F7FVQ8H49TRNGSZAB4M',
  eskiOdeme: 'pay_52e7045a9a0f4226ade0',
  eskiKurus: 2_200_000,
  urun: 'prd_01KXJD2D1EMQRC6C0RD777VG2Y', // Fitness - 6 Aylık
  fiyatKurus: 1_400_000, // kart fiyatı — 12 aylık da kart fiyatından (22.000) alınmıştı
  arzuBaslangic: 1_791_925_200_000, // 14.10.2026 00:00 +03 — 12 aylığın validFrom'u
  beyzaBaslangic: Date.parse('2026-10-19T00:00:00+03:00'),
} as const

const REASON =
  'Arzu Doğan Fitness 12 Aylık (22.000, PAYTR) ikiye bölündü: Arzu 6 Aylık 14.000 (14.10.2026) + kızı Beyza Doğan ' +
  '6 Aylık 14.000 (19.10.2026). 22.000 aynı PAYTR ödemesi olarak 14.000 + 8.000 paylaştırıldı; Beyza 6.000 ödeyecek ' +
  '(Işıl/owner, 2026-10-19).'

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

  const [eskiPaket, eskiSatis, eskiOdeme, urun] = await Promise.all([
    col('entitlements').doc(VAKA.eskiPaket).get(),
    col('sales').doc(VAKA.eskiSatis).get(),
    col('payments').doc(VAKA.eskiOdeme).get(),
    col('products').doc(VAKA.urun).get(),
  ])
  if (eskiPaket.get('memberId') !== VAKA.arzu || ms(eskiPaket.get('validFrom')) !== VAKA.arzuBaslangic) return dur('12 aylık paket tanıdaki gibi değil.')
  if (eskiSatis.get('memberId') !== VAKA.arzu || Number(eskiSatis.get('total.amount')) !== VAKA.eskiKurus) return dur('12 aylık satış tanıdaki gibi değil.')
  if (eskiOdeme.get('memberId') !== VAKA.arzu || Number(eskiOdeme.get('amount.amount')) !== VAKA.eskiKurus || eskiOdeme.get('method') !== 'online') return dur('PAYTR ödemesi tanıdaki gibi değil.')
  if (urun.get('name') !== 'Fitness - 6 Aylık' || urun.get('durationDays') !== 180 || urun.get('priceInKurus') !== VAKA.fiyatKurus) return dur('6 aylık ürün beklenen gibi değil.')
  const providerRef = (eskiOdeme.get('providerRef') as string | null) ?? '52e7045a9a0f4226ade0568d9599d03f'
  const odemeAni = ms(eskiOdeme.get('receivedAt'))

  // Yeniden çalıştırmada: daha önce verilmiş 6 aylıklar ve satışları.
  const mevcut = async (memberId: MemberId) => {
    const [p, s] = await Promise.all([col('entitlements').where('memberId', '==', memberId).get(), col('sales').where('memberId', '==', memberId).get()])
    const paket = p.docs.find((d) => d.get('productId') === VAKA.urun && d.get('status') !== 'cancelled')
    const satis = paket && s.docs.find((x) => x.get('status') !== 'cancelled' && (x.get('lines') as { entitlementId?: string }[]).some((l) => l.entitlementId === paket.id))
    return { paket, satis }
  }
  const kisiler = [
    { ad: 'Arzu', memberId: VAKA.arzu, baslangic: VAKA.arzuBaslangic, odemeKurus: 1_400_000, odemeId: `pay_${RUN}_arzu` },
    { ad: 'Beyza', memberId: VAKA.beyza, baslangic: VAKA.beyzaBaslangic, odemeKurus: 800_000, odemeId: `pay_${RUN}_beyza` },
  ] as const
  const durum = await Promise.all(kisiler.map(async (k) => ({ ...(await mevcut(k.memberId)), odeme: await col('payments').doc(k.odemeId).get() })))

  console.log(`━━ ARZU + BEYZA DOĞAN · ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'}`)
  console.log(`   iptal ödeme : ${VAKA.eskiOdeme} · ${gun(odemeAni)} · ${tl(VAKA.eskiKurus)} online${eskiOdeme.get('voided') ? ' — ZATEN İPTAL' : ''}`)
  console.log(`   iptal satış : ${VAKA.eskiSatis} · 12 Aylık${eskiSatis.get('status') === 'cancelled' ? ' — ZATEN İPTAL' : ''}`)
  console.log(`   iptal paket : ${VAKA.eskiPaket}${eskiPaket.get('status') === 'cancelled' ? ' — ZATEN İPTAL' : ''}`)
  kisiler.forEach((k, i) => {
    console.log(`   ${k.ad.padEnd(5)} 6 Aylık: ${tl(VAKA.fiyatKurus)} · ${gun(k.baslangic)} → +180 gün${durum[i]!.paket ? ` — ZATEN VAR (${durum[i]!.paket!.id})` : ''}`)
    console.log(`   ${k.ad.padEnd(5)} ödeme  : ${gun(odemeAni)} · ${tl(k.odemeKurus)} online (PAYTR ${providerRef.slice(0, 8)}…) → borç ${tl(VAKA.fiyatKurus - k.odemeKurus)}${durum[i]!.odeme.exists ? ' — ZATEN VAR' : ''}`)
  })
  console.log(`   sebep       : ${REASON}`)
  if (!APPLY) { console.log('\n   --apply ile çalıştır.'); return }

  if (!eskiOdeme.get('voided')) {
    const r = await voidPayment(fin, ctx, { paymentId: VAKA.eskiOdeme, reason: REASON })
    if (!r.ok) return dur(`ödeme iptali: ${JSON.stringify(r.error)}`)
    console.log('   ✓ 22.000 ödeme iptal (ledger)')
  }
  if (eskiSatis.get('status') !== 'cancelled') {
    const r = await cancelSale(fin, ctx, { saleId: VAKA.eskiSatis, reason: REASON })
    if (!r.ok) return dur(`satış iptali: ${JSON.stringify(r.error)}`)
    console.log('   ✓ 12 aylık satış iptal')
  }
  if (eskiPaket.get('status') !== 'cancelled') {
    const r = await cancelEntitlement(ent, ctx, { entitlementId: VAKA.eskiPaket, reason: REASON, refundPaymentId: null })
    if (!r.ok) return dur(`paket iptali: ${JSON.stringify(r.error)}`)
    console.log('   ✓ 12 aylık paket iptal')
  }

  const sonuc: { ad: string; entId: string; saleId: string }[] = []
  for (const [i, k] of kisiler.entries()) {
    let entId = durum[i]!.paket?.id
    let saleId = (durum[i]!.satis as DocumentSnapshot | undefined)?.id
    if (!entId) {
      const r = await sellPackage({ finance: fin, entitlements: ent }, ctx, {
        branchId: BRANCH as BranchId,
        subscription: {
          memberId: k.memberId,
          productId: urun.id as ProductId,
          productSnapshot: {
            productId: urun.id as ProductId,
            name: urun.get('name'),
            category: urun.get('category'),
            grant: { kind: 'period', durationDays: urun.get('durationDays'), access: 'unlimited' },
            listPrice: money(urun.get('priceInKurus')),
            serviceIds: urun.get('serviceIds'),
            cancellationAllowanceCount: urun.get('cancellationAllowanceCount') ?? null,
            dailyReservationLimit: urun.get('dailyReservationLimit') ?? null,
            activeReservationLimit: urun.get('activeReservationLimit') ?? null,
            entryAllowance: urun.get('entryAllowance') ?? null,
          },
          policyRef: { policyId: urun.id, version: 1 },
          priceAgreed: money(VAKA.fiyatKurus),
          validFrom: k.baslangic,
          validUntil: null,
          freezeDays: urun.get('freezeAllowanceDays') > 0 ? urun.get('freezeAllowanceDays') : null,
          creditOverride: null,
          collectedAmount: money(0),
          method: 'online',
          note: REASON,
        } as never,
        payment: null,
        discountCeilingPercent: null,
      })
      if (!r.ok) return dur(`${k.ad} 6 aylık satış: ${JSON.stringify(r.error)}`)
      entId = r.value.entitlementId
      saleId = r.value.saleId
      console.log(`   ✓ ${k.ad} 6 aylık ${entId} · satış ${saleId}`)
    }
    if (!saleId) return dur(`${k.ad} 6 aylık paketin satışı bulunamadı.`)
    if (!durum[i]!.odeme.exists) {
      const r = await collect(fin, ctx, {
        paymentId: k.odemeId,
        memberId: k.memberId,
        branchId: BRANCH as BranchId,
        amount: money(k.odemeKurus),
        method: 'online',
        receivedAt: instant(odemeAni),
        drawerId: null,
        allowNoDrawer: true,
        giftCardCode: null,
        providerRef,
        note: REASON,
        allocateTo: [{ saleId, amount: money(k.odemeKurus), allocationId: `alc_${RUN}_${k.ad.toLowerCase()}` }],
      })
      if (!r.ok) return dur(`${k.ad} ödeme: ${JSON.stringify(r.error)} — betiği yeniden çalıştır, yapılanlar atlanır.`)
      if (r.value.unallocated > 0) console.warn(`   UYARI: ${tl(r.value.unallocated)} tahsis edilemedi.`)
      console.log(`   ✓ ${k.ad} ${tl(k.odemeKurus)} online`)
    }
    sonuc.push({ ad: k.ad, entId, saleId })
  }

  console.log('\n✅ SON DURUM')
  for (const s of sonuc) {
    const [e, x] = await Promise.all([col('entitlements').doc(s.entId).get(), col('sales').doc(s.saleId).get()])
    console.log(`   ${s.ad}: ${e.get('productSnapshot.name')} · ${e.get('status')} · ${gun(ms(e.get('validFrom')))} → ${gun(ms(e.get('validUntil')))} · satış ${x.get('status')} · toplam ${tl(Number(x.get('total.amount')))} · ödenen ${tl(Number(x.get('paid.amount')))}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
