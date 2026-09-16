import { FirestoreCatalogRepository, systemClock, updateProduct, type CatalogDeps, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// FITNESS 1 VE 2 AYLIK — AI FİYAT VERMESİN (owner, 2026-09-16).
//
//   pnpm exec tsx tools/migration/ai-hide-fitness-short-2026-09-16.ts            (kuru çalışma)
//   pnpm exec tsx tools/migration/ai-hide-fitness-short-2026-09-16.ts --apply
//
// Owner: *"AI fitness 1 aylık paket vermesin, o stüdyoda resepsiyona özgü bundan hiç bahsetmesin; fitness 3 aylık,
// 6 aylık ve 12 aylık olarak fiyat verebilir."* 2 aylık da aynı kapsamda (owner onayı). Paketler katalogda kalır,
// resepsiyon satmaya devam eder — değişen tek şey AI'ın gördüğü liste. Domain yolundan geçer, `product.updated` yazar.

const STUDIO = 'retro'
const RUN = 'ai-hide-fitness-short-2026-09-16'
const HEDEFLER = ['Fitness - 1 Aylık', 'Fitness - 2 Aylık']

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], role: 'platform_admin' } as unknown as TenantContext
  const deps: CatalogDeps = { repo: new FirestoreCatalogRepository(db), clock: systemClock }
  const products = await deps.repo.listProducts(ctx)
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  for (const hedef of HEDEFLER) {
    const p = products.find((x) => x.name === hedef)
    if (!p) {
      console.log(`${hedef}: BULUNAMADI`)
      continue
    }
    console.log(`${hedef}: aiQuotable ${p.aiQuotable === false ? 'kapalı (dokunulmayacak)' : 'açık → kapatılacak'}`)
    if (!apply || p.aiQuotable === false) continue
    const r = await updateProduct(deps, ctx, {
      productId: p.id,
      active: p.active,
      name: p.name,
      category: p.category,
      serviceIds: p.serviceIds,
      type: p.type,
      durationDays: p.durationDays,
      creditCount: p.creditCount,
      priceInKurus: p.priceInKurus,
      cashPriceInKurus: p.cashPriceInKurus,
      freezeAllowanceDays: p.freezeAllowanceDays,
      dailyReservationLimit: p.dailyReservationLimit,
      cancellationAllowanceCount: p.cancellationAllowanceCount,
      activeReservationLimit: p.activeReservationLimit,
      entryAllowance: p.entryAllowance,
      components: p.components,
      description: p.description,
      onlineSellable: p.onlineSellable,
      memberSellable: p.memberSellable,
      aiQuotable: false,
    })
    console.log(r.ok ? `  → kapatıldı` : `  → HATA: ${r.error.code}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
