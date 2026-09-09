import {
  FirestoreFinanceRepository, money, sell, systemClock,
  type BranchId, type MemberId, type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// HAVA KOLU — İKİNCİ SU, 200 ₺'NİN KALAN 20'Sİ (owner, 2026-09-09).
//
//   pnpm tsx tools/migration/hava-kolu-ikinci-su-2026-09.ts
//   pnpm tsx tools/migration/hava-kolu-ikinci-su-2026-09.ts --apply
//
// Kartla 200 ₺ çekildi. Defterde 180 ₺ vardı: 160 cüzdan + 20 (07.09 tarihli su). Owner:
// *"20 tl yi de elden şimdi su aldı."* Yani kalan 20 ₺, az önce alınan bir suyun bedeli.
//
// VARSAYIM, AÇIKÇA: ödeme yöntemi `credit_card` yazılıyor, çünkü 160 + 20 + 20 = 200 ve o 200
// kartla çekildi. Nakit yazsaydık kart tahsilatı 20 ₺ eksik, kasa 20 ₺ fazla kalırdı. Nakitse
// söylenmesi yeterli: ödeme sebebiyle iptal edilip yerine nakit yazılır.
//
// STOK DÜŞMÜYOR. `sellRetailProductAction` stoğu ayrı bir işlemde düşürüyor; bu betik doğrudan
// `sell` çağırıyor. Su stok takipli bir ürünse rafta bir fazla görünecek — ölçülüyor ve aşağıda
// yazılıyor, tahmin edilmiyor.

const STUDIO = 'retro'
const APPLY = process.argv.includes('--apply')
const MEMBER = 'mem_01KZ3DV0GWQ5PDZ6T2MHQZT9S2'
const RETAIL = 'nLXFTHUlwfOGbWwOXj4I' // 07.09'daki suyun ürün kimliği — satırdan okundu, tahmin değil
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: 'migration:hava-kolu-ikinci-su-2026-09' },
    branchIds: ['mutlukent'],
    correlationId: 'hava-kolu-ikinci-su-2026-09',
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }

  const urun = await db.doc(`studios/${STUDIO}/retailProducts/${RETAIL}`).get()
  if (!urun.exists) { console.log('DUR: ürün bulunamadı.'); return }
  const fiyat = Number(urun.get('priceInKurus') ?? 0)
  const takip = urun.get('trackStock') === true
  console.log(APPLY ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA ──\n')
  console.log(`  ürün  : ${urun.get('name')} · ${tl(fiyat)} · stok takibi ${takip ? `AÇIK (stok ${urun.get('stock')})` : 'kapalı'}`)
  console.log(`  satış : 1 adet, ${tl(fiyat)}, credit_card ile ÖDENMİŞ olarak`)
  if (takip) console.log('  UYARI : stok bu betikle düşmüyor — rafta bir fazla görünecek.')
  if (!APPLY) { console.log('\n--apply ile çalıştırın.'); return }

  const r = await sell(fin, ctx, {
    saleId: 'sal_hava_kolu_su2_2026_09_09',
    memberId: MEMBER as MemberId,
    branchId: 'mutlukent' as BranchId,
    lines: [{
      productId: null,
      description: String(urun.get('name') ?? 'Su'),
      quantity: 1,
      unitPrice: money(fiyat),
      entitlementId: null,
      giftCardId: null,
      retailProductId: RETAIL,
    }],
    discounts: [],
    discountCeilingPercent: null,
    payment: {
      paymentId: 'pay_hava_kolu_su2_2026_09_09',
      allocationId: 'alc_hava_kolu_su2_2026_09_09',
      amount: money(fiyat),
      method: 'credit_card',
      receivedAt: systemClock.now(),
      drawerId: null, // bu stüdyoda POS kasası tanımlı değil
      giftCardCode: null,
      note: '09.09 kartla alınan 200 ₺ içinde tahsil edildi (owner teyidi).',
    },
  })
  console.log(r.ok ? '\n✓ satış ve tahsilatı yazıldı' : `\n✗ REDDEDİLDİ: ${JSON.stringify(r.error)}`)
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
