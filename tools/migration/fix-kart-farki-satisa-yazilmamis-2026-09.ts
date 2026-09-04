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

// KART FARKI TAHSİL EDİLMİŞ AMA SATIŞA YAZILMAMIŞ — 4 ÜYE (owner onayı, 2026-09-04).
//
//   pnpm tsx tools/migration/fix-kart-farki-satisa-yazilmamis-2026-09.ts
//   pnpm tsx tools/migration/fix-kart-farki-satisa-yazilmamis-2026-09.ts --apply
//
// ── NE OLDU ─────────────────────────────────────────────────────────────────────────────────
//
// Satış ekranı kart farkını `owedKurus`a ekliyor ve tahsilatı ona göre yapıyordu, ama SATIŞI farksız
// (nakit) fiyattan kuruyordu:
//
//     priceAgreedKurus: toKurus(effectivePrice)   → nakit fiyatı
//     collectedKurus:   amountKurus               → kart farkı dahil
//
// Aradaki tutar hiçbir satışa tahsis edilemeden ödemenin üstünde "üye alacağı" olarak kalıyordu
// (I-33) — ve ekran bunu göstermiyordu bile, çünkü satış kendi içinde kapanmış görünüyordu
// ("Kalan bakiye 0"). Çift yönlü sessiz bir hata: CİRO eksik, ÜYE ALACAĞI fazla.
//
// Kod 4 Eylül'de düzeltildi; bu script o güne kadar birikmiş dört kaydı düzeltiyor. (Beşincisi —
// Elif Atalay Öztürk — ayrı bir script'te ele alındı, çünkü onda ayrıca hayalet bir POS kaydı vardı.)
//
// ── DESEN, ÜÇÜNCÜ KEZ AYNI ──────────────────────────────────────────────────────────────────
//
// Yanlış satış SEBEBİYLE iptal → doğrusu AYNI abonelik satırına kurulur → ödeme ÖZGÜN tarihi ve
// yöntemiyle geri yazılır → aboneliğin kendi tutarı da düzeltilir.
//
// Son adım kolayca atlanır ve 3 Eylül'de atlanmıştı: `sell` ABONELİĞE DOKUNMAZ. Abonelikteki
// `priceAgreed`, üye kartındaki "Paket tutarı" satırının ve BİLGİ FİŞİNİN okuduğu alandır — yani
// düzeltilmezse müşteriye yanlış tutarlı bir fiş verilebilir.
//
// Kasa etkilenmiyor: dördü de `credit_card` ve kasasız kayıtlı (bu stüdyoda POS kasası hiç tanımlı
// değil — 12 kart ödemesinin 12'si kasasız).

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-kart-farki-2026-09'
const APPLY = process.argv.includes('--apply')
const REASON =
  'Kart farkı tahsil edilmiş ama satışa yazılmamıştı; satış tahsil edilen tutardan yeniden kuruldu (owner onayı, 2026-09-04).'

