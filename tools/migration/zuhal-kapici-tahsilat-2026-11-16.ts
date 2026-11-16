import {
  FirestoreFinanceRepository,
  collect,
  money,
  newOperationId,
  systemClock,
  voidPayment,
  type BranchId,
  type FinanceDeps,
  type MemberId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// ZUHAL KAPICI — 4.500 ₺ DEĞİL 1.000 ₺ ALINDI (owner, 2026-11-16: "4500 değil 1000 tl alınmış 3500 borcu var").
//
//   pnpm tsx tools/migration/zuhal-kapici-tahsilat-2026-11-16.ts            (kuru çalışma)
//   pnpm tsx tools/migration/zuhal-kapici-tahsilat-2026-11-16.ts --apply
//
// 14.11'deki satış (Reformer 8 ders, 4.500 ₺) tam ödenmiş gibi nakit tahsilatla yazıldı. Tahsilat yerinde
// değiştirilmez (#9): 4.500 ₺ iptal (sebepli), aynı an + aynı kasa ile 1.000 ₺ nakit yeniden yazılır ve
// aynı satışa bağlanır. Satış dokunulmaz: 4.500 ₺, ödenen 1.000, borç 3.500.

const STUDIO = 'retro'
const RUN = 'zuhal-kapici-tahsilat-2026-11-16'
const UYE = 'mem_01M7D2W8YNT8PKSS8G6D7S4HES'
const SATIS = 'sal_01M7D2X1A1GES1PKPY420GGR8H'
const ESKI = 'pay_01M7D2X1A1GES1PKPY420GGR8H'
const DOGRU = 100_000
const SEBEP = 'Tutar yanlış girildi: 4.500 ₺ değil 1.000 ₺ nakit alındı; 3.500 ₺ borç (owner, 16.11).'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], correlationId: RUN, source: 'migration', role: 'platform_admin',
  } as unknown as TenantContext
  const deps: FinanceDeps = { repo: new FirestoreFinanceRepository(db), clock: systemClock, source: 'migration' }
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }

  const sale = await deps.repo.getSale(ctx, SATIS)
  const pay = await deps.repo.getPayment(ctx, ESKI)
  if (!sale || sale.status === 'cancelled' || String(sale.memberId) !== UYE || sale.total.amount !== 450_000) return dur('satış beklenen durumda değil')
  if (!pay || pay.voided || pay.amount.amount !== 450_000 || pay.method !== 'cash') return dur('tahsilat beklenen durumda değil')
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`iptal   : ${ESKI} 4.500 ₺ nakit`)
  console.log(`yeniden : 1.000 ₺ nakit, ${new Date(pay.receivedAt as number).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}, kasa ${pay.drawerId}, satış ${SATIS}`)
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  const v = await voidPayment(deps, ctx, { paymentId: ESKI, reason: SEBEP })
  if (!v.ok) return dur(`iptal: ${JSON.stringify(v.error)}`)
  console.log('✅ 4.500 ₺ tahsilat iptal edildi')

  const op = newOperationId().slice(4)
  const c = await collect(deps, ctx, {
    paymentId: `pay_${op}`,
    memberId: UYE as MemberId,
    branchId: sale.branchId as BranchId,
    amount: money(DOGRU),
    method: 'cash',
    receivedAt: pay.receivedAt,
    drawerId: pay.drawerId,
    giftCardCode: null,
    note: null,
    allowNoDrawer: pay.drawerId == null,
    allocateTo: [{ saleId: SATIS, amount: money(DOGRU), allocationId: `alc_${op}` }],
  })
  if (!c.ok) return dur(`tahsilat: ${JSON.stringify(c.error)}`)
  const after = await deps.repo.getSale(ctx, SATIS)
  console.log(`✅ satış ${after!.total.amount / 100} ₺, ödenen ${after!.paid.amount / 100} ₺, durum ${after!.status}`)
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
