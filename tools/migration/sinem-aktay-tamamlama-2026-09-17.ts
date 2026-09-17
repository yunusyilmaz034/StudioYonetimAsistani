import {
  FirestoreFinanceRepository,
  money,
  instant,
  sell,
  systemClock,
  voidPayment,
  type BranchId,
  type FinanceDeps,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// SİNEM AKTAY — 6 AYLIKTAN 12 AYA TAMAMLAMA, KAYDIN DÜZELTİLMESİ (owner onayı, 2026-09-17).
//
//   pnpm exec tsx tools/migration/sinem-aktay-tamamlama-2026-09-17.ts            (kuru çalışma)
//   pnpm exec tsx tools/migration/sinem-aktay-tamamlama-2026-09-17.ts --apply
//
// NE OLDU. Üye 6 aylık fitness paketini 12 aya tamamlattı, 6.750 ₺ nakit verdi. Resepsiyon parayı
// "Tahsilat Al"dan girdi ve paketin süresini/tutarını "Düzenle"den güncelledi. Paket tarafı doğru:
// 08.09.2026 → 07.09.2027. Para tarafı eksik kaldı: 6.750 ₺ hiçbir SATIŞA bağlanamadı, çünkü karşılığı
// olan bir satış yok — mevcut satış 14.000 ₺ ve zaten kapalı. Sonuç: cari hesapta "Alacaklı 6.750 ₺",
// yani stüdyo üyeye borçluymuş gibi görünüyor.
//
// "Paket tutarı" alanı BORCU değiştirir, satış belgesini değil — panelin kendi uyarısı da bunu söylüyor.
// Amend paketin `priceAgreed`ini 20.750 yaptı; satış hâlâ 14.000. İkisi ayrı kayıtlar.
//
// NEDEN İPTAL + YENİDEN YAZMA. Sistemde "eldeki mahsup edilmemiş ödemeyi yeni bir satışa bağla" diye bir
// yol yok: `sell` yalnızca KENDİ içinde aldığı ödemeyi mahsup eder. Satışı tahsilatsız açıp parayı
// bağlayamayız; tahsilatlı açarsak kasaya 6.750 ₺ İKİNCİ kez girer ve gün sonu sayımı tutmaz.
// Bu yüzden: ödemeyi iptal et (para kasadan geri çıkar), satışı tahsilatıyla birlikte yeniden yaz
// (para aynı kasaya geri girer, bu kez bir satışa bağlı olarak). Net kasa etkisi SIFIR.
//
// Kayıt silinmiyor: iptal de bir harekettir, sebebiyle birlikte kalır (#9 — düzeltme, telafi olayıdır).

const STUDIO = 'retro'
const RUN = 'sinem-aktay-tamamlama-2026-09-17'
const UYE = 'mem_01M1Y19VEEYVQAJCZ3HBR516YA' // SİNEM AKTAY
const SUBE = 'mutlukent'
const ESKI_ODEME = 'pay_01M2R2VJNQDPPWQX6H2R0SM9SJ' // 6.750 ₺ nakit, 17.09 19:23, mahsup edilmemiş
const KASA = 'drw_01KXGHV45ZJ91XCHHSNGN7A00H' // aynı kasa — para nereden çıktıysa oraya döner
const TUTAR = 675_000 // kuruş
const ACIKLAMA = '6 aylık fitness paketi 12 aya tamamlama farkı'
const SEBEP = 'Satışı olmayan tahsilat: aynı tutar, açıklamalı bir satışla birlikte yeniden yazılıyor.'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: [SUBE],
    role: 'platform_admin',
  } as unknown as TenantContext
  const deps: FinanceDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock, source: 'migration' }

  const eski = await deps.repo.getPayment(ctx, ESKI_ODEME)
  if (!eski) return console.log(`${ESKI_ODEME}: BULUNAMADI`)
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`mevcut ödeme : ${eski.amount.amount / 100} ₺ · ${eski.method} · kasa ${eski.drawerId ?? 'yok'}`)
  console.log(`yapılacak    : bu ödeme İPTAL edilecek, ardından "${ACIKLAMA}" adıyla`)
  console.log(`               ${TUTAR / 100} ₺ satış + aynı tutarda nakit tahsilat yazılacak (kasa ${KASA}).`)
  console.log('kasa etkisi  : −6.750 (iptal) +6.750 (yeni tahsilat) = 0')
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  const iptal = await voidPayment(deps, ctx, { paymentId: ESKI_ODEME, reason: SEBEP })
  if (!iptal.ok) return console.log(`İPTAL HATASI: ${iptal.error.code}`)
  console.log('✅ eski tahsilat iptal edildi')

  const opId = Date.now().toString(36)
  const satis = await sell(deps, ctx, {
    saleId: `sal_${RUN.replace(/-/g, '').slice(0, 20)}${opId}`.slice(0, 40),
    memberId: UYE as MemberId,
    branchId: SUBE as BranchId,
    lines: [{ productId: null as never, description: ACIKLAMA, quantity: 1, unitPrice: money(TUTAR), entitlementId: null, giftCardId: null }],
    discounts: [],
    discountCeilingPercent: null,
    payment: {
      paymentId: `pay_${RUN.replace(/-/g, '').slice(0, 20)}${opId}`.slice(0, 40),
      allocationId: `alc_${opId}`,
      amount: money(TUTAR),
      method: 'cash',
      // Paranın GERÇEKTE alındığı an — bugün 19:23. Bugünün rakamlarına iki kez girmemesi için
      // orijinal tahsilatın saati korunuyor; iptal de bugün yazıldığı için gün sonu netleşiyor.
      receivedAt: instant(Date.parse('2026-09-17T16:23:06.167Z')),
      drawerId: KASA,
      giftCardCode: null,
      note: ACIKLAMA,
    },
  })
  console.log(satis.ok ? `✅ satış + tahsilat yazıldı: ${satis.value.saleId}` : `SATIŞ HATASI: ${satis.error.code}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
