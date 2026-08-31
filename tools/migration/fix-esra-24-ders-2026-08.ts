import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  adjustCredits,
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

// YANLIŞ PAKET SATILDI — break-glass düzeltme, elle, bir kez (owner onayı, 2026-08-31).
//
//   pnpm tsx tools/migration/fix-esra-24-ders-2026-08.ts            (kuru çalışma — hiçbir şey yazmaz)
//   pnpm tsx tools/migration/fix-esra-24-ders-2026-08.ts --apply
//
// ── NE OLDU ─────────────────────────────────────────────────────────────────────────────────
//
// Esra Tepe 24 derslik reformer paketi aldı ve 11.000 ₺ havale gönderdi. Resepsiyon listeden
// "Reformer Pilates - 8 Ders"i seçti ve 4.200 ₺ yazdı. Üye aynı gün bir derse geldi, o ders bu
// aboneliğin kredisinden düştü.
//
// Yani ÜÇ şey birden yanlış: ürün, süre ve para — hem tutar hem satış satırı.
//
// ── NEDEN ABONELİK İPTAL EDİLİP YENİDEN SATILMIYOR ─────────────────────────────────────────
//
// Bugünkü katılımı bu aboneliğe bağlı. İptal etsek, katılmış bir ders iptal edilmiş bir paketin
// üstünde kalırdı — kaydı, düzeltmeye çalıştığımızdan daha kötü hale getirir. Abonelik yerinde
// düzeltiliyor; sattığımız şey değişiyor, kimin ne yaptığı değişmiyor.
//
// ── NEDEN KREDİ 8'DEN 24'E "YAZILMIYOR" ────────────────────────────────────────────────────
//
// `granted` satın alma anında yazılır ve bir daha dokunulmaz (Doc 2 §5). Onun üzerine yazmak, bu
// defterin var oluş sebebi olan sessiz düzenlemenin ta kendisi olurdu. Yerine +16'lık bir TELAFİ
// kaydı giriliyor (`correction` + not), ve aritmetik doğru çıkıyor:
//
//     granted 8 + restored 16 − consumed 1 = 23 kalan
//
// ── NEDEN SATIŞ İPTAL EDİLİP YENİDEN KURULUYOR ─────────────────────────────────────────────
//
// Satış tutarı YUKARI çıkamaz: `discountSale` aşağı indirir, yukarı çıkarmaz — ve haklı olarak, çünkü
// bir satışın brütünü büyütmek sessizce daha fazla ciro yazmak demektir. 4.200 ₺'lik satır zaten
// olmayan bir satışı anlatıyor. İptal edilir (sebebiyle), doğrusu kurulur.
//
// Ödemeye de dokunuluyor çünkü O DA yanlıştı: 4.200 ₺ kaydedilmiş, gelen 11.000 ₺. Havale, kasa
// hareketi yok — gün sonu sayımı etkilenmez, etkilenen tek şey ciro rakamı.

const STUDIO = 'retro'
const RUN = 'mig_2026_08_31_esra_24ders'

const MEMBER = 'mem_01M1CA45E2FNJDT5WM1Q3M73BX'
const ENTITLEMENT = 'ent_01M1CA6JH244MSJ4R9Y1MM2H2J'
const OLD_SALE = 'sal_01M1CA6JH1FP60EEBWXQJZDNXH'
const OLD_PAYMENT = 'pay_01M1CA6JH1FP60EEBWXQJZDNXH'
const NEW_PRODUCT = 'prd_01KXZXDWJ6TGEFTRFJSS5QV5JB' // Reformer Pilates - 24 Ders
const BRANCH = 'mutlukent'

