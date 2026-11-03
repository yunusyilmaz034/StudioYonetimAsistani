import { FirestoreCatalogRepository, systemClock, updateProduct, type ProductId, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// FİYAT EŞİTLEME (owner, 2026-11-03).
//
//   pnpm tsx tools/migration/fix-fiyat-fitness6-pilates8-2026-11-03.ts            (kuru çalışma)
//   pnpm tsx tools/migration/fix-fiyat-fitness6-pilates8-2026-11-03.ts --apply
//
// Kontrol (3 Kasım gece) üç kaynak buldu: katalog, AI fiyat listesi (`settings/ai.priceList`, elle
// yazılmış metin) ve site (katalogdan okur). İki fark var, owner hükmü:
//   1. Fitness 6 Aylık — AI 13.000 diyor, katalog nakdi 12.750. Owner: *"ai doğru"* → nakit 13.000
//      (kart 14.000 aynı kalır).
//   2. Reformer Pilates 8 Ders — owner: *"pilates 8 ders 5000 tl olmuş"*. Kart zaten 5.000; nakit 4.200
//      KALDIRILIR (null = kart fiyatıyla aynı) ve AI listesindeki 4.200 → 5.000.
//
// Katalog `updateProduct` ile değişir — `product.updated` olayı, eski/yeni değerleriyle, aynı yazımda.
// Elle belge yazımı değil (CLAUDE.md: kayıtsız düzeltme yok).

const STUDIO = 'retro'
const RUN = 'fix-fiyat-2026-11-03'

const CHANGES = [
  { name: 'Fitness - 6 Aylık', card: 1_400_000, cashFrom: 1_275_000, cashTo: 1_300_000 as number | null },
  { name: 'Reformer Pilates - 8 Ders', card: 500_000, cashFrom: 420_000, cashTo: null as number | null },
] as const

const AI_OLD = '- Aylık Üyelik — 8 Ders / 30 Gün: 4.200 TL'
const AI_NEW = '- Aylık Üyelik — 8 Ders / 30 Gün: 5.000 TL'

const tl = (k: number | null): string => (k == null ? 'yok (kart fiyatı)' : `${(k / 100).toLocaleString('tr-TR')} ₺`)

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: [],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const deps = { repo: new FirestoreCatalogRepository(db), clock: systemClock }
  const dur = (m: string): never => {
    console.error(`DUR: ${m}`)
    process.exit(1)
  }

  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA (hiçbir şey yazılmaz) ──\n')

  const plan: { id: ProductId; name: string; cashTo: number | null }[] = []
  for (const c of CHANGES) {
    const found = await db.collection(`studios/${STUDIO}/products`).where('name', '==', c.name).get()
    if (found.size !== 1) return dur(`"${c.name}" için ${found.size} ürün bulundu, 1 bekleniyordu.`)
    const d = found.docs[0]!
    const card = Number(d.get('priceInKurus'))
    const cash = (d.get('cashPriceInKurus') as number | null | undefined) ?? null
    if (card !== c.card) return dur(`${c.name}: kart ${tl(card)}, beklenen ${tl(c.card)}.`)
    if (cash !== c.cashFrom) return dur(`${c.name}: nakit ${tl(cash)}, beklenen ${tl(c.cashFrom)} — biri değiştirmiş, bak.`)
    console.log(`${c.name}  (${d.id})`)
    console.log(`  kart  : ${tl(card)}  (değişmiyor)`)
    console.log(`  nakit : ${tl(cash)}  →  ${tl(c.cashTo)}`)
    plan.push({ id: d.id as ProductId, name: c.name, cashTo: c.cashTo })
  }

  const aiRef = db.doc(`studios/${STUDIO}/settings/ai`)
  const priceList = String((await aiRef.get()).get('priceList') ?? '')
  const count = priceList.split(AI_OLD).length - 1
  if (count !== 1) return dur(`AI fiyat listesinde "${AI_OLD}" ${count} kez geçiyor, 1 bekleniyordu.`)
  console.log(`\nAI fiyat listesi:\n  ${AI_OLD}\n  →\n  ${AI_NEW}`)

  if (!apply) {
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }

  for (const p of plan) {
    const current = await deps.repo.getProduct(ctx, p.id)
    if (!current) return dur(`${p.name} okunamadı.`)
    const r = await updateProduct(deps, ctx, { ...current, productId: p.id, cashPriceInKurus: p.cashTo })
    if (!r.ok) return dur(`${p.name}: ${JSON.stringify(r.error)}`)
    console.log(`✓ ${p.name} güncellendi (product.updated yazıldı)`)
  }
  await aiRef.set({ priceList: priceList.replace(AI_OLD, AI_NEW) }, { merge: true })
  console.log('✓ AI fiyat listesi güncellendi')
  process.exit(0)
}

void main()
