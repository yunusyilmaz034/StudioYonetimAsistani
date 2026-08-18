// `pnpm setup:single-price` — the studio moves to ONE price per package (owner, 2026-08-06).
//
// Until today a package had two numbers: a cash price, and that price plus a KK/havale farkı added at
// the till. The member met whichever one the surface she was on happened to show, and reception had
// to explain the difference every time. From today there is one number, and it is the same number in
// cash, by transfer, and on the card — PAYTR is sent exactly that.
//
// The SURCHARGE MECHANISM STAYS (owner: "kk farkı sistemi kalsın ama hepsi şuanda 0 olacak"). It is
// zeroed as DATA, not deleted as code: a studio that wants it back sets a number in Ayarlar › Ödeme
// and every surface picks it up again with no deploy. Ripping it out would be a one-way door for a
// pricing decision that may not be permanent.
//
// Instalments are not our business and the copy now says so: the card offers them, PAYTR sets the
// vade farkı, and the studio quotes neither.
//
// Prices come from the owner and are written HERE, in a manual setup script — not into a source file
// that any surface reads (AD-41: the catalogue is data). Every write goes through the product's own
// domain path, so each one appends `product.updated` and the change is auditable.
//
// Manual, admin-only, never in CI:
//   ALLOW_PRODUCTION=1 GOOGLE_CLOUD_PROJECT=studio-yonetim-prod pnpm setup:single-price retro
import {
  createProduct,
  DEFAULT_STUDIO_CONFIG,
  FirestoreCatalogRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  systemClock,
  updateProduct,
  updateStudioSettings,
  type CatalogDeps,
  type Category,
  type ProductId,
  type SchedulingDeps,
  type ServiceId,
  type StudioId,
  type StudioSettings,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const PROJECT = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-sos'
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.ALLOW_PRODUCTION) {
  console.error('Refusing to run against production without ALLOW_PRODUCTION=1.')
  process.exit(1)
}

const STUDIO = (process.argv[2] ?? 'retro') as StudioId
const BRANCH = process.argv[3] ?? 'mutlukent'

// Money is an integer in kuruş (#10). 1 ₺ = 100 kuruş.
const TRY = (lira: number) => lira * 100

// The new list, by product NAME — the same key `setup:catalog` upserts on. A package the owner did
// not name is not touched: its price is whatever the panel says today, and this script has no
// opinion about it. `onlineSellable` omitted ⇒ whatever the panel says today is kept.
const REPRICE: readonly { name: string; priceInKurus: number; onlineSellable?: boolean }[] = [
  { name: 'Reformer Pilates - 8 Ders', priceInKurus: TRY(5_000), onlineSellable: true },
  { name: 'Fitness - 3 Aylık', priceInKurus: TRY(9_000), onlineSellable: true },
  { name: 'Fitness - 6 Aylık', priceInKurus: TRY(14_000), onlineSellable: true },

  // ── Hibrit demetler (owner approved 2026-08-06) ────────────────────────────────────────────
  //
  // The old hybrid prices had no formula in them: pilates was always charged at list, but a fitness
  // entry cost anywhere between 325 ₺ and 525 ₺ depending on which bundle it sat in. Four bundles,
  // four different arithmetics. Repricing without fixing that would have raised the inconsistency
  // along with the prices.
  //
  // Two anchors now, both taken from the single-price list rather than invented:
  //   · a pilates lesson = 625 ₺  — 5.000 ÷ 8, and the 4-Ders package independently says 625 too
  //   · a fitness entry  = 400 ₺  — chosen so 10 entries (4.000 ₺) equal one UNLIMITED month. The
  //     boundary then explains itself: fewer than ten visits a month ⇒ the bundle, more ⇒ unlimited.
  //     The two products stop competing and reception can answer "which one?" in one sentence.
  //
  // The three-month bundle takes a further −10% for the commitment: bought separately its contents
  // are 24.000 ₺, so the member keeps ~25% (the old bundle kept ~20%).
  //
  // "1 Fitness + 1 Pilates" is the ONE number that is not the formula's: 4×625 + 4×400 = 4.100 ⇒
  // 4.000 ₺, which would have been a price CUT in the middle of a general increase. The owner set it
  // at 4.500 instead. Recorded here because a number that does not follow the rule beside it will
  // otherwise read as an arithmetic slip to whoever reads this next.
  { name: 'Hibrit Aylık — 1 Fitness + 1 Pilates', priceInKurus: TRY(4_500) }, // owner override
  { name: 'Hibrit Aylık — 2 Fitness + 1 Pilates', priceInKurus: TRY(5_500) }, // 4×625 + 8×400 = 5.700
  { name: 'Hibrit Aylık — 2 Pilates + 1 Fitness', priceInKurus: TRY(6_500) }, // 8×625 + 4×400 = 6.600
  { name: 'Hibrit 3 Aylık — 1Fitness + 2Pilates', priceInKurus: TRY(18_000) }, // 19.800 − %10 taahhüt
]