const PRICE_KURUS = 1_100_000 // 11.000 ₺ — owner: havaleyle gelen tutar
const NEW_VALID_UNTIL = '2026-11-29' // 31.08 + 90 gün
const CREDIT_DELTA = 16 // 8 → 24
const REASON = 'Resepsiyon 24 Ders yerine 8 Ders kaydetmişti; ürün, süre ve tutar düzeltildi (31.08.2026, owner onayı).'

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`
const DAY_MS = (iso: string) => {
  const ms = Date.parse(`${iso}T00:00:00+03:00`)
  if (Number.isNaN(ms)) throw new Error(`bad date: ${iso}`)
  return ms
}

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
  const ents = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }
  const fin = { repo: new FirestoreFinanceRepository(db), clock: systemClock }

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  // Yazmadan önce OKU. Beklediğimiz durumda değilse hiçbir şey yapma — bu script bir kez içindir ve
  // ikinci kez çalıştırılırsa zaten düzelmiş bir kaydı bozabilir.
  const entDoc = await db.doc(`studios/${STUDIO}/entitlements/${ENTITLEMENT}`).get()
  const saleDoc = await db.doc(`studios/${STUDIO}/sales/${OLD_SALE}`).get()
  const payDoc = await db.doc(`studios/${STUDIO}/payments/${OLD_PAYMENT}`).get()
  const prodDoc = await db.doc(`studios/${STUDIO}/products/${NEW_PRODUCT}`).get()
  if (!entDoc.exists || !saleDoc.exists || !payDoc.exists || !prodDoc.exists) {
    console.log('✗ Beklenen kayıtlardan biri yok. Hiçbir şey yazılmadı.')
    return
  }
  const snap = entDoc.get('productSnapshot') as Record<string, unknown>
  const credits = entDoc.get('credits') as { granted: number; consumed: number; restored: number; revoked: number; expired: number; held: number }
  const p = prodDoc.data() as Record<string, unknown>

  // ADIM ADIM DEVAM. İlk çalıştırmada dördüncü adım Firestore'un `undefined` reddi yüzünden düştü
  // ve düzeltme YARIM kaldı: paket doğruydu, satışı yoktu. "Ya hep ya hiç" olmayan bir düzeltmede
  // doğru davranış baştan başlamak değil, KALDIĞI YERDEN devam etmektir — yoksa ikinci çalıştırma
  // düzelmiş olanı bozar.
  const paketTamam = String(snap.productId) === NEW_PRODUCT
  const krediTamam = credits.restored >= CREDIT_DELTA
  const odemeTamam = payDoc.get('voided') === true
  const satisTamam = saleDoc.get('status') === 'cancelled'
  const yeniSatis = await db.doc(`studios/${STUDIO}/sales/sal_${RUN}`).get()
  if (paketTamam && krediTamam && odemeTamam && satisTamam && yeniSatis.exists) {
    console.log('ZATEN TAMAMEN DÜZELTİLMİŞ. Çıkılıyor.')
    return
  }
  console.log(`durum: paket=${paketTamam ? '✓' : '·'} kredi=${krediTamam ? '✓' : '·'} ödeme=${odemeTamam ? '✓' : '·'} satış=${satisTamam ? '✓' : '·'} yeniSatış=${yeniSatis.exists ? '✓' : '·'}\n`)

  console.log(`üye        : ESRA TEPE`)
  console.log(`ürün       : ${String(snap.name)}  →  ${String(p.name)}`)
  console.log(`bitiş      : 30.09.2026  →  ${NEW_VALID_UNTIL}`)
  console.log(`tutar      : ${tl(Number((entDoc.get('priceAgreed') as { amount: number }).amount))}  →  ${tl(PRICE_KURUS)}`)
  console.log(`krediler   : granted ${credits.granted} · consumed ${credits.consumed} · kalan ${credits.granted + credits.restored - credits.consumed - credits.revoked - credits.expired - credits.held}`)
  console.log(`             → +${CREDIT_DELTA} telafi → kalan ${credits.granted + credits.restored + CREDIT_DELTA - credits.consumed - credits.revoked - credits.expired - credits.held}`)
  console.log(`ödeme      : ${tl(Number((payDoc.get('amount') as { amount: number }).amount))} havale İPTAL → ${tl(PRICE_KURUS)} havale`)
  console.log(`satış      : ${tl(Number((saleDoc.get('total') as { amount: number }).amount))} İPTAL → ${tl(PRICE_KURUS)} (24 Ders)`)

  if (!apply) {
    console.log('\n(uygulamak için --apply)')
    return
  }

  // 1. Paket: ne satıldı, ne kadar sürüyor, kaça anlaşıldı.
  const amended = paketTamam ? ({ ok: true } as const) : await amendEntitlement(ents, ctx, {
    entitlementId: ENTITLEMENT as EntitlementId,
    patch: {
      productSnapshot: {
        ...snap,
        productId: NEW_PRODUCT,
        name: String(p.name),
        grant: { kind: 'credits', credits: Number(p.creditCount), validForDays: Number(p.durationDays) },
        listPrice: money(Number(p.priceInKurus)),
      } as never,
      validUntil: instant(DAY_MS(NEW_VALID_UNTIL)),
      priceAgreed: money(PRICE_KURUS),
    },
    reason: REASON,
  })
  if (!amended.ok) return void console.log(`✗ paket düzeltilemedi: ${JSON.stringify(amended.error)}`)
  console.log('✓ paket 24 Ders / 29.11.2026 / 11.000 ₺ olarak düzeltildi')

  // 2. Krediler: telafi kaydı, üzerine yazma değil.
  const adj = krediTamam ? ({ ok: true } as const) : await adjustCredits(ents, ctx, {
    entitlementId: ENTITLEMENT as EntitlementId,
    delta: CREDIT_DELTA,
    reason: 'correction',
    note: '8 Ders yerine 24 Ders satılmıştı; aradaki 16 ders eklendi.',
  })
  if (!adj.ok) return void console.log(`✗ kredi düzeltilemedi: ${JSON.stringify(adj.error)}`)
  console.log(`✓ +${CREDIT_DELTA} kredi telafisi işlendi`)

  // 3. Para. ÖNCE ödemeyi iptal et: satış, doğru ödeme üstüne düşmeden önce ödenmemiş olmalı.
  const voided = odemeTamam ? ({ ok: true } as const) : await voidPayment(fin, ctx, {
    paymentId: OLD_PAYMENT,
    reason: `${REASON} — 4.200 ₺ kaydedilmişti, gelen havale 11.000 ₺.`,
  })
  if (!voided.ok) return void console.log(`✗ ödeme iptal edilemedi: ${JSON.stringify(voided.error)}`)
  console.log('✓ 4.200 ₺ havale iptal edildi')

  const cancelled = satisTamam ? ({ ok: true } as const) : await cancelSale(fin, ctx, { saleId: OLD_SALE, reason: REASON })
  if (!cancelled.ok) return void console.log(`✗ satış iptal edilemedi: ${JSON.stringify(cancelled.error)}`)
  console.log('✓ 4.200 ₺ satış iptal edildi')

  // 4. Doğru satış — AYNI aboneliğe bağlı, çünkü abonelik değişmedi, sadece içeriği düzeldi.
  const sold = await sell(fin, ctx, {
    saleId: `sal_${RUN}`,
    memberId: MEMBER as MemberId,
    branchId: BRANCH as never,
    lines: [
      {
        productId: NEW_PRODUCT,
        description: String(p.name),
        quantity: 1,
        unitPrice: money(PRICE_KURUS),
        entitlementId: ENTITLEMENT,
        giftCardId: null,
      } as never,
    ],
    discounts: [],
    discountCeilingPercent: null,
    payment: {
      paymentId: `pay_${RUN}`,
      allocationId: `alc_${RUN}`,
      amount: money(PRICE_KURUS),
      method: 'bank_transfer',
      // Havale — kasaya girmez, bu yüzden çekmece yok. Gün sonu sayımı etkilenmez.
      drawerId: null,
      receivedAt: instant(Date.now()),
      // Firestore `undefined` kabul etmez; eksik bırakmak bütün satışı düşürür.
      note: null,
      providerRef: null,
      giftCardId: null,
    } as never,
  })
  console.log(sold.ok ? `✓ 11.000 ₺ havale ile 24 Ders satışı kaydedildi (${sold.value.saleId})` : `✗ satış kurulamadı: ${JSON.stringify(sold.error)}`)
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
