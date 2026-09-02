import {
  FirestoreFinanceRepository,
  cancelSale,
  instant,
  money,
  sell,
  systemClock,
  type BranchId,
  type EntitlementId,
  type MemberId,
  type ProductId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ESKİ FİYATLA SATILMIŞ PAKET — break-glass düzeltme, elle, bir kez (owner onayı, 2026-09-02).
//
//   pnpm tsx tools/migration/fix-sakine-hibrit-fiyat-2026-09.ts            (kuru çalışma)
//   pnpm tsx tools/migration/fix-sakine-hibrit-fiyat-2026-09.ts --apply
//
// ── NE OLDU ─────────────────────────────────────────────────────────────────────────────────
//
// Sakine Gümüş'e "Hibrit Aylık — 2 Pilates + 1 Fitness" satıldı ve satışa **7.000 ₺** yazıldı.
// Katalogdaki güncel fiyat ise **nakit 5.850 ₺ / kart 6.500 ₺** — yani yazılan tutar fiyat
// değişmeden önceki tutar. Üstelik tahsilat hiç kaydedilmemiş: üye nakit ödemiş, kayıtta 7.000 ₺
// borç görünüyordu.
//
// Owner (2026-09-02) doğruladı: **5.850 ₺, nakit.**
//
// ── NEDEN İNDİRİM OLARAK YAZILMIYOR ────────────────────────────────────────────────────────
//
// `discountSale` ile 1.150 ₺ indirim yazmak teknik olarak kolaydı ve YANLIŞ olurdu. İndirim,
// stüdyonun bilerek verdiği taviz; onu ölçmenin sebebi de "vermeye devam edelim mi" sorusuna
// cevap verebilmek (OR-32). Burada verilmiş bir taviz yok — yalnızca eski fiyat yazılmış. Onu
// indirim diye kaydetmek, hiç yapılmamış bir indirimi rapora sokardı.
//
// Bu yüzden Esra'daki (2026-08-31) desenin aynısı: yanlış satış SEBEBİYLE iptal edilir, doğrusu
// kurulur. Silme yok, düzeltme var (#9).
//
// ── NEDEN ABONELİĞE DOKUNULMUYOR ───────────────────────────────────────────────────────────
//
// Paketin kendisi doğru: ürün doğru, tarihler doğru, krediler doğru. Yanlış olan tek şey para.
// Yeni satışın satırı **aynı abonelik kimliğini** gösteriyor, yani paket yerinde kalıyor ve
// parası yeniden bağlanıyor. Aboneliği iptal edip yeniden yaratmak, doğru olan bir şeyi bozmak
// olurdu.
//
// ── TAHSİLAT TARİHİ ────────────────────────────────────────────────────────────────────────
//
// Satışın tarihi (01.09.2026 21:00) kullanılıyor — ödeme büyük ihtimalle o an alındı ve tahsilat
// raporu `receivedAt`e göre gün ayırıyor. Başka bir tarihse aşağıdaki sabit değiştirilir.
// Kasa 17 Temmuz'dan beri sürekli açık (tek kasa, "Merkez Kasa"), yani gün sınırı sorunu yok.

const STUDIO = 'retro'
const BRANCH = 'mutlukent' as BranchId
const RUN = 'fix-sakine-hibrit-2026-09'

const MEMBER = 'mem_01KZEED274213MC8MPEYNXBANA' as MemberId
const OLD_SALE = 'sal_01M1F222A0WSJTGR4NC34WWE3A'
const ENTITLEMENT = 'ent_01M1F222A24H62J7W45C7KN9V0' as EntitlementId
const PRODUCT = 'prd_01KY7ZK0HG5RV65F51B9XX9M96' as ProductId
const DRAWER = 'drw_01KXGHV45ZJ91XCHHSNGN7A00H' // Merkez Kasa

const YANLIS_KURUS = 700_000
const DOGRU_KURUS = 585_000
const ODEME_ANI = Date.parse('2026-09-01T18:00:18.000Z') // 01.09.2026 21:00 Türkiye saati

const REASON = 'Eski fiyatla kaydedilmişti (7.000 ₺); güncel nakit fiyat 5.850 ₺ ve nakit tahsil edildi. Owner onayı, 02.09.2026.'

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

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  // ÖNCE OKU. Beklenen durumda değilse hiçbir şey yapma — bu script bir kez içindir ve ikinci kez
  // çalıştırılırsa zaten düzelmiş bir kaydı bozabilir.
  const saleDoc = await db.doc(`studios/${STUDIO}/sales/${OLD_SALE}`).get()
  const sale = saleDoc.data() as { total?: { amount?: number }; status?: string } | undefined
  const yeniSatis = await db.doc(`studios/${STUDIO}/sales/sal_${RUN}`).get()

  console.log(`eski satış   : ${OLD_SALE}`)
  console.log(`  durum      : ${sale?.status ?? 'YOK'}`)
  console.log(`  tutar      : ${((sale?.total?.amount ?? 0) / 100).toLocaleString('tr-TR')} ₺`)
  console.log(`yeni satış   : ${yeniSatis.exists ? 'ZATEN VAR — atlanacak' : 'kurulacak'}`)
  console.log('')
  console.log(`yapılacak    : ${(YANLIS_KURUS / 100).toLocaleString('tr-TR')} ₺ satış İPTAL (sebebiyle)`)
  console.log(`             : ${(DOGRU_KURUS / 100).toLocaleString('tr-TR')} ₺ satış + ${(DOGRU_KURUS / 100).toLocaleString('tr-TR')} ₺ NAKİT tahsilat`)
  console.log(`             : abonelik ${ENTITLEMENT} — DOKUNULMUYOR, yeni satış ona bağlanıyor`)
  console.log(`tahsilat anı : ${new Date(ODEME_ANI).toLocaleString('tr-TR')}`)
  console.log(`kasa         : ${DRAWER} (Merkez Kasa)`)
  console.log('')

  if (!saleDoc.exists) {
    console.log('DUR: eski satış bulunamadı. Hiçbir şey yapılmadı.')
    return
  }
  if (sale?.status !== 'open' && sale?.status !== 'settled') {
    console.log(`DUR: eski satışın durumu "${sale?.status}" — beklenen "open". Zaten düzeltilmiş olabilir.`)
    return
  }
  if ((sale?.total?.amount ?? 0) !== YANLIS_KURUS) {
    console.log('DUR: eski satışın tutarı beklenenden farklı. Elle bakılmalı.')
    return
  }
  if (!apply) {
    console.log('(uygulamak için --apply)')
    return
  }

  const cancelled = await cancelSale(fin, ctx, { saleId: OLD_SALE, reason: REASON })
  if (!cancelled.ok) {
    console.error('İPTAL BAŞARISIZ:', cancelled.error)
    return
  }
  console.log('✓ yanlış satış iptal edildi')

  if (yeniSatis.exists) {
    console.log('• yeni satış zaten vardı, atlandı')
    return
  }

  const sold = await sell(fin, ctx, {
    saleId: `sal_${RUN}`,
    memberId: MEMBER,
    branchId: BRANCH,
    lines: [
      {
        productId: PRODUCT,
        description: 'Hibrit Aylık — 2 Pilates + 1 Fitness',
        quantity: 1,
        unitPrice: money(DOGRU_KURUS),
        // Aynı abonelik: paket yerinde kalıyor, yalnızca parası doğru bağlanıyor.
        entitlementId: ENTITLEMENT,
        giftCardId: null,
      },
    ],
    discounts: [],
    discountCeilingPercent: null,
    payment: {
      paymentId: `pay_${RUN}`,
      allocationId: `alc_${RUN}`,
      amount: money(DOGRU_KURUS),
      method: 'cash',
      receivedAt: instant(ODEME_ANI),
      drawerId: DRAWER,
      giftCardCode: null,
      note: REASON,
    },
  })
  if (!sold.ok) {
    console.error('SATIŞ BAŞARISIZ:', sold.error)
    return
  }
  console.log('✓ doğru satış ve nakit tahsilat kaydedildi')
  console.log('\n✓ Bitti. Üyenin bakiyesi sıfır, kasa 5.850 ₺ arttı.')
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
