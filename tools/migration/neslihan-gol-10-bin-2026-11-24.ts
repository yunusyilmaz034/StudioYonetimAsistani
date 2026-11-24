import {
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  amendEntitlement,
  cancelSale,
  collect,
  instant,
  money,
  newOperationId,
  sell,
  systemClock,
  voidPayment,
  type BranchId,
  type EntitlementId,
  type FinanceDeps,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// NESLİHAN GÖL — REFORMER 16 DERS 8.000 DEĞİL 10.000 ₺; 2.400 NAKİT (16.11) + 7.600 KK (bugün), borçsuz
// (owner, 2026-11-24).
//
//   pnpm tsx tools/migration/neslihan-gol-10-bin-2026-11-24.ts [--apply]
//
// Telafi (satış düzenlenmez, iptal edilip yeniden satılır):
//   1 · iptal: 2.400 nakit ödeme (16.11) ve 8.000 satış (sebepli)
//   2 · aynı paket satırı 10.000 ₺, aynı an (16.11) + 2.400 nakit aynı an, aynı kasa, aynı pakete bağlı
//   3 · 7.600 KK bugün, yeni satışa
//   4 · paketin anlaşılan tutarı 8.000 → 10.000 (amend). Tarihlere ve derslere dokunulmaz.
const STUDIO = 'retro'
const RUN = 'neslihan-gol-10-bin-2026-11-24'
const UYE = 'mem_01M39ZJ48SF9D39YT1TAHHS1M5'
const ODEME = 'pay_01M7JP8FMXJJ01BC1XJ3GFQK2X'
const SATIS = 'sal_01M7JP8FMXJJ01BC1XJ3GFQK2X'
const PAKET = 'ent_01M7JP8FNQVE7SE72DY8Q4K2BK'
const KASA = 'drw_01KXGHV45ZJ91XCHHSNGN7A00H' // Merkez Kasa
const FIYAT = 1_000_000
const NAKIT = 240_000
const KART = 760_000
const SEBEP = 'Reformer 16 ders fiyatı 8.000 değil 10.000 ₺; 2.400 nakit + 7.600 KK (owner, 24.11.2026).'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin' } as unknown as TenantContext
  const deps: FinanceDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock, source: 'migration' }
  const entRepo = new FirestoreEntitlementRepository(db)
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }

  const pay = await deps.repo.getPayment(ctx, ODEME)
  const sale = await deps.repo.getSale(ctx, SATIS)
  const ent = await entRepo.getEntitlement(ctx, PAKET as EntitlementId)
  if (!pay || pay.voided || pay.amount.amount !== NAKIT || pay.method !== 'cash') return dur('ödeme beklenen durumda değil')
  if (!sale || sale.status !== 'open' || sale.total.amount !== 800_000 || sale.paid.amount !== NAKIT || sale.memberId !== UYE) return dur('satış beklenen durumda değil')
  if (!ent || ent.status !== 'active' || ent.priceAgreed.amount !== 800_000) return dur('paket beklenen durumda değil')
  const line = sale.lines[0]!
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`iptal : ${ODEME} 2.400 nakit · ${SATIS} "${line.description}" 8.000`)
  console.log(`yeni  : 10.000 ₺ (16.11) + 2.400 nakit (16.11) + 7.600 KK (bugün); paket ${PAKET} 8.000→10.000`)
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  const v = await voidPayment(deps, ctx, { paymentId: ODEME, reason: SEBEP })
  if (!v.ok) return dur(`ödeme iptali: ${JSON.stringify(v.error)}`)
  const c = await cancelSale(deps, ctx, { saleId: SATIS, reason: SEBEP })
  if (!c.ok) return dur(`satış iptali: ${JSON.stringify(c.error)}`)
  const op = newOperationId().slice(4)
  const s = await sell(deps, ctx, {
    saleId: `sal_${op}`, memberId: UYE as MemberId, branchId: sale.branchId as BranchId, soldAt: sale.soldAt,
    lines: [{ ...line, unitPrice: money(FIYAT), entitlementId: PAKET as never }],
    discounts: [], discountCeilingPercent: null,
    payment: { paymentId: `pay_${op}`, allocationId: `alc_${op}`, amount: money(NAKIT), method: 'cash', receivedAt: pay.receivedAt, drawerId: pay.drawerId, giftCardCode: null, note: null, allowNoDrawer: pay.drawerId == null },
  })
  if (!s.ok) return dur(`yeni satış: ${JSON.stringify(s.error)}`)
  const op2 = newOperationId().slice(4)
  const k = await collect(deps, ctx, {
    paymentId: `pay_${op2}`, memberId: UYE as MemberId, branchId: sale.branchId as BranchId, amount: money(KART), method: 'credit_card',
    receivedAt: instant(systemClock.now()), drawerId: KASA, allowNoDrawer: true, giftCardCode: null, note: null,
    allocateTo: [{ saleId: s.value.saleId, amount: money(KART), allocationId: `alc_${op2}` }],
  })
  if (!k.ok) return dur(`7.600 KK: ${JSON.stringify(k.error)}`)
  const a = await amendEntitlement({ repo: entRepo, clock: systemClock }, ctx, { entitlementId: PAKET as EntitlementId, patch: { priceAgreed: money(FIYAT) }, reason: SEBEP })
  if (!a.ok) return dur(`paket tutarı: ${JSON.stringify(a.error)}`)
  const yeni = await deps.repo.getSale(ctx, s.value.saleId)
  console.log(`✅ ${s.value.saleId}: toplam ${yeni?.total.amount} · ödenen ${yeni?.paid.amount} · durum ${yeni?.status}`)
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
