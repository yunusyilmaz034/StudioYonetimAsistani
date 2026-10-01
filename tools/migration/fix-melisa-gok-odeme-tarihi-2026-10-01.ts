import {
  FirestoreFinanceRepository,
  cancelSale,
  instant,
  money,
  sell,
  systemClock,
  voidPayment,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// MELİSA GÖK — ÖDEME DÜN ALINDI, BUGÜNE YAZILMIŞ (owner, 2026-10-01).
//
//   pnpm tsx tools/migration/fix-melisa-gok-odeme-tarihi-2026-10-01.ts
//   pnpm tsx tools/migration/fix-melisa-gok-odeme-tarihi-2026-10-01.ts --apply
//
// Owner: *"Melisa Gök dün KK ile ödeme yaptı fakat bugünde görünüyor."* Kayıt 1 Ekim 16:09'u
// gösteriyor; para 30 Eylül'de girdi.
//
// ── NEDEN İPTAL + YENİDEN KURMA ─────────────────────────────────────────────────────────────
//
// Bir ödemenin `receivedAt`'ini YERİNDE değiştiren bir işlem yok — ve olmaması doğru: tarih,
// cironun hangi güne yazıldığını belirler (nakit esaslı muhasebe), yani elle düzenlenebilir bir
// alan değil, bir kaydın kendisidir. Düzeltme yolu Burcu Akça vakasındaki ile aynı ve kanıtlanmış:
// ödemeyi iptal et, satışı iptal et, ikisini de DOĞRU tarihle yeniden kur (#9: düzeltme, üstüne
// yazma değil; her adım gerekçeli bir telafi olayı bırakır).
//
// ── KASA ETKİSİ YOK ─────────────────────────────────────────────────────────────────────────
//
// Ödeme kredi kartı ve `drawerId: null` — kasa bakiyesine hiç dokunmuyor. `voidPayment` yalnızca
// `cash` ve `pos` için kasa deltası yazıyor, bu ikisi de değil. Yani gün sonu sayımları etkilenmez;
// değişen tek şey cironun hangi güne yazıldığı.
//
// Satış 200 ₺ HEDİYE İNDİRİMİ taşıyor (brüt 13.200 → net 13.000). Yeniden kurarken indirim de
// birebir taşınıyor: indirimi düşürüp net fiyattan satmak, verilen şeyi kayıttan silerdi.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-melisa-gok-odeme-tarihi-2026-10-01'
const APPLY = process.argv.includes('--apply')
const REASON =
  'Ödeme 30 Eylül’de kredi kartıyla alındı, kayıt 1 Ekim’i gösteriyordu; satış ve tahsilat doğru ' +
  'tarihle yeniden kuruldu (owner onayı, 2026-10-01).'

const VAKA = {
  ad: 'MELİSA GÖK',
  memberId: 'mem_01M3PW0TDQ5S38PHW53D4C9X64',
  saleId: 'sal_01M3VSBQ5AKCFVF5XZ82HTP6SB',
  paymentId: 'pay_01M3VSBQ5AKCFVF5XZ82HTP6SB',
  entitlementId: 'ent_01M3VSBQ5B0DN4VGFR1R4MHY8B',
  productId: 'prd_01KXN2C19AY0EJ0T8VTMV4JSHN',
  urun: 'PT 8 Ders',
  brutKurus: 1_320_000,
  indirimKurus: 20_000,
  netKurus: 1_300_000,
  // 1 Ekim 16:09:48 TRT → aynı saat, bir gün geriye.
  dogruIso: '2026-09-30T13:09:48.000Z',
} as const

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`
const an = (t: unknown): string =>
  (t as { toDate?: () => Date })?.toDate?.()?.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) ?? '—'

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

  const s = await db.doc(`studios/${STUDIO}/sales/${VAKA.saleId}`).get()
  const p = await db.doc(`studios/${STUDIO}/payments/${VAKA.paymentId}`).get()
  const e = await db.doc(`studios/${STUDIO}/entitlements/${VAKA.entitlementId}`).get()
  const yeni = await db.doc(`studios/${STUDIO}/sales/sal_${RUN}`).get()

  console.log(`━━ ${VAKA.ad}`)
  console.log(`   satış : ${s.exists ? `${tl(Number(s.get('total.amount')))} · ${s.get('status')} · ${an(s.get('soldAt'))}` : 'YOK'}`)
  console.log(`   ödeme : ${p.exists ? `${tl(Number(p.get('amount.amount')))} · ${p.get('method')} · kasa=${p.get('drawerId')} · ${an(p.get('receivedAt'))}` : 'YOK'}`)
  console.log(`   HEDEF : aynı tutar ve indirim, tarih → ${new Date(VAKA.dogruIso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}\n`)

  if (!s.exists || !p.exists || !e.exists) { console.error('DUR: kayıtlardan biri yok.'); process.exit(1) }
  if (s.get('status') === 'cancelled') { console.log('DUR: satış zaten iptal.'); return }
  if (p.get('voided') === true) { console.log('DUR: ödeme zaten iptal.'); return }
  if (p.get('drawerId') !== null) { console.error('DUR: ödemenin bir kasası var — kasa etkisi incelenmeden taşınmaz.'); process.exit(1) }
  if (Number(p.get('amount.amount')) !== VAKA.netKurus) { console.error('DUR: ödeme tutarı beklenenden farklı.'); process.exit(1) }
  if (Number(s.get('total.amount')) !== VAKA.netKurus) { console.error('DUR: satış tutarı beklenenden farklı.'); process.exit(1) }
  if (yeni.exists) { console.log('DUR: düzeltme zaten uygulanmış.'); return }
  if (!APPLY) { console.log('(uygulamak için --apply)'); return }

  console.log('── UYGULANIYOR ──')
  const vo = await voidPayment(fin, ctx, { paymentId: VAKA.paymentId, reason: REASON })
  if (!vo.ok) { console.error('ÖDEME İPTALİ BAŞARISIZ:', vo.error); process.exit(1) }
  const ca = await cancelSale(fin, ctx, { saleId: VAKA.saleId, reason: REASON })
  if (!ca.ok) { console.error('SATIŞ İPTALİ BAŞARISIZ:', ca.error); process.exit(1) }

  const at = instant(Date.parse(VAKA.dogruIso))
  const sold = await sell(fin, ctx, {
    saleId: `sal_${RUN}`,
    memberId: VAKA.memberId as MemberId,
    branchId: BRANCH as never,
    lines: [
      {
        productId: VAKA.productId as never,
        description: VAKA.urun,
        quantity: 1,
        unitPrice: money(VAKA.brutKurus),
        entitlementId: VAKA.entitlementId as never,
        giftCardId: null,
      },
    ],
    // İndirim birebir taşınıyor — 200 ₺ hediye. Net fiyattan satmak, verilen şeyi kayıttan silerdi.
    discounts: [{ reason: 'gift', amount: money(VAKA.indirimKurus), note: '', couponCode: null, referredByMemberId: null }],
    discountCeilingPercent: null,
    payment: {
      paymentId: `pay_${RUN}`,
      allocationId: `alc_${RUN}`,
      amount: money(VAKA.netKurus),
      method: 'credit_card',
      receivedAt: at,
      drawerId: null,
      giftCardCode: null,
      note: REASON,
    },
  })
  if (!sold.ok) { console.error('SATIŞ BAŞARISIZ:', sold.error); process.exit(1) }

  console.log(`✓ ${tl(VAKA.netKurus)} satış + tahsilat, 30 Eylül tarihiyle. İndirim ve abonelik aynı.`)
}

void main()
