import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  amendEntitlement,
  cancelSale,
  instant,
  money,
  sell,
  systemClock,
  voidPayment,
  type EntitlementId,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// BURCU AKÇA — NAKİT FİYATINA KURULMUŞ SATIŞ, KARTLA TAHSİL EDİLDİ (owner, 2026-09-29).
//
//   pnpm tsx tools/migration/fix-burcu-akca-kart-farki-2026-09-29.ts
//   pnpm tsx tools/migration/fix-burcu-akca-kart-farki-2026-09-29.ts --apply
//
// ── NE OLDU ─────────────────────────────────────────────────────────────────────────────────
//
// 15 Eylül'de üye "nakit vereceğim" dediği için satış NAKİT fiyatından kuruldu: 8.500 ₺. Bugün
// (29 Eylül 11:55) ödeme KREDİ KARTIYLA alındı ve kart fiyatı 9.500 ₺'ydi.
//
// Ödeme 9.500 olarak kaydedildi ama satış 8.500'de kaldı. Tahsis edilebilen 8.500; kalan **1.000 ₺
// boşta duruyor** ve panelde ÜYENİN ALACAĞI gibi görünüyor. Owner: *"doğru olan alacak falan yok,
// 9.500 kk ile alındı zaten, kart farkı olduğu için alacaklı olmayacaktı."*
//
// Bu, 4 Eylül'de düzeltilen hatanın (`fix-kart-farki-*`) TEKRARI DEĞİL: orada satış kart farkını
// hiç içermiyordu. Burada satış DOĞRU kurulmuştu — nakit için. Değişen şey ödeme yöntemiydi, ve
// yöntem satıştan SONRA değişince satış kendini güncellemiyor.
//
// ── NEDEN İPTAL + YENİDEN KURMA ─────────────────────────────────────────────────────────────
//
// Kapanmış bir satışın tutarını yerinde artıran bir işlem YOK (`finance.ts`: sell · collect ·
// voidPayment · refund · cancelSale · discountSale — indirim var, zam yok, ve bu doğru). Boştaki
// 1.000'i yeni bir satışa bağlayan bir yol da yok: tahsis yalnızca ödeme alınırken kuruluyor.
// Katalogda "kart farkı" diye bir ürün de yok, ve AD-41 gereği uydurulmayacak.
//
// Geriye 4 Eylül'de kullanılan ve kanıtlanmış yol kalıyor: ödemeyi iptal et, satışı iptal et,
// ikisini de DOĞRU tutardan yeniden kur. Ödemenin tarihi korunuyor — para bugün girdi, ciro bugüne
// yazılmalı (nakit esaslı muhasebe, `receivedAt`).
//
// KASA: ödeme kredi kartı olduğu için kasa şartı çalışmıyor (`decideReceivePayment` yalnızca
// `cash` ve `pos` için kasa arar) ve iptal kasa bakiyesine dokunmuyor. Yine de orijinal `drawerId`
// aynen taşınıyor — kayıt olduğu gibi kalsın.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-burcu-akca-kart-farki-2026-09-29'
const APPLY = process.argv.includes('--apply')
const REASON =
  'Satış nakit fiyatından (8.500 ₺) kurulmuştu; tahsilat kartla ve kart fiyatından (9.500 ₺) alındı. ' +
  'Satış ve abonelik tutarı tahsil edilen tutardan yeniden kuruldu; üyede alacak yok (owner onayı, 2026-09-29).'