// "16 ve 24 ders fiyat gösterme satışı yok" — a package with no price is not a package, so these are
// DEACTIVATED rather than left visible at a number nobody honours. Deactivation is safe for members
// who already hold one: an entitlement carries its own `productSnapshot` and never reads the product
// again.
const RETIRE: readonly string[] = ['Reformer Pilates - 16 Ders', 'Reformer Pilates - 24 Ders']

// Twelve months did not exist; the owner priced it, so it is created.
const CREATE = {
  name: 'Fitness - 12 Aylık',
  category: 'fitness' as Category,
  type: 'period' as const,
  creditCount: null, // unlimited — a fitness membership is time, not credits
  durationDays: 365,
  priceInKurus: TRY(22_000),
  freezeAllowanceDays: 30, // 1 ay ⇒ 3 ay 7 gün, 6 ay 14 gün, 12 ay 30 gün
  serviceName: 'Fitness',
}

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
  const schedDeps: SchedulingDeps = {
    repo: new FirestoreSchedulingRepository(db),
    clock: systemClock,
    studioConfig: DEFAULT_STUDIO_CONFIG,
    hours: new FirestoreStudioHours(db),
  }

  const productDocs = await db.collection(`studios/${STUDIO}/products`).get()
  const byName = new Map(productDocs.docs.map((d) => [String(d.data().name), d]))

  // Every field the product already has is carried through unchanged — this script changes the
  // price, nothing else. Reading the whole doc and spreading it is the point: `updateProduct` takes
  // the FULL field set, so a partial input would silently reset package rules, bundle components and
  // sellability that the owner set in the panel.
  const fieldsOf = (doc: FirebaseFirestore.DocumentSnapshot) => {
    const d = doc.data() as Record<string, unknown>
    return {
      name: String(d.name),
      category: d.category as Category,
      serviceIds: (d.serviceIds ?? []) as ServiceId[],
      type: d.type as 'credit' | 'period',
      durationDays: Number(d.durationDays),
      creditCount: (d.creditCount ?? null) as number | null,
      priceInKurus: Number(d.priceInKurus),
      cashPriceInKurus: (d.cashPriceInKurus ?? null) as number | null,
      freezeAllowanceDays: Number(d.freezeAllowanceDays ?? 0),
      dailyReservationLimit: (d.dailyReservationLimit ?? null) as number | null,
      cancellationAllowanceCount: (d.cancellationAllowanceCount ?? null) as number | null,
      activeReservationLimit: (d.activeReservationLimit ?? null) as number | null,
      entryAllowance: (d.entryAllowance ?? null) as number | null,
      components: (d.components ?? null) as never,
      description: String(d.description ?? ''),
      onlineSellable: Boolean(d.onlineSellable),
      memberSellable: Boolean(d.memberSellable),
      active: Boolean(d.active),
    }
  }
  const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`

  console.log(`\n── Tek fiyat · ${STUDIO} ────────────────────────────────`)

  for (const row of REPRICE) {
    const doc = byName.get(row.name)
    if (!doc) {
      console.log(`  ! ${row.name} — katalogda yok, atlandı`)
      continue
    }
    const cur = fieldsOf(doc)
    const r = await updateProduct(catalogDeps, ctx, {
      ...cur,
      productId: doc.id as ProductId,
      priceInKurus: row.priceInKurus,
      onlineSellable: row.onlineSellable ?? cur.onlineSellable,
      active: true,
    })
    if (!r.ok) throw new Error(`${row.name} güncellenemedi: ${r.error.code}`)
    console.log(
      cur.priceInKurus === row.priceInKurus
        ? `  = ${row.name}: ${tl(row.priceInKurus)} (değişmedi)`
        : `  ~ ${row.name}: ${tl(cur.priceInKurus)} → ${tl(row.priceInKurus)}`,
    )
  }

  for (const name of RETIRE) {
    const doc = byName.get(name)
    if (!doc) {
      console.log(`  ! ${name} — katalogda yok, atlandı`)
      continue
    }
    const cur = fieldsOf(doc)
    if (!cur.active) {
      console.log(`  = ${name} zaten pasif`)
      continue
    }
    const r = await updateProduct(catalogDeps, ctx, {
      ...cur,
      productId: doc.id as ProductId,
      onlineSellable: false,
      memberSellable: false,
      active: false,
    })
    if (!r.ok) throw new Error(`${name} pasife alınamadı: ${r.error.code}`)
    console.log(`  − ${name}: satıştan kaldırıldı`)
  }

  if (byName.has(CREATE.name)) {
    const doc = byName.get(CREATE.name)!
    const cur = fieldsOf(doc)
    const r = await updateProduct(catalogDeps, ctx, {
      ...cur,
      productId: doc.id as ProductId,
      priceInKurus: CREATE.priceInKurus,
      onlineSellable: true,
      active: true,
    })
    if (!r.ok) throw new Error(`${CREATE.name} güncellenemedi: ${r.error.code}`)
    console.log(`  ~ ${CREATE.name}: ${tl(cur.priceInKurus)} → ${tl(CREATE.priceInKurus)}`)
  } else {
    const services = await db.collection(`studios/${STUDIO}/services`).get()
    const svc = services.docs.find((d) => String(d.data().name) === CREATE.serviceName)
    if (!svc) throw new Error(`"${CREATE.serviceName}" ders türü yok — önce oluşturulmalı.`)
    const r = await createProduct(catalogDeps, ctx, {
      name: CREATE.name,
      category: CREATE.category,
      serviceIds: [svc.id as ServiceId],
      type: CREATE.type,
      durationDays: CREATE.durationDays,
      creditCount: CREATE.creditCount,
      priceInKurus: CREATE.priceInKurus,
      cashPriceInKurus: null,
      freezeAllowanceDays: CREATE.freezeAllowanceDays,
      dailyReservationLimit: null,
      cancellationAllowanceCount: null,
      activeReservationLimit: null,
      entryAllowance: null,
      components: null,
      description: '',
      onlineSellable: true,
      memberSellable: true,
    })
    if (!r.ok) throw new Error(`${CREATE.name} oluşturulamadı: ${r.error.code}`)
    console.log(`  + ${CREATE.name}: ${tl(CREATE.priceInKurus)} (${r.value.productId})`)
  }

  // ── The KK/havale farkı, zeroed. Every category gets an explicit 0 rather than being removed, so
  //    Ayarlar shows "0" — a rule the owner can see and change — instead of an empty field that
  //    reads as "never configured".
  const current = await schedDeps.repo.getStudioSettings(ctx)
  if (!current) throw new Error('Stüdyo ayarları bulunamadı.')
  const next: StudioSettings = {
    ...current,
    paymentSurcharge: {
      cardTransferSurchargeKurus: 0,
      maxInstallments: current.paymentSurcharge?.maxInstallments ?? 3,
      byCategory: { pilates_group: { fixedKurus: 0 }, fitness: { fixedKurus: 0 }, private: { fixedKurus: 0 } },
    },
  }
  const s = await updateStudioSettings(schedDeps, ctx, next)
  if (!s.ok) throw new Error(`Ayar yazılamadı: ${s.error.code}`)
  console.log('  ~ KK/havale farkı: tüm kategorilerde 0 (mekanizma duruyor)')

  // ── Read-back. The catalogue's own history is the reason: the first seed multiplied every price by
  //    100 and it was caught by reading the values back, never by writing them. Money paths verify.
  const after = await db.collection(`studios/${STUDIO}/products`).get()
  console.log('\n── Katalog (aktif) ──────────────────────────────────────')
  for (const d of after.docs.sort((a, b) => String(a.data().name).localeCompare(String(b.data().name)))) {
    const v = d.data()
    if (!v.active) continue
    console.log(`  ${String(v.name).padEnd(38)} ${tl(Number(v.priceInKurus)).padStart(12)}  ${v.onlineSellable ? 'online' : ''}`)
  }
  process.exit(0)
}

void main()
