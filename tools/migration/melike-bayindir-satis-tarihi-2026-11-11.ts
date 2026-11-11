import {
  FirestoreFinanceRepository,
  cancelSale,
  instant,
  money,
  newOperationId,
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

// MELİKE BAYINDIR — TAMAMLAMA SATIŞININ TARİHİ DÜNE (owner, 2026-11-11: "satış tarihini de düne çek").
//
//   pnpm tsx tools/migration/melike-bayindir-satis-tarihi-2026-11-11.ts            (kuru çalışma)
//   pnpm tsx tools/migration/melike-bayindir-satis-tarihi-2026-11-11.ts --apply
//
// `melike-bayindir-tamamlama-2026-11-11.ts` tahsilatı dünün tarihiyle, satışı BUGÜNÜN tarihiyle yazdı:
// bugünkü "anlaşılan tutar" 4.500 ₺ şişti, karşısında bugünkü bir tahsilat yok. Bir satışın tarihi
// yerinde değiştirilmez (#9) — iptal edilir ve doğru tarihle yeniden yazılır:
//   1 · tahsilat iptal (sebepli)  2 · satış iptal (sebepli)  3 · aynı satış + nakit tahsilat, ikisi de 10.11.
// Kasa etkisi sıfır (10.11: −4.500 +4.500), bugün sıfır (11.11: −4.500 satış iptali, +0), 10.11'e +4.500 satış.

const STUDIO = 'retro'
const RUN = 'melike-bayindir-satis-tarihi-2026-11-11'
const UYE = 'mem_01M5CP76B7YDDCFNA0508MDC7P'
const ESKI_SATIS = 'sal_01M75W6ES8CK8GZQJZJS6QY0QE'
const ESKI_ODEME = 'pay_01M75W6ES8CK8GZQJZJS6QY0QE'
const KASA = 'drw_01KXGHV45ZJ91XCHHSNGN7A00H' // Merkez Kasa
const FARK = 450_000
const ALINDI = Date.parse('2026-11-10T12:00:00+03:00')
const ACIKLAMA = 'Fitness 1 aylıktan 3 aylığa tamamlama farkı'
const SEBEP = 'Satış tarihi yanlış günde (11.11) yazılmıştı; para 10.11 alındı — doğru tarihle yeniden yazılıyor (owner).'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin',
  } as unknown as TenantContext
  const deps: FinanceDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock, source: 'migration' }
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }

  const sale = await deps.repo.getSale(ctx, ESKI_SATIS)
  const pay = await deps.repo.getPayment(ctx, ESKI_ODEME)
  if (!sale || sale.status === 'cancelled' || sale.total.amount !== FARK || String(sale.memberId) !== UYE) return dur('satış beklenen durumda değil')
  if (!pay || pay.voided || pay.amount.amount !== FARK) return dur('tahsilat beklenen durumda değil')
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`iptal   : tahsilat ${ESKI_ODEME} + satış ${ESKI_SATIS} (${FARK / 100} ₺)`)
  console.log(`yeniden : "${ACIKLAMA}" ${FARK / 100} ₺ satış + nakit tahsilat, ikisi de ${new Date(ALINDI).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}, Merkez Kasa`)
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  const v = await voidPayment(deps, ctx, { paymentId: ESKI_ODEME, reason: SEBEP })
  if (!v.ok) return dur(`tahsilat iptali: ${JSON.stringify(v.error)}`)
  console.log('✅ eski tahsilat iptal edildi')
  const c = await cancelSale(deps, ctx, { saleId: ESKI_SATIS, reason: SEBEP })
  if (!c.ok) return dur(`satış iptali: ${JSON.stringify(c.error)}`)
  console.log('✅ eski satış iptal edildi')

  const opId = newOperationId()
  const s = await sell(deps, ctx, {
    saleId: `sal_${opId.slice(4)}`,
    memberId: UYE as MemberId,
    branchId: 'mutlukent' as BranchId,
    soldAt: instant(ALINDI),
    lines: [{ productId: null as never, description: ACIKLAMA, quantity: 1, unitPrice: money(FARK), entitlementId: null, giftCardId: null }],
    discounts: [],
    discountCeilingPercent: null,
    payment: {
      paymentId: `pay_${opId.slice(4)}`, allocationId: `alc_${opId.slice(4)}`, amount: money(FARK), method: 'cash',
      receivedAt: instant(ALINDI), drawerId: KASA, giftCardCode: null, note: ACIKLAMA,
    },
  })
  if (!s.ok) return dur(`yeni satış: ${JSON.stringify(s.error)}`)
  console.log(`✅ satış + tahsilat 10.11 tarihiyle yazıldı: ${s.value.saleId}`)
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