const VAKA = {
  ad: 'BURCU AKÇA',
  memberId: 'mem_01M2J3B47GW3V35ZEYSK5BR1N8',
  saleId: 'sal_01M2J3FJ9MG4062RPF673JV08D',
  paymentId: 'pay_01M3P5ZSY7YK5V0FX931A4739H',
  entitlementId: 'ent_01M2J3FJ9Q155Q544C0PXC53EN',
  productId: 'prd_01KXJD2CW08CNP08KJRSW34DRR',
  urun: 'Fitness - 3 Aylık',
  drawerId: 'drw_01KXGHV45ZJ91XCHHSNGN7A00H',
  yanlisKurus: 850_000,
  dogruKurus: 950_000,
  odemeIso: '2026-09-29T08:55:03.368Z',
} as const

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

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
  const entDeps = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }

  // HER KİMLİK YAZMADAN ÖNCE DOĞRULANIR (4 Eylül dersi: kesilmiş bir id, yanlış bir id'dir).
  const s = await db.doc(`studios/${STUDIO}/sales/${VAKA.saleId}`).get()
  const p = await db.doc(`studios/${STUDIO}/payments/${VAKA.paymentId}`).get()
  const e = await db.doc(`studios/${STUDIO}/entitlements/${VAKA.entitlementId}`).get()
  const yeni = await db.doc(`studios/${STUDIO}/sales/sal_${RUN}`).get()

  console.log(`━━ ${VAKA.ad}`)
  console.log(`   satış   : ${s.exists ? `${tl(s.get('total.amount') ?? 0)} · ${s.get('status')}` : 'YOK'}`)
  console.log(`   ödeme   : ${p.exists ? `${tl(p.get('amount.amount') ?? 0)} · ${p.get('method')} · tahsis ${tl(p.get('allocated.amount') ?? 0)} · iptal=${p.get('voided')}` : 'YOK'}`)
  console.log(`   abonelik: ${e.exists ? `${e.get('productSnapshot.name')} · anlaşılan ${tl(e.get('priceAgreed.amount') ?? 0)}` : 'YOK'}`)
  console.log(`   boşta   : ${tl((Number(p.get('amount.amount')) || 0) - (Number(p.get('allocated.amount')) || 0))}`)
  console.log(`   HEDEF   : satış ${tl(VAKA.dogruKurus)} · tahsilat ${tl(VAKA.dogruKurus)} · boşta 0 ₺\n`)

  if (!s.exists || !p.exists || !e.exists) { console.error('DUR: kayıtlardan biri bulunamadı.'); process.exit(1) }
  if (s.get('status') === 'cancelled') { console.log('DUR: satış zaten iptal.'); return }
  if (p.get('voided') === true) { console.log('DUR: ödeme zaten iptal.'); return }
  if (Number(p.get('amount.amount')) !== VAKA.dogruKurus) { console.error(`DUR: ödeme ${tl(Number(p.get('amount.amount')))}, beklenen ${tl(VAKA.dogruKurus)}.`); process.exit(1) }
  if (Number(s.get('total.amount')) !== VAKA.yanlisKurus) { console.error(`DUR: satış ${tl(Number(s.get('total.amount')))}, beklenen ${tl(VAKA.yanlisKurus)}.`); process.exit(1) }
  if (yeni.exists) { console.log('DUR: düzeltme zaten uygulanmış.'); return }
  if (!APPLY) { console.log('(uygulamak için --apply)'); return }

  console.log('── UYGULANIYOR ──')
  const vo = await voidPayment(fin, ctx, { paymentId: VAKA.paymentId, reason: REASON })
  if (!vo.ok) { console.error('ÖDEME İPTALİ BAŞARISIZ:', vo.error); process.exit(1) }
  const ca = await cancelSale(fin, ctx, { saleId: VAKA.saleId, reason: REASON })
  if (!ca.ok) { console.error('SATIŞ İPTALİ BAŞARISIZ:', ca.error); process.exit(1) }

  const sold = await sell(fin, ctx, {
    saleId: `sal_${RUN}`,
    memberId: VAKA.memberId as MemberId,
    branchId: BRANCH as never,
    lines: [
      {
        productId: VAKA.productId as never,
        description: VAKA.urun,
        quantity: 1,
        unitPrice: money(VAKA.dogruKurus),
        entitlementId: VAKA.entitlementId as never,
        giftCardId: null,
      },
    ],
    discounts: [],
    discountCeilingPercent: null,
    payment: {
      paymentId: `pay_${RUN}`,
      allocationId: `alc_${RUN}`,
      amount: money(VAKA.dogruKurus),
      method: 'credit_card',
      receivedAt: instant(Date.parse(VAKA.odemeIso)), // para BUGÜN girdi; tarihi korunuyor
      drawerId: VAKA.drawerId,
      giftCardCode: null,
      note: REASON,
    },
  })
  if (!sold.ok) { console.error('SATIŞ BAŞARISIZ:', sold.error); process.exit(1) }

  const am = await amendEntitlement(entDeps, ctx, {
    entitlementId: VAKA.entitlementId as EntitlementId,
    patch: { priceAgreed: money(VAKA.dogruKurus) },
    reason: REASON,
  })
  if (!am.ok) { console.error('ABONELİK TUTARI DÜZELTİLEMEDİ:', am.error); process.exit(1) }

  console.log(`✓ ${tl(VAKA.dogruKurus)} satış + tahsilat + abonelik tutarı. Üyede alacak kalmadı.`)
}

void main()
