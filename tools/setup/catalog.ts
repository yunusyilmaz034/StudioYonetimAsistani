// `pnpm setup:catalog` — create the Fitness service and the four opening products, through the
// PRODUCT'S OWN domain path (createService / createProduct → decide → transact → event), never by
// hand-writing Firestore. B-2 is why: a state document written by hand proves nothing about the
// state the studio will actually have, and the invariants that guard the catalogue only run on the
// real path.
//
// Idempotent by NAME: it reads what exists first and skips anything already there, so a second run
// is a no-op rather than a duplicate. Manual, admin-only, never in CI.
//
// The actor is `platform_admin` — this is a setup act performed from a terminal, and the log must
// say so rather than borrow Işıl's identity (#5: every actor is a principal).
import {
  createProduct,
  createService,
  DEFAULT_STUDIO_CONFIG,
  FirestoreCatalogRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  systemClock,
  updateProduct,
  type CatalogDeps,
  type Category,
  type ProductId,
  type SchedulingDeps,
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

// A pilates service exists already; a fitness one does not, and every product must name at least one
// service (D12, `product_requires_service`). Fitness has no CLASS — a fitness membership is unlimited
// gym entry, resolved at check-in, not booked — but it still needs a service to anchor its category,
// so the category wall (I-9.7) has something to compare against.
const FITNESS_POLICY = {
  maxDaysInAdvance: 7,
  cancellationWindowHours: null, // inherit; fitness is never booked, so this never fires
  lateCancellationConsumesCredit: false,
  noShowConsumesCredit: false,
  attendanceDefaultOutcome: 'attended' as const,
  autoResolveAfterMinutes: 15,
  allowMemberSelfBooking: false, // there is nothing to self-book
}

// Money is an integer in kuruş (#10). 1 ₺ = 100 kuruş, so 4.200 ₺ = 420_000 kuruş. (The first run
// used `* 100_00` = ×10 000 and stored every price 100× too high — caught by reading the values back,
// never by writing them. Money paths get read-back verification for exactly this reason.)
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

  const catalogDeps: CatalogDeps = { repo: new FirestoreCatalogRepository(db), clock: systemClock }
  const schedRepo = new FirestoreSchedulingRepository(db)
  const schedDeps: SchedulingDeps = {
    repo: schedRepo,
    clock: systemClock,
    studioConfig: DEFAULT_STUDIO_CONFIG,
    hours: new FirestoreStudioHours(db),
  }

  // ── 1. Resolve the services by name (idempotent). ─────────────────────────────────────────
  const services = await db.collection(`studios/${STUDIO}/services`).get()
  const byName = new Map(services.docs.map((d) => [String(d.data().name), d.id as ServiceId]))
  const catByName = new Map(services.docs.map((d) => [String(d.data().name), String(d.data().category)]))

  const reformerId = findService(byName, catByName, 'Reformer Pilates', 'pilates_group')

  let fitnessId = byName.get('Fitness')
  if (fitnessId) {
    console.log(`  ✓ Fitness ders türü zaten var: ${fitnessId}`)
  } else {
    const r = await createService(schedDeps, ctx, {
      name: 'Fitness',
      category: 'fitness',
      policy: FITNESS_POLICY,
    })
    if (!r.ok) throw new Error(`Fitness ders türü oluşturulamadı: ${r.error.code}`)
    fitnessId = r.value.serviceId
    console.log(`  + Fitness ders türü oluşturuldu: ${fitnessId}`)
  }

  // ── 2. The four products. Upsert by name: create if new, correct-in-place if it already exists.
  // An update emits `product.updated` — an auditable price correction, never a silent overwrite.
  const productDocs = await db.collection(`studios/${STUDIO}/products`).get()
  const idByName = new Map(productDocs.docs.map((d) => [String(d.data().name), d.id as ProductId]))

  const PRODUCTS = [
    {
      name: 'Reformer Pilates - 8 Ders',
      category: 'pilates_group' as Category,
      serviceIds: [reformerId],
      type: 'credit' as const,
      creditCount: 8,
      durationDays: 30,
      priceInKurus: TRY(4_200),
      freezeAllowanceDays: 0,
    },
    {
      name: 'Reformer Pilates - 16 Ders',
      category: 'pilates_group' as Category,
      serviceIds: [reformerId],
      type: 'credit' as const,
      creditCount: 16,
      durationDays: 60,
      priceInKurus: TRY(7_800),
      freezeAllowanceDays: 0,
    },
    {
      name: 'Fitness - 3 Aylık',
      category: 'fitness' as Category,
      serviceIds: [fitnessId],
      type: 'period' as const,
      creditCount: null, // unlimited
      durationDays: 90,
      priceInKurus: TRY(8_000),
      freezeAllowanceDays: 7,
    },
    {
      name: 'Fitness - 6 Aylık',
      category: 'fitness' as Category,
      serviceIds: [fitnessId],
      type: 'period' as const,
      creditCount: null,
      durationDays: 180,
      priceInKurus: TRY(13_000),
      freezeAllowanceDays: 14,
    },
  ]

  for (const p of PRODUCTS) {
    const fields = {
      ...p,
      serviceIds: p.serviceIds as ServiceId[],
      // Package rules (Plus Phase 3) — null ⇒ unlimited. The studio sets real numbers per package in
      // the catalogue UI; the seed ships the safe, behaviour-preserving default.
      dailyReservationLimit: null,
      cancellationAllowanceCount: null,
      activeReservationLimit: null,
    entryAllowance: null,
      components: null,
      description: '',
    }
    const priceTL = (p.priceInKurus / 100).toLocaleString('tr-TR')
    const existingId = idByName.get(p.name)
    if (existingId) {
      const r = await updateProduct(catalogDeps, ctx, { ...fields, productId: existingId, active: true })
      if (!r.ok) throw new Error(`${p.name} güncellenemedi: ${r.error.code}`)
      console.log(`  ~ ${p.name} → ${priceTL} ₺ (güncellendi)`)
    } else {
      const r = await createProduct(catalogDeps, ctx, fields)
      if (!r.ok) throw new Error(`${p.name} oluşturulamadı: ${r.error.code}`)
      console.log(`  + ${p.name} → ${priceTL} ₺ (${r.value.productId})`)
    }
  }

  console.log('\n✅ Katalog kuruldu.')
  process.exit(0)
}

function findService(
  byName: Map<string, ServiceId>,
  catByName: Map<string, string>,
  name: string,
  expectedCategory: string,
): ServiceId {
  const id = byName.get(name)
  if (!id) throw new Error(`Beklenen ders türü yok: "${name}". Önce Ayarlar'dan oluşturulmalı.`)
  const cat = catByName.get(name)
  if (cat !== expectedCategory)
    throw new Error(`"${name}" kategorisi ${cat}, beklenen ${expectedCategory} — kurulum durduruldu.`)
  return id
}

void main()
