// `tsx tools/setup/bundles.ts` — create the two HYBRID (hibrit demet) products through the product's
// own domain path (createProduct → decide → transact → event), never by hand-writing Firestore. A
// bundle grants one entitlement per component, each in its own category, so the wall (I-9.7) holds.
//
// Idempotent by NAME: reads what exists, upserts. Manual, admin-only, never in CI. Actor is
// platform_admin — a terminal setup act, logged as itself, never borrowing a human's identity (#5).
import {
  createProduct,
  FirestoreCatalogRepository,
  systemClock,
  updateProduct,
  type CatalogDeps,
  type Category,
  type ProductComponent,
  type ProductId,
  type ServiceId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-sos'
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.ALLOW_PRODUCTION) {
  console.error('Refusing to run against production without ALLOW_PRODUCTION=1.')
  process.exit(1)
}

const STUDIO = (process.argv[2] ?? 'retro') as StudioId
const BRANCH = process.argv[3] ?? 'mutlukent'
const TRY = (lira: number) => lira * 100

async function main(): Promise<void> {
  initializeApp({ projectId: PROJECT })
  const db: Firestore = getFirestore()

  const ctx: TenantContext = {
    studioId: STUDIO,
    branchIds: [BRANCH as never],
    role: 'owner',
    actor: { type: 'platform_admin', id: 'setup' as never },
  }
  const deps: CatalogDeps = { repo: new FirestoreCatalogRepository(db), clock: systemClock }

  // Resolve the pilates + fitness services by name (both must exist; run setup:catalog first).
  const services = await db.collection(`studios/${STUDIO}/services`).get()
  const byName = new Map(services.docs.map((d) => [String(d.data().name), d.id as ServiceId]))
  const reformerId = byName.get('Reformer Pilates')
  const fitnessId = byName.get('Fitness')
  if (!reformerId || !fitnessId) throw new Error('Reformer Pilates / Fitness ders türü bulunamadı — önce setup:catalog.')

  // A component carries a category + EITHER a credit count (N classes) OR an entry allowance (N door
  // check-ins). The bundle's own category/type is a representative face (display + KK surcharge).
  const BUNDLES: Array<{
    name: string
    category: Category
    type: 'credit' | 'period'
    priceInKurus: number
    components: ProductComponent[]
  }> = [
    {
      name: 'Hibrit Aylık — 2 Pilates + 1 Fitness',
      category: 'pilates_group',
      type: 'credit',
      priceInKurus: TRY(5_850),
      components: [
        { category: 'pilates_group', creditCount: 8, entryAllowance: null, label: '8 Pilates dersi' },
        { category: 'fitness', creditCount: null, entryAllowance: 4, label: '4 Fitness girişi' },
      ],
    },
    {
      name: 'Hibrit Aylık — 2 Fitness + 1 Pilates',
      category: 'fitness',
      type: 'period',
      priceInKurus: TRY(5_000),
      components: [
        { category: 'fitness', creditCount: null, entryAllowance: 8, label: '8 Fitness girişi' },
        { category: 'pilates_group', creditCount: 4, entryAllowance: null, label: '4 Pilates dersi' },
      ],
    },
  ]

  const productDocs = await db.collection(`studios/${STUDIO}/products`).get()
  const idByName = new Map(productDocs.docs.map((d) => [String(d.data().name), d.id as ProductId]))

  for (const b of BUNDLES) {
    const fields = {
      name: b.name,
      category: b.category,
      serviceIds: [reformerId, fitnessId] as ServiceId[],
      type: b.type,
      durationDays: 30,
      creditCount: null,
      priceInKurus: b.priceInKurus,
      freezeAllowanceDays: 0,
      dailyReservationLimit: null,
      cancellationAllowanceCount: null,
      activeReservationLimit: null,
      entryAllowance: null,
      components: b.components,
      description: '',
    }
    const priceTL = (b.priceInKurus / 100).toLocaleString('tr-TR')
    const existingId = idByName.get(b.name)
    if (existingId) {
      const r = await updateProduct(deps, ctx, { ...fields, productId: existingId, active: true })
      if (!r.ok) throw new Error(`${b.name} güncellenemedi: ${r.error.code}`)
      console.log(`  ~ ${b.name} → ${priceTL} ₺ (güncellendi)`)
    } else {
      const r = await createProduct(deps, ctx, fields)
      if (!r.ok) throw new Error(`${b.name} oluşturulamadı: ${r.error.code}`)
      console.log(`  + ${b.name} → ${priceTL} ₺ (oluşturuldu: ${r.value.productId})`)
    }
  }
  console.log('Hibrit demet paketleri hazır.')
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