// Hepsi ÖLÇÜLEREK yazıldı (4 Eylül). Ödeme ve satış kimlikleri aynı soneki taşıyor, yani hangi
// ödemenin hangi satışa ait olduğu tahmin değil.
const VAKALAR = [
  {
    ad: 'LEMAN DEMİREL TATOĞLU',
    memberId: 'mem_01M0HP6FZ705H9B1EF63JHTGVS',
    saleId: 'sal_01M0HPDE17TQ1W588283MAEJ7D',
    paymentId: 'pay_01M0HPDE17TQ1W588283MAEJ7D',
    entitlementId: 'ent_01M0HPDE19370D2PTDR8',
    productId: 'prd_01KXJD2CW08CNP08KJRSW34DRR',
    urun: 'Fitness - 3 Aylık',
    yanlisKurus: 850_000,
    dogruKurus: 950_000,
    odemeIso: '2026-08-21T08:18:49.000Z',
  },
  {
    ad: 'HAYRUNİSA KIRAÇ',
    memberId: 'mem_01KXN38ZABKWNHA26EGAZRJSDW',
    saleId: 'sal_01M0WXQ38QTF9MFXPD5PRQVMJ7',
    paymentId: 'pay_01M0WXQ38QTF9MFXPD5PRQVMJ7',
    entitlementId: 'ent_01M0WXQ38R62EHHJKR8C',
    productId: 'prd_01KXJD2CQ8WWKZMJCFBSP8HYDE',
    urun: 'Reformer Pilates - 16 Ders',
    yanlisKurus: 780_000,
    dogruKurus: 860_000,
    odemeIso: '2026-08-25T16:58:04.000Z',
  },
  {
    ad: 'NESLİHAN EROĞLU',
    memberId: 'mem_01KXN390TXGFMCMBEV9214K2VW',
    saleId: 'sal_01M11H06EHAA1R1JW3D8BTCZ4V',
    paymentId: 'pay_01M11H06EHAA1R1JW3D8BTCZ4V',
    entitlementId: 'ent_01M11H06EJQRN848R2SR',
    productId: 'prd_01KXJD2CW08CNP08KJRSW34DRR',
    urun: 'Fitness - 3 Aylık',
    yanlisKurus: 850_000,
    dogruKurus: 950_000,
    odemeIso: '2026-08-27T11:52:03.000Z',
  },
  {
    ad: 'İREM KILIÇ',
    memberId: 'mem_01KY536PHC5RCSM3TDXJS1D8GS',
    saleId: 'sal_01M1E2T65JC874N1GCNRQEFK15',
    paymentId: 'pay_01M1E2T65JC874N1GCNRQEFK15',
    entitlementId: 'ent_01M1E2T65M9BV1K9NE3D',
    productId: 'prd_01KXJD2CHDK9EA6RM869W45J60',
    urun: 'Reformer Pilates - 8 Ders',
    yanlisKurus: 420_000,
    dogruKurus: 450_000,
    odemeIso: '2026-09-01T08:54:14.000Z',
  },
] as const

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

  console.log(APPLY ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA ──\n')

  for (const v of VAKALAR) {
    console.log(`━━ ${v.ad}`)
    const s = await db.doc(`studios/${STUDIO}/sales/${v.saleId}`).get()
    const p = await db.doc(`studios/${STUDIO}/payments/${v.paymentId}`).get()
    const yeni = await db.doc(`studios/${STUDIO}/sales/sal_${RUN}_${v.memberId}`).get()
    console.log(`   satış  : ${tl(s.get('total.amount') ?? 0)} → olacak ${tl(v.dogruKurus)} · ${s.get('status')}`)
    console.log(`   ödeme  : ${tl(p.get('amount.amount') ?? 0)} · ${p.get('method')} · iptal ${p.get('voided')}`)

    // DUR KOŞULLARI. Para kaydında "herhalde aynıdır" diye devam etmek, ikinci bir hatanın en kısa yolu.
    if (!s.exists || s.get('status') === 'cancelled') { console.log('   DUR: satış yok ya da iptal edilmiş.\n'); continue }
    if ((s.get('total.amount') ?? 0) !== v.yanlisKurus) { console.log('   DUR: satış tutarı beklenenden farklı — düzeltilmiş olabilir.\n'); continue }
    if (!p.exists || p.get('voided') === true) { console.log('   DUR: ödeme yok ya da iptal.\n'); continue }
    if ((p.get('amount.amount') ?? 0) !== v.dogruKurus) { console.log('   DUR: ödeme tutarı beklenenden farklı.\n'); continue }
    if (yeni.exists) { console.log('   DUR: bu düzeltme zaten uygulanmış.\n'); continue }
    if (!APPLY) { console.log('') ; continue }

    const vo = await voidPayment(fin, ctx, { paymentId: v.paymentId, reason: REASON })
    if (!vo.ok) { console.error('   ÖDEME İPTALİ BAŞARISIZ:', vo.error); return }

    const ca = await cancelSale(fin, ctx, { saleId: v.saleId, reason: REASON })
    if (!ca.ok) { console.error('   SATIŞ İPTALİ BAŞARISIZ:', ca.error); return }

    const sold = await sell(fin, ctx, {
      saleId: `sal_${RUN}_${v.memberId}`,
      memberId: v.memberId as MemberId,
      branchId: BRANCH as never,
      lines: [
        {
          productId: v.productId as never,
          description: v.urun,
          quantity: 1,
          unitPrice: money(v.dogruKurus),
          entitlementId: v.entitlementId as never,
          giftCardId: null,
        },
      ],
      discounts: [], // hiçbirinde indirim yoktu — ölçüldü
      discountCeilingPercent: null,
      payment: {
        paymentId: `pay_${RUN}_${v.memberId}`,
        allocationId: `alc_${RUN}_${v.memberId}`,
        amount: money(v.dogruKurus),
        method: 'credit_card',
        // ÖZGÜN TARİH: para o gün girdi, bugün değil. Tahsilat raporu gününe yazılmalı.
        receivedAt: instant(Date.parse(v.odemeIso)),
        drawerId: null, // bu stüdyoda POS kasası yok; dördü de kasasız kayıtlıydı
        giftCardCode: null,
        note: REASON,
      },
    })
    if (!sold.ok) { console.error('   SATIŞ BAŞARISIZ:', sold.error); return }

    // ABONELİĞİN KENDİ TUTARI — `sell` buna dokunmaz, ve üye kartı ile BİLGİ FİŞİ bunu okur.
    const am = await amendEntitlement(entDeps, ctx, {
      entitlementId: v.entitlementId as EntitlementId,
      patch: { priceAgreed: money(v.dogruKurus) },
      reason: REASON,
    })
    if (!am.ok) { console.error('   ABONELİK TUTARI DÜZELTİLEMEDİ:', am.error); return }

    console.log(`   ✓ ${tl(v.dogruKurus)} satış + aynı tutarda tahsilat + abonelik tutarı\n`)
  }

  if (!APPLY) console.log('(uygulamak için --apply)')
  else console.log('✓ Bitti. Dördünde de ciro doğru, tahsis edilemeyen fazla kalmadı.')
}

void main()
