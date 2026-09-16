import { FirestoreCatalogRepository, systemClock, updateProduct, type CatalogDeps, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// "PT PİLATES 6 AY" HİÇBİR YERDE AÇIK OLMASIN (owner, 2026-09-16).
//
//   pnpm exec tsx tools/migration/pt-pilates-desk-only-2026-09-16.ts            (kuru çalışma)
//   pnpm exec tsx tools/migration/pt-pilates-desk-only-2026-09-16.ts --apply
//
// Üç kapı birden kapanıyor: AI fiyat veremez, public satış sayfasında görünmez, üye uygulamadan satın alamaz.
// Paket AKTİF kalır — resepsiyon satmaya devam eder ve paketi olan iki üyenin hakkı etkilenmez.

const STUDIO = 'retro'
const RUN = 'pt-pilates-desk-only-2026-09-16'
const HEDEF = 'PT PİLATES 6 AY'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], role: 'platform_admin' } as unknown as TenantContext
  const deps: CatalogDeps = { repo: new FirestoreCatalogRepository(db), clock: systemClock }
  const p = (await deps.repo.listProducts(ctx)).find((x) => x.name === HEDEF)
  if (!p) return console.log(`${HEDEF}: BULUNAMADI`)

  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`${p.name}: aktif ${p.active} · AI ${p.aiQuotable === false ? 'kapalı' : 'açık'} · public ${p.onlineSellable} · üye ${p.memberSellable}`)
  if (!apply) return console.log('kuru çalışma — yazılmadı')

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
    onlineSellable: false,
    memberSellable: false,
    aiQuotable: false,
  })
  console.log(r.ok ? 'kapatıldı: AI · public satış · üye satışı' : `HATA: ${r.error.code}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
