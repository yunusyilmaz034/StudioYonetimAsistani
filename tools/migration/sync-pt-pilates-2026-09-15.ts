import {
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  countEntitlementsOffProduct,
  syncEntitlementsToProduct,
  systemClock,
  type ProductId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// "PT PİLATES 6 AY" SATILMIŞ PAKETLERİNİ ÜRÜNLE EŞİTLE (owner onayı, 2026-09-15).
//
//   pnpm exec tsx tools/migration/sync-pt-pilates-2026-09-15.ts            (kuru çalışma)
//   pnpm exec tsx tools/migration/sync-pt-pilates-2026-09-15.ts --apply
//
// Ürün 17:54'te pilates grup kategorisiyle oluşturuldu, 18:03'te HALE HAZAL ATİLA ve İLAYDA BENARDETE'ye satıldı,
// 18:21'de PT'ye düzeltildi. Kopya eski kategoride kaldı; iki üye PT seansına alınamadı. Domain yolundan geçer
// (`decideSyncSnapshotToProduct`), `entitlement.amended` sebebiyle yazılır, kredi/fiyat/süreye dokunmaz.

const STUDIO = 'retro'
const RUN = 'sync-pt-pilates-2026-09-15'
const PRODUCT = 'prd_01M2JS0DGK7CN56F0KVYHWXG1N'
const REASON = 'Ürün satıştan sonra (18:21) PT kategorisine düzeltildi; satış anındaki kopya pilates grupta kalmıştı. Owner onayı, 15.09.2026.'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = { studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: ['mutlukent'], role: 'platform_admin' } as unknown as TenantContext
  const product = await new FirestoreCatalogRepository(db).getProduct(ctx, PRODUCT as ProductId)
  if (!product) return console.log('ürün yok')
  const coverage = { productId: product.id, category: product.category, serviceIds: product.serviceIds }
  const deps = { repo: new FirestoreEntitlementRepository(db), clock: systemClock }
  console.log(apply ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`ürün: ${product.name} · kategori ${product.category}`)
  console.log('eşitlenecek paket:', await countEntitlementsOffProduct(deps, ctx, coverage))
  if (!apply) return
  const r = await syncEntitlementsToProduct(deps, ctx, { product: coverage, reason: REASON })
  console.log(r.ok ? `eşitlendi: ${r.value.synced}` : `HATA: ${r.error.code}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
