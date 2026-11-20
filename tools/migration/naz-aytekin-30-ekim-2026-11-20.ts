import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  amendEntitlement,
  cancelSale,
  instant,
  money,
  newOperationId,
  sell,
  systemClock,
  type BranchId,
  type EntitlementId,
  type FinanceDeps,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// NAZ AYTEKİN — 30 EKİM'DE NAKİT ÖDEDİ, KASAYA İŞLENMEMİŞ (owner, 2026-11-20: "o güne işle … paketin başlangıç tarihi
// ödeme günü ise 30 ekim olsun, nakit").
//
//   pnpm tsx tools/migration/naz-aytekin-30-ekim-2026-11-20.ts [--apply]
//
// 20.11 12:35'te Fitness 3 Aylık 8.500 ₺ ödemesiz satıldı (paket 20.11→18.02). Doğrusu her şey 30.10:
//   1 · paket break-glass amend: 30.10.2026 → 28.01.2027 (90 gün)
//   2 · bugünkü ödemesiz satış iptal (sebepli; satış günü bugün olduğu için bugünden düşer)
//   3 · aynı satış 30.10 tarihli + 8.500 ₺ nakit, Merkez Kasa, 30.10 — aynı pakete bağlı.

const STUDIO = 'retro'
const RUN = 'naz-aytekin-30-ekim-2026-11-20'
const UYE = 'mem_01M7W4R9Y660N1G9XVS21J9BCW'
const SATIS = 'sal_01M7W4Z0XVAXRMSAMHY57B3P6Z'
const PAKET = 'ent_01M7W4Z0XWAA7Y73BVD820GFBZ'
const KASA = 'drw_01KXGHV45ZJ91XCHHSNGN7A00H' // Merkez Kasa
const TUTAR = 850_000
const BASLANGIC = Date.parse('2026-10-30T00:00:00+03:00')
const ALINDI = Date.parse('2026-10-30T12:00:00+03:00') // saat bilinmiyor
const DAY = 86_400_000
const SEBEP = 'Ödeme 30.10.2026 nakit alınmış ama işlenmemiş; satış, tahsilat ve paket 30.10 tarihine alındı (owner, 20.11.2026).'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin' } as unknown as TenantContext
  const entRepo = new FirestoreEntitlementRepository(db)
  const deps: FinanceDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock, source: 'migration' }
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }
  const d = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

  const sale = await deps.repo.getSale(ctx, SATIS)
  const ent = await entRepo.getEntitlement(ctx, PAKET as EntitlementId)
  if (!sale || String(sale.memberId) !== UYE || sale.status !== 'open' || sale.paid.amount !== 0 || sale.total.amount !== TUTAR) return dur('satış beklenen durumda değil')
  if (!ent || ent.status !== 'active' || String(ent.memberId) !== UYE || ent.productSnapshot.name !== 'Fitness - 3 Aylık') return dur('paket beklenen durumda değil')
  const line = sale.lines[0]!
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`paket : ${d(Number(ent.validFrom))}→${d(Number(ent.validUntil))}  ⇒  ${d(BASLANGIC)}→${d(BASLANGIC + 90 * DAY)}`)
  console.log(`satış : ${SATIS} (20.11, ödemesiz) iptal  ⇒  yeni "${line.description}" 8.500 ₺, 30.10 + nakit 8.500 ₺ Merkez Kasa`)
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  const a = await amendEntitlement({ repo: entRepo, clock: systemClock }, ctx, { entitlementId: PAKET as EntitlementId, patch: { validFrom: instant(BASLANGIC), validUntil: instant(BASLANGIC + 90 * DAY) }, reason: SEBEP })
  if (!a.ok) return dur(`paket: ${JSON.stringify(a.error)}`)
  console.log('✅ paket 30.10 → 28.01')
  const c = await cancelSale(deps, ctx, { saleId: SATIS, reason: SEBEP })
  if (!c.ok) return dur(`satış iptal: ${JSON.stringify(c.error)}`)
  console.log('✅ bugünkü ödemesiz satış iptal')
  const op = newOperationId().slice(4)
  const s = await sell(deps, ctx, {
    saleId: `sal_${op}`, memberId: UYE as MemberId, branchId: sale.branchId as BranchId, soldAt: instant(ALINDI),
    lines: [{ ...line, entitlementId: PAKET as never }],
    discounts: [], discountCeilingPercent: null,
    payment: { paymentId: `pay_${op}`, allocationId: `alc_${op}`, amount: money(TUTAR), method: 'cash', receivedAt: instant(ALINDI), drawerId: KASA, giftCardCode: null, note: null },
  })
  if (!s.ok) return dur(`yeni satış: ${JSON.stringify(s.error)}`)
  console.log(`✅ satış + nakit 30.10: ${s.value.saleId}`)
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
