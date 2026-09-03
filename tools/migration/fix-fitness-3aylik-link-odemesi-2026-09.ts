import {
  FirestoreFinanceRepository,
  FirestorePaymentLinkRepository,
  FirestorePaytrCollectionRepository,
  cancelSale,
  instant,
  money,
  reconcileCollection,
  sell,
  systemClock,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// NAKİT FİYATINDAN SATILMIŞ, KART FİYATINDAN ÖDENMİŞ İKİ PAKET — break-glass (owner, 2026-09-03).
//
//   pnpm tsx tools/migration/fix-fitness-3aylik-link-odemesi-2026-09.ts
//   pnpm tsx tools/migration/fix-fitness-3aylik-link-odemesi-2026-09.ts --apply
//
// ── NE OLDU ─────────────────────────────────────────────────────────────────────────────────
//
// Owner iki ödeme linkini PAYTR panelinden gönderdi; ikisi de 20:00 civarı **9.500 ₺** olarak
// ödendi (P.F. 2 taksit, %7,06'yı stüdyo üstlendi). Resepsiyon owner'ı beklemeden paketleri
// tanımladı ve link ödemesini göremediği için satışı **nakit fiyatından (8.500 ₺)** yazdı.
//
// Ölçüldü (2026-09-03 20:15, prod okuması):
//
//   İDİL ÖZDEDE  · satış 8.500 · ödenen 0 · durum open
//   İREM YILMAZ  · satış 8.500 · ödenen 0 · durum open
//
// Yani owner'ın "nakit/havale diye kaydetmiş" dediği ödeme aslında **hiç kaydedilmemiş**: iki üye de
// 8.500 ₺ BORÇLU görünüyordu. Kasada olmayan bir nakit yok — bu yüzden iptal edilecek bir ödeme de
// yok, ve script bir ödeme bulursa DURUR (aşağıda), çünkü o zaman gördüğüm tablo değişmiş demektir.
//
// ── DOĞRUSU NE ──────────────────────────────────────────────────────────────────────────────
//
// Katalog: `Fitness - 3 Aylık` → **kart 9.500 / nakit 8.500**. Kartla ödendi, dolayısıyla satışın
// tutarı KART fiyatıdır. 8.500 yazıp üstüne 9.500 tahsilat işlemek, 1.000 ₺'lik bir fazla tahsilat
// uydururdu; 8.500 bırakıp 8.500 tahsil etmek ise girmemiş bir indirimi deftere sokardı ([[OR-32]]).
//
//   yanlış satış sebebiyle iptal → 9.500'den doğrusu kurulur (AYNI abonelik satırı) →
//   9.500 `online` tahsilat, PAYTR referansıyla → tahsilat üyeye eşleştirilir
//
// **Abonelik değişmiyor:** ürün, tarihler ve süre zaten doğruydu. Yeni satışın satırı aynı
// `entitlementId`yi gösteriyor, yani üyede tek paket kalır.
//
// **Ödeme `online`, `drawerId: null`:** para karttan geldi, kasaya girmedi. Nakit gibi yazmak, sayım
// yapan kişinin çekmecede bulamayacağı 19.000 ₺ demek olurdu.
//
// **`providerRef` PAYTR'ın referansı:** stüdyonun kasası ile PAYTR bakiyesi karşılaştırıldığında iki
// satırın aynı işlem olduğu görülebilsin.
//
// ── AKTÖR ───────────────────────────────────────────────────────────────────────────────────
// `platform_admin / migration:<run>` — resepsiyonun ya da owner'ın kimliği ödünç alınmaz (#5).

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-fitness-3aylik-link-odemesi-2026-09'
const PRODUCT = 'prd_01KXJD2CW08CNP08KJRSW34DRR'
const URUN_ADI = 'Fitness - 3 Aylık'
const YANLIS_KURUS = 850_000 // nakit fiyatı — yazılmış olan
const DOGRU_KURUS = 950_000 // kart fiyatı — gerçekten ödenen
const REASON = 'Link ile kart ödemesi alındı; satış nakit fiyatından yazılmıştı (owner, 2026-09-03).'

const VAKALAR = [
  {
    ad: 'İDİL ÖZDEDE',
    memberId: 'mem_01M1M3EWSPSY9JB2BYGQFV9SW3',
    saleId: 'sal_01M1M3Z1BBC85WCP09BN3J48YY',
    entitlementId: 'ent_01M1M3Z1BDGN1NN2YFRPBAFPCK',
    collectionId: 'pcol_01M1M43R7YXSAQYDWS3WCR6665',
    providerRef: 'S1788454546036736112547192168',
    paidAtIso: '2026-09-03T20:00:44+03:00',
  },
  {
    ad: 'İREM YILMAZ',
    memberId: 'mem_01M1M3FHYVEMDNQVFM2S6RZWNR',
    saleId: 'sal_01M1M3ZNY3HZTWW59JBK0QK2WF',
    entitlementId: 'ent_01M1M3ZNY31Q4ES5PA0609XDCQ',
    collectionId: 'pcol_01M1M43RDESYJYPG3TQ4SYES36',
    providerRef: 'S1788454755735547869188579974',
    paidAtIso: '2026-09-03T20:03:45+03:00',
  },
] as const

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
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
  const paytr = {
    linkRepo: new FirestorePaymentLinkRepository(db),
    collectionRepo: new FirestorePaytrCollectionRepository(db),
    clock: systemClock,
  }

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  for (const v of VAKALAR) {
    console.log(`━━ ${v.ad}`)
    const saleDoc = await db.doc(`studios/${STUDIO}/sales/${v.saleId}`).get()
    const sale = saleDoc.data() as
      | { total?: { amount?: number }; paid?: { amount?: number }; status?: string; lines?: { unitPrice?: { amount?: number } }[] }
      | undefined
    const yeni = await db.doc(`studios/${STUDIO}/sales/sal_${RUN}_${v.memberId}`).get()
    const col = await db.doc(`studios/${STUDIO}/paytrCollections/${v.collectionId}`).get()

    // Ödeme VAR MI? Owner "nakit/havale yazmış" dedi, ölçüm "hiç ödeme yok" dedi. İkisi çelişiyorsa
    // duran taraf script olur: kaydı olmayan bir ödemeyi iptal edemem, ve varsayarak devam etmek
    // parayı iki kez saymanın en kısa yoludur.
    const pays = await db.collection(`studios/${STUDIO}/payments`).where('memberId', '==', v.memberId).get()
    const canli = pays.docs.filter((d) => d.get('voided') !== true)

    console.log(`   satış      : ${v.saleId} · durum ${sale?.status ?? 'YOK'}`)
    console.log(`   satır fiyat: ${tl(sale?.lines?.[0]?.unitPrice?.amount ?? 0)} → olacak ${tl(DOGRU_KURUS)}`)
    console.log(`   ödenen     : ${tl(sale?.paid?.amount ?? 0)} · üyede ${canli.length} canlı ödeme kaydı`)
    console.log(`   tahsilat   : ${col.exists ? `${v.collectionId} · ${col.get('status')}` : 'YOK'}`)
    console.log(`   yeni satış : ${yeni.exists ? 'ZATEN VAR — atlanacak' : 'kurulacak'}`)

    if (!saleDoc.exists) { console.log('   DUR: satış bulunamadı.\n'); continue }
    if ((sale?.lines?.[0]?.unitPrice?.amount ?? 0) !== YANLIS_KURUS) { console.log('   DUR: satır fiyatı beklenenden farklı — zaten düzeltilmiş olabilir.\n'); continue }
    if (canli.length > 0) { console.log('   DUR: üyede canlı ödeme kaydı VAR. Beklenen tablo bu değildi; elle bakılmalı.\n'); continue }
    if (!col.exists || col.get('status') !== 'unreconciled') { console.log('   DUR: eşleşmemiş tahsilat bulunamadı.\n'); continue }
    if (yeni.exists) { console.log('   DUR: bu düzeltme zaten uygulanmış.\n'); continue }
    if (!apply) { console.log(''); continue }

    const cancelled = await cancelSale(fin, ctx, { saleId: v.saleId, reason: REASON })
    if (!cancelled.ok) { console.error('   SATIŞ İPTALİ BAŞARISIZ:', cancelled.error); return }
    console.log('   ✓ nakit fiyatlı satış sebebiyle iptal edildi')

    const paymentId = `pay_${RUN}_${v.memberId}`
    const sold = await sell(fin, ctx, {
      saleId: `sal_${RUN}_${v.memberId}`,
      memberId: v.memberId as MemberId,
      branchId: BRANCH as never,
      lines: [
        {
          productId: PRODUCT as never,
          description: URUN_ADI,
          quantity: 1,
          unitPrice: money(DOGRU_KURUS),
          entitlementId: v.entitlementId as never,
          giftCardId: null,
        },
      ],
      discounts: [], // indirim YOK — verilmemiş bir taviz deftere girmez
      discountCeilingPercent: null,
      payment: {
        paymentId,
        allocationId: `alc_${RUN}_${v.memberId}`,
        amount: money(DOGRU_KURUS),
        method: 'online', // kart / PAYTR — kasaya girmedi
        receivedAt: instant(Date.parse(v.paidAtIso)),
        drawerId: null,
        giftCardCode: null,
        note: REASON,
        providerRef: v.providerRef,
      },
    })
    if (!sold.ok) { console.error('   SATIŞ BAŞARISIZ:', sold.error); return }
    console.log(`   ✓ ${tl(DOGRU_KURUS)} satış + aynı tutarda online tahsilat (PAYTR ref ile)`)

    const rec = await reconcileCollection(paytr, ctx, {
      collectionId: v.collectionId,
      memberId: v.memberId as MemberId,
      paymentId,
    })
    if (!rec.ok) { console.error('   TAHSİLAT EŞLEŞTİRME BAŞARISIZ:', rec.error); return }
    console.log('   ✓ PAYTR tahsilatı üyeye eşleştirildi\n')
  }

  if (!apply) console.log('(uygulamak için --apply)')
  else console.log('✓ Bitti. İki üyenin de borcu yok, paket tek, para kasaya değil karta yazıldı.')
}

void main()
