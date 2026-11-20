import {
  FirestoreFinanceRepository,
  collect,
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

// ZÜLEYHA TANIŞ — KK 15.500 ₺, PAKET 14.000 ₺: 1.500 ₺ TAKSİT FARKI (owner, 2026-11-20: "1 olacak, borcu alacağı yok").
//
//   pnpm tsx tools/migration/zuleyha-tanis-taksit-farki-2026-11-20.ts [--apply]
//
// Ödeme 15.500, satış 14.000 → 1.500 ₺ hiçbir satışa bağlı değildi (üye alacağı gibi duruyordu). Var olan bir ödemenin
// artanını yeni bir satışa bağlayan use case yok; mevcut telafi yolu: ödeme iptal (sebepli) → "Kart taksit farkı"
// 1.500 ₺ satış (aynı an) → aynı ödeme yeniden (15.500 KK, aynı an), iki satışa bağlanır. Kasa/gün etkisi: tahsilat net 0,
// satış +1.500 (bugün).

const STUDIO = 'retro'
const RUN = 'zuleyha-tanis-taksit-farki-2026-11-20'
const ODEME = 'pay_01M7WEZRABTKJ4AB5MRYMVM8EA'
const PAKET_SATIS = 'sal_01M7WEZRABTKJ4AB5MRYMVM8EA'
const FARK = 150_000
const SEBEP = 'KK 15.500 ₺ çekildi, paket 14.000 ₺: 1.500 ₺ kart taksit farkı ayrı satışa bağlanıyor (owner, 20.11.2026).'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin' } as unknown as TenantContext
  const deps: FinanceDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock, source: 'migration' }
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }

  const pay = await deps.repo.getPayment(ctx, ODEME)
  const sale = await deps.repo.getSale(ctx, PAKET_SATIS)
  if (!pay || pay.voided || pay.amount.amount !== 1_550_000 || pay.allocated.amount !== 1_400_000 || pay.method !== 'credit_card') return dur('ödeme beklenen durumda değil')
  if (!sale || sale.status !== 'settled' || sale.total.amount !== 1_400_000 || String(sale.memberId) !== String(pay.memberId)) return dur('paket satışı beklenen durumda değil')
  const uye = String(pay.memberId)
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`iptal   : ${ODEME} 15.500 KK`)
  console.log(`satış   : "Kart taksit farkı" 1.500 ₺ (aynı an)`)
  console.log(`yeniden : 15.500 KK → 14.000 paket + 1.500 fark`)
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  const v = await voidPayment(deps, ctx, { paymentId: ODEME, reason: SEBEP })
  if (!v.ok) return dur(`iptal: ${JSON.stringify(v.error)}`)
  const op = newOperationId().slice(4)
  const s = await sell(deps, ctx, {
    saleId: `sal_${op}`, memberId: uye as MemberId, branchId: sale.branchId as BranchId, soldAt: pay.receivedAt,
    lines: [{ productId: null as never, description: 'Kart taksit farkı', quantity: 1, unitPrice: money(FARK), entitlementId: null, giftCardId: null }],
    discounts: [], discountCeilingPercent: null, payment: null,
  })
  if (!s.ok) return dur(`fark satışı: ${JSON.stringify(s.error)}`)
  const op2 = newOperationId().slice(4)
  const c = await collect(deps, ctx, {
    paymentId: `pay_${op2}`, memberId: uye as MemberId, branchId: sale.branchId as BranchId, amount: money(1_550_000), method: 'credit_card',
    receivedAt: pay.receivedAt, drawerId: pay.drawerId, giftCardCode: null, note: null, allowNoDrawer: pay.drawerId == null,
    allocateTo: [
      { saleId: PAKET_SATIS, amount: money(1_400_000), allocationId: `alc_${op2}a` },
      { saleId: s.value.saleId, amount: money(FARK), allocationId: `alc_${op2}b` },
    ],
  })
  if (!c.ok) return dur(`yeniden tahsilat: ${JSON.stringify(c.error)}`)
  console.log(`✅ tamam — artan: ${c.value.unallocated / 100} ₺`)
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
