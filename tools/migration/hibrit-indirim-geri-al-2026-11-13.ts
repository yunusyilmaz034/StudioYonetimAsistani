import {
  FirestoreFinanceRepository,
  correctDiscount,
  money,
  systemClock,
  type FinanceDeps,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// YANLIŞLIKLA GİRİLEN 500 ₺ İNDİRİMİN GERİ ALINMASI (owner, 2026-11-13: "500 tl tahsilat almaktı düzelt").
//
//   pnpm tsx tools/migration/hibrit-indirim-geri-al-2026-11-13.ts            (kuru çalışma)
//   pnpm tsx tools/migration/hibrit-indirim-geri-al-2026-11-13.ts --apply
//
// 13.11 17:33'te 500 ₺ nakit tahsilatın hemen ardından aynı satışa 500 ₺ "hediye" indirimi girildi.
// Niyet yalnız tahsilattı. İndirim silinmez (#9) — `sale.discount_corrected` ile geri alınır:
// satış 4.500 → 5.000 ₺, tahsilat (500 ₺) olduğu gibi kalır, borç 4.500 ₺.

const STUDIO = 'retro'
const RUN = 'hibrit-indirim-geri-al-2026-11-13'
const SATIS = 'sal_01M77KXM3PM70QZR9AZPYMVJ1P'
const UYE = 'mem_01KXN38X1FVXDF8E4ZEKTH7VJW'
const TUTAR = 50_000
const NOT = 'İndirim yanlışlıkla girildi; niyet yalnız 500 ₺ tahsilattı (owner, 13.11).'

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
  if (!sale || sale.status === 'cancelled' || String(sale.memberId) !== UYE) return dur('satış beklenen durumda değil')
  if (sale.total.amount !== 450_000 || sale.paid.amount !== 50_000) return dur(`tutarlar beklenmiyor: ${sale.total.amount}/${sale.paid.amount}`)
  if ((sale.discountCorrections ?? []).length > 0) return dur('zaten düzeltilmiş')
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`indirim geri alınıyor: ${TUTAR / 100} ₺ → satış 5.000 ₺, ödenen 500 ₺, borç 4.500 ₺`)
  if (!apply) return console.log('\nkuru çalışma — hiçbir şey yazılmadı')

  const r = await correctDiscount(deps, ctx, {
    saleId: SATIS,
    correction: { reason: 'other', amount: money(TUTAR), note: NOT, correctedBy: ctx.actor },
  })
  if (!r.ok) return dur(JSON.stringify(r.error))
  const after = await deps.repo.getSale(ctx, SATIS)
  console.log(`✅ satış ${after!.total.amount / 100} ₺, ödenen ${after!.paid.amount / 100} ₺, durum ${after!.status}`)
  process.exit(0)
}
void main().catch((e) => { console.error(e); process.exit(1) })
