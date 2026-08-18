// "Hibrit Aylık — 2 Fitness + 1 Pilates" paketini ONLINE satışa aç.
//
//   pnpm tsx tools/migration/open-hybrid-online-2026-08.ts            (kuru çalışma)
//   pnpm tsx tools/migration/open-hybrid-online-2026-08.ts --apply
//
// WHY. The sales figures, read on 2026-08-18: this hybrid has sold 10 — more than the other three
// hybrids combined (3 + 3 + 2) — and it is the only one still selling (last 13 August; the others
// stopped on 24–28 July). It was also the only one NOT on the website and NOT open to online sale.
// The studio was advertising the three nobody buys and hiding the one that works.
//
// PRICE IS NOT TOUCHED. Its implied fitness-entry price (375 ₺) is already the one the other selling
// package uses, so there is nothing to correct here; the owner is still thinking about the rest.
//
// Routed through `updateProduct` rather than a Firestore write, so the change lands as a
// `product.updated` event with the platform_admin actor behind it — the catalogue is data, but it is
// still event-sourced data, and a hand-written field would leave no record of who opened the gate.

import {
  FirestoreCatalogRepository,
  systemClock,
  updateProduct,
  type CatalogDeps,
  type ProductId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const STUDIO = 'retro' as StudioId
const TARGET = 'Hibrit Aylık — 2 Fitness + 1 Pilates'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()

  const ctx: TenantContext = {
    studioId: STUDIO,
    branchIds: ['mutlukent' as never],
    role: 'owner',
    actor: { type: 'platform_admin', id: 'open-hybrid-online' as never },
  }
  const deps: CatalogDeps = { repo: new FirestoreCatalogRepository(db), clock: systemClock }

  const snap = await db.collection(`studios/${STUDIO}/products`).get()
  const hit = snap.docs.find((d) => String(d.data().name) === TARGET)
  if (!hit) {
    console.error(`✗ "${TARGET}" bulunamadı.`)
    process.exit(1)
  }

  const p = await deps.repo.getProduct(ctx, hit.id as ProductId)
  if (!p) {
    console.error('✗ ürün okunamadı.')
    process.exit(1)
  }

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')
  console.log(`${p.name}`)
  console.log(`  fiyat            : ${(p.priceInKurus / 100).toLocaleString('tr-TR')} ₺  (değişmiyor)`)
  console.log(`  online satış     : ${p.onlineSellable ? 'AÇIK' : 'kapalı'} → AÇIK`)
  console.log(`  üye uygulaması   : ${p.memberSellable ? 'AÇIK' : 'kapalı'} → AÇIK`)

  if (p.onlineSellable && p.memberSellable) {
    console.log('\nZaten açık — yapılacak bir şey yok.')
    process.exit(0)
  }
  if (!apply) {
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }

  // Every other field is passed through unchanged. `updateProduct` takes the whole product, so
  // omitting one would silently clear it.
  const r = await updateProduct(deps, ctx, {
    productId: p.id,
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
    active: true,
    onlineSellable: true,
    memberSellable: true,
  })
  if (!r.ok) {
    console.error(`✗ güncellenemedi: ${r.error.code}`)
    process.exit(1)
  }
  console.log('\n✓ Açıldı. /uyelik sayfasında ve üye uygulamasında görünür.')
  process.exit(0)
}

void main()
