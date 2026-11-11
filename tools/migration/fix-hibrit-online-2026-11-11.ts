import { FirestoreCatalogRepository, systemClock, updateProduct, type ProductId, type TenantContext } from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// HİBRİT ONLINE (owner, 2026-11-11: "hibrit 3 aylık ve 2 aylık ı kaldır, online ve client da olmasın,
// 1 fitness 1 pilatesi de 5 bin tl tek fiyat yap").
//   · Hibrit 3 Aylık ve Hibrit 2 Aylık: online site ve üye uygulamasından KALKAR (paket aktif kalır —
//     panelde satılabilir, eski satışlar ve üyelikler etkilenmez).
//   · Hibrit Aylık 1+1: 5.000 ₺ tek fiyat (nakit = kart); AI listesindeki HİBRİT bölümüne eklenir.
//
//   pnpm tsx tools/migration/fix-hibrit-online-2026-11-11.ts            (kuru çalışma)
//   pnpm tsx tools/migration/fix-hibrit-online-2026-11-11.ts --apply

const STUDIO = 'retro'
const RUN = 'fix-hibrit-online-2026-11-11'
const OFFLINE = ['Hibrit 3 Aylık — 1Fitness + 2Pilates', 'Hibrit 2 Aylık — 2Fitness + 1Pilates'] as const
const ONE_ONE = { name: 'Hibrit Aylık — 1 Fitness + 1 Pilates', cardFrom: 500_000, cashFrom: 450_000, to: 500_000 }
const AI_AFTER = '- Hibrit Aylık — 2 Fitness + 1 Pilates: 5.850 TL\n'
const AI_ADD = '- Hibrit Aylık — 1 Fitness + 1 Pilates: 5.000 TL\n'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO, actor: { type: 'platform_admin', id: `migration:${RUN}` }, branchIds: [], correlationId: RUN, source: 'migration', role: 'platform_admin',
  } as unknown as TenantContext
  const deps = { repo: new FirestoreCatalogRepository(db), clock: systemClock }
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }
  const one = async (name: string) => {
    const f = await db.collection(`studios/${STUDIO}/products`).where('name', '==', name).get()
    if (f.size !== 1) return dur(`"${name}" için ${f.size} ürün bulundu, 1 bekleniyordu.`)
    return f.docs[0]!
  }
  console.log(apply ? '── UYGULANIYOR ──\n' : '── KURU ÇALIŞMA ──\n')

  const off: ProductId[] = []
  for (const n of OFFLINE) {
    const d = await one(n)
    console.log(`${n}: online ${d.get('onlineSellable')} → false · üye uygulaması ${d.get('memberSellable')} → false (aktif kalır)`)
    off.push(d.id as ProductId)
  }
  const d11 = await one(ONE_ONE.name)
  if (Number(d11.get('priceInKurus')) !== ONE_ONE.cardFrom || (d11.get('cashPriceInKurus') ?? null) !== ONE_ONE.cashFrom) return dur(`${ONE_ONE.name}: fiyat beklenenden farklı.`)
  console.log(`${ONE_ONE.name}: kart 5.000 → 5.000 · nakit 4.500 → aynı (tek fiyat)`)

  const aiRef = db.doc(`studios/${STUDIO}/settings/ai`)
  const pl = String((await aiRef.get()).get('priceList') ?? '')
  if (pl.split(AI_AFTER).length !== 2) return dur('AI listesinde HİBRİT 2F+1P satırı 1 kez bekleniyordu.')
  if (pl.includes(AI_ADD.trim())) return dur('AI listesinde 1+1 satırı zaten var.')
  console.log(`AI fiyat listesine: ${AI_ADD.trim()}`)
  if (!apply) { console.log('\nUygulamak için --apply'); process.exit(0) }

  for (const id of off) {
    const cur = await deps.repo.getProduct(ctx, id)
    if (!cur) return dur(`${id} okunamadı`)
    const r = await updateProduct(deps, ctx, { ...cur, productId: id, onlineSellable: false, memberSellable: false })
    if (!r.ok) return dur(`${id}: ${JSON.stringify(r.error)}`)
    console.log(`✓ ${cur.name}: online ve uygulamadan kaldırıldı`)
  }
  const cur11 = await deps.repo.getProduct(ctx, d11.id as ProductId)
  if (!cur11) return dur('1+1 okunamadı')
  const r11 = await updateProduct(deps, ctx, { ...cur11, productId: d11.id as ProductId, priceInKurus: ONE_ONE.to, cashPriceInKurus: null })
  if (!r11.ok) return dur(`1+1: ${JSON.stringify(r11.error)}`)
  console.log('✓ 1+1 tek fiyat 5.000 ₺')
  await aiRef.set({ priceList: pl.replace(AI_AFTER, AI_AFTER + AI_ADD) }, { merge: true })
  console.log('✓ AI fiyat listesi güncellendi')
  process.exit(0)
}
void main()
