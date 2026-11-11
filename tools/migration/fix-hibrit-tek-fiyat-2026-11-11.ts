import { FirestoreCatalogRepository, systemClock, updateProduct, type ProductId, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// HİBRİT TEK FİYAT (owner, 2026-11-11: "2 pilates 1 fitness 6850 tl … 5850 tl yani evet … kk peşin aynı
// tek fiyat … ai da aynı şekilde söylesin").
//
//   pnpm tsx tools/migration/fix-hibrit-tek-fiyat-2026-11-11.ts            (kuru çalışma)
//   pnpm tsx tools/migration/fix-hibrit-tek-fiyat-2026-11-11.ts --apply
//
// Katalog `updateProduct` ile (product.updated olayı). Nakit fiyat null = kart fiyatıyla aynı (tek fiyat).
// AI fiyat listesine HİBRİT bölümü eklenir; "listede olmayan paketler" satırı diğer hibritleri kapsar.

const STUDIO = 'retro'
const RUN = 'fix-hibrit-tek-fiyat-2026-11-11'

const CHANGES = [
  { name: 'Hibrit Aylık — 2 Pilates + 1 Fitness', cardFrom: 715_000, cashFrom: 650_000, to: 685_000 },
  { name: 'Hibrit Aylık — 2 Fitness + 1 Pilates', cardFrom: 550_000, cashFrom: 500_000, to: 585_000 },
] as const

const AI_ANCHOR = 'KREDİ KARTI / NAKİT / TAKSİT SORULURSA'
const AI_SECTION = `HİBRİT (aylık, 30 gün — fitness ve reformer pilates bir arada)
- Hibrit Aylık — 2 Pilates + 1 Fitness: 6.850 TL
- Hibrit Aylık — 2 Fitness + 1 Pilates: 5.850 TL

`
const AI_OLD_LINE = 'BU LİSTEDE OLMAYAN PAKETLER (Hibrit paketler, 16 derslik pilates, 1–2 aylık fitness vb.)'
const AI_NEW_LINE = 'BU LİSTEDE OLMAYAN PAKETLER (diğer hibrit paketler, 16 derslik pilates, 1–2 aylık fitness vb.)'

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

  const plan: { id: ProductId; name: string; to: number }[] = []
  for (const c of CHANGES) {
    const found = await db.collection(`studios/${STUDIO}/products`).where('name', '==', c.name).get()
    if (found.size !== 1) return dur(`"${c.name}" için ${found.size} ürün bulundu, 1 bekleniyordu.`)
    const d = found.docs[0]!
    const card = Number(d.get('priceInKurus'))
    const cash = (d.get('cashPriceInKurus') as number | null | undefined) ?? null
    if (card !== c.cardFrom || cash !== c.cashFrom) return dur(`${c.name}: kart ${tl(card)} / nakit ${tl(cash)} — beklenen ${tl(c.cardFrom)} / ${tl(c.cashFrom)}.`)
    console.log(`${c.name}  (${d.id})\n  kart  : ${tl(card)} → ${tl(c.to)}\n  nakit : ${tl(cash)} → aynı (tek fiyat)`)
    plan.push({ id: d.id as ProductId, name: c.name, to: c.to })
  }

  const aiRef = db.doc(`studios/${STUDIO}/settings/ai`)
  const priceList = String((await aiRef.get()).get('priceList') ?? '')
  if (priceList.split(AI_ANCHOR).length !== 2) return dur(`AI listesinde "${AI_ANCHOR}" 1 kez bekleniyordu.`)
  if (priceList.split(AI_OLD_LINE).length !== 2) return dur(`AI listesinde "${AI_OLD_LINE}" 1 kez bekleniyordu.`)
  if (priceList.includes('HİBRİT (aylık')) return dur('AI listesinde HİBRİT bölümü zaten var.')
  const next = priceList.replace(AI_ANCHOR, AI_SECTION + AI_ANCHOR).replace(AI_OLD_LINE, AI_NEW_LINE)
  console.log(`\nAI fiyat listesine eklenecek:\n${AI_SECTION}"${AI_OLD_LINE}" → "${AI_NEW_LINE}"`)

  if (!apply) {
    console.log('\nUygulamak için --apply')
    process.exit(0)
  }
  for (const p of plan) {
    const current = await deps.repo.getProduct(ctx, p.id)
    if (!current) return dur(`${p.name} okunamadı.`)
    const r = await updateProduct(deps, ctx, { ...current, productId: p.id, priceInKurus: p.to, cashPriceInKurus: null })
    if (!r.ok) return dur(`${p.name}: ${JSON.stringify(r.error)}`)
    console.log(`✓ ${p.name} güncellendi (product.updated yazıldı)`)
  }
  await aiRef.set({ priceList: next }, { merge: true })
  console.log('✓ AI fiyat listesi güncellendi')
  process.exit(0)
}

void main()
