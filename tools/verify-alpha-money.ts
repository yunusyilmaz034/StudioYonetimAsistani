// ALPHA REVIEW — the money path, end to end, exactly as the product performs it.
//
// The question this asks is the only one that matters for a cutover: **when reception sells a package
// on the screen she actually has, does the money appear where the owner actually looks?**
//
//   the screen she has      → Üye Workspace → "Paket Ata"  → assignSubscriptionAction
//   where the owner looks   → dashboard revenue · Satış raporu · Tahsilat raporu · Kasa
//
// It writes nothing the product does not write, and it reads nothing the product does not read.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  openDrawer,
  sellPackage,
  FirestoreCatalogRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreMemberRepository,
  instant,
  money,
  projectDaily,
  registerMember,
  systemClock,
  type MemberId,
  type ProductId,
  type StudioId,
  type TenantContext,
} from '@studio/core'

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080'
initializeApp({ projectId: 'demo-sos' })
const db = getFirestore()

const SID = `std_alpha_${Date.now()}` as StudioId
const ctx: TenantContext = {
  studioId: SID,
  branchIds: [],
  role: 'receptionist',
  actor: { type: 'receptionist', id: 'usr_reception' as never },
}

const PRICE = 300_000 // 3.000,00 ₺

async function main(): Promise<void> {
  const members = new FirestoreMemberRepository(db)
  const ents = new FirestoreEntitlementRepository(db)
  const finance = new FirestoreFinanceRepository(db)

  // ── The catalogue. Data, never a literal (AD-41). ──
  const productId = 'prd_alpha' as ProductId
  await db.doc(`studios/${SID}/products/${productId}`).set({
    name: '8 Ders Reformer',
    category: 'pilates_group',
    type: 'credit',
    creditCount: 8,
    durationDays: 30,
    listPrice: PRICE,
    active: true,
  })

  // ── 1. Reception registers a member. ──
  const reg = await registerMember(
    { repo: members, clock: systemClock },
    ctx,
    {
      fullName: 'Ayşe Yılmaz',
      phone: '+905321112233',
      homeBranchId: null,
      email: null,
      birthDate: null,
      notes: null,
      emergencyContact: null,
    },
  )
  if (!reg.ok) throw new Error(`member: ${reg.error.code}`)
  const memberId = reg.value.memberId as MemberId
  console.log(`✅ üye kaydedildi: ${memberId}`)

  // ── 2. Reception SELLS THE PACKAGE — through the one path the product gives her. ──
  const product = await new FirestoreCatalogRepository(db).getProduct(ctx, productId)
  if (!product) throw new Error('product missing')

  // Reception opens the till in the morning. Cash taken with no till open is refused — and it should
  // be: money at the desk that the day-end count can never explain is the oldest hole in a studio.
  await db.doc(`studios/${SID}/cashDrawers/drw_main`).set({
    name: 'Merkez Kasa',
    kind: 'cash',
    status: 'closed',
    branchId: 'brn_1',
    openingFloat: 0,
    expected: 0,
    openedAt: null,
    openedBy: null,
    closedAt: null,
    closedBy: null,
    countedAmount: null,
    discrepancy: null,
    closeNote: null,
  })
  const opened = await openDrawer(
    { repo: finance, clock: systemClock },
    ctx,
    { drawerId: 'drw_main', openingFloat: money(0) },
  )
  if (!opened.ok) throw new Error(`drawer: ${JSON.stringify(opened.error)}`)

  const sold = await sellPackage(
    { finance: { repo: finance, clock: systemClock }, entitlements: { repo: ents, clock: systemClock } },
    ctx,
    {
      branchId: 'brn_1' as never,
      subscription: {
        memberId,
        productId,
        productSnapshot: {
          productId,
          name: product.name,
          category: product.category,
          grant: { kind: 'credits', credits: 8, validForDays: 30 },
          listPrice: money(PRICE),
        },
        policyRef: { policyId: 'pol_1', version: 1 },
        priceAgreed: money(PRICE),
        validFrom: Date.now(),
        validUntil: null,
        freezeDays: null,
        creditOverride: null,
        collectedAmount: money(0),
        method: 'cash',
        note: '',
      },
      // She takes the full amount in cash, at the desk.
      payment: {
        amount: money(PRICE),
        method: 'cash',
        receivedAt: instant(Date.now()),
        drawerId: 'drw_main',
        giftCardCode: null,
        note: null,
      },
      discountCeilingPercent: null,
    },
  )
  if (!sold.ok) throw new Error(`sell: ${JSON.stringify(sold.error)}`)
  console.log(`✅ paket satıldı ve ${PRICE / 100} ₺ nakit tahsil edildi (ekranın yaptığı şey)`)

  // ── 3. Now look WHERE THE OWNER LOOKS. ──
  // 3a. The dashboard / analytics number — the daily projection, folded from the event log exactly
  //     as `onEventCreated` folds it.
  const events = await db.collection(`studios/${SID}/events`).get()
  let salesKurus = 0
  let collectedKurus = 0
  for (const doc of events.docs) {
    const e = doc.data()
    const inc = projectDaily(
      {
        type: e.type,
        occurredAt: instant(e.occurredAt.toMillis()),
        payload: e.payload,
      } as never,
      180,
    )
    if (!inc) continue
    salesKurus += inc.counters.salesKurus ?? 0
    collectedKurus += inc.counters.collectedKurus ?? 0
  }

  // 3b. The Satış raporu (S6) — it reads `/sales`.
  const sales = await finance.listSalesBetween(ctx, Date.now() - 86_400_000, Date.now() + 86_400_000)
  // 3c. The Tahsilat raporu (S6) — it reads `/payments`.
  const payments = await finance.listPaymentsBetween(ctx, Date.now() - 86_400_000, Date.now() + 86_400_000)
  // 3d. The kasa.
  const drawers = await finance.listDrawers(ctx)

  // 3e. What the member's own record says — the entitlement (the path that DID record the money).
  const ent = (await ents.listByMember(ctx, memberId))[0]

  console.log('\n──────── ne yazıldı ────────')
  console.log(`event log            : ${events.size} event`)
  console.log(`entitlement.paidTotal: ${(ent?.paidTotal?.amount ?? 0) / 100} ₺   ← artık burada DEĞİL, defterde`)

  console.log('\n──────── owner nereye bakıyor ────────')
  console.log(`Gösterge paneli · satış     : ${salesKurus / 100} ₺`)
  console.log(`Gösterge paneli · tahsilat  : ${collectedKurus / 100} ₺`)
  console.log(`Satış raporu    · satır     : ${sales.length}`)
  console.log(`Tahsilat raporu · satır     : ${payments.length}`)
  console.log(`Kasa            · beklenen  : ${(drawers[0]?.expected.amount ?? 0) / 100} ₺`)

  const revenueVisible =
    salesKurus === PRICE &&
    collectedKurus === PRICE &&
    sales.length === 1 &&
    payments.length === 1 &&
    (drawers[0]?.expected.amount ?? 0) === PRICE

  console.log('\n────────────────────────────')
  if (revenueVisible) {
    console.log('✅ Satılan para owner’ın baktığı her yerde görünüyor.')
  } else {
    console.log('❌ SATILAN PARA HİÇBİR YERDE GÖRÜNMÜYOR.')
    console.log('   Resepsiyon 3.000 ₺ nakit aldı. Gösterge paneli 0 diyor, raporlar boş, kasa boş.')
    console.log('   Para SADECE entitlement üzerinde duruyor — v1.24 ledger’ına hiç girmedi.')
    process.exitCode = 1
  }

  // Cleanup: this studio was created for this run.
  const batch = db.batch()
  for (const doc of events.docs) batch.delete(doc.ref)
  await batch.commit()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
