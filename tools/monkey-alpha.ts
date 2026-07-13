// PRODUCT ALPHA — MONKEY TEST.
//
// The stress test asks "what happens when two people press the same button?" This asks the other
// question: **"what happens when nobody presses the buttons in the order we imagined?"**
//
// It fires random, legal-looking operations at the real use-cases — book, cancel, move, adjust,
// freeze, unfreeze, sell, collect, check in — in an order nobody designed, and after EVERY step it
// re-checks the invariants the studio's money and capacity rest on:
//
//   E1    available = granted + restored − consumed − held − revoked − expired,  and never < 0
//   I-9   a class never holds more reservations than its capacity
//   I-10  bookedCount equals the reservations that actually exist
//   #10   the till equals the cash that went into it
//
// A REFUSAL IS NOT A FAILURE. The domain refusing an illegal move is the product working; the monkey
// counts refusals and moves on. A failure is an invariant broken — a number that stopped adding up.
//
//   pnpm monkey            # 300 operations, seed 1
//   pnpm monkey -- 2000 7  # 2000 operations, seed 7
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  adjustCredits,
  bookReservation,
  cancelReservation,
  collect,
  createDrawer,
  createRoom,
  createService,
  DEFAULT_STUDIO_CONFIG,
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  freezeEntitlement,
  instant,
  localDateAt,
  money,
  moveReservation,
  openBranch,
  openDrawer,
  recordCheckIn,
  registerMember,
  scheduleSession,
  selectEntitlement,
  sellPackage,
  systemClock,
  toMemberSnapshot,
  unfreezeEntitlement,
  type BranchId,
  type ClassSessionId,
  type EntitlementId,
  type MemberId,
  type ProductId,
  type ReservationId,
  type ServiceId,
  type StudioId,
  type TenantContext,
} from '@studio/core'

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080'
initializeApp({ projectId: 'demo-sos' })
const db = getFirestore()

const OPS = Number(process.argv[2] ?? 300)
const SEED = Number(process.argv[3] ?? 1)

// A seeded PRNG, so a failure can be REPRODUCED. A monkey you cannot replay is a rumour.
let seed = SEED >>> 0
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
const pick = <T>(xs: readonly T[]): T | null => (xs.length === 0 ? null : xs[Math.floor(rnd() * xs.length)]!)

const SID = `std_monkey_${SEED}_${Date.now()}` as StudioId
const BRANCH = 'brn_1' as BranchId
const ctx: TenantContext = {
  studioId: SID,
  branchIds: [BRANCH],
  role: 'receptionist',
  actor: { type: 'receptionist', id: 'usr_reception' as never },
}
const ownerCtx: TenantContext = { ...ctx, role: 'owner', actor: { type: 'owner', id: 'usr_owner' as never } }

const members = new FirestoreMemberRepository(db)
const ents = new FirestoreEntitlementRepository(db)
const finance = new FirestoreFinanceRepository(db)
const sched = new FirestoreSchedulingRepository(db)
const resRepo = new FirestoreReservationRepository(db)
const checkin = new FirestoreCheckinRepository(db)
const hours = new FirestoreStudioHours(db)

const memberDeps = { repo: members, clock: systemClock }
const entDeps = { repo: ents, clock: systemClock }
const financeDeps = { repo: finance, clock: systemClock }
const schedDeps = { repo: sched, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG, hours }
const resDeps = { repo: resRepo, clock: systemClock, hours }
const checkinDeps = { repo: checkin, clock: systemClock }
const sellDeps = { finance: financeDeps, entitlements: entDeps }

const PRICE = 300_000
const dayAfter = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

const roster: MemberId[] = []
const classes: ClassSessionId[] = []
let serviceId: ServiceId
let roomId: Parameters<typeof scheduleSession>[2]['roomId']
let cashIn = 0 // what the monkey believes is in the till

const refusals = new Map<string, number>()
const applied = new Map<string, number>()
const note = (map: Map<string, number>, k: string) => map.set(k, (map.get(k) ?? 0) + 1)

const violations: string[] = []
const violate = (m: string) => {
  if (violations.length < 20) violations.push(m)
}

/** Every invariant the studio's money and capacity rest on. Checked after EVERY operation. */
async function audit(op: number): Promise<void> {
  // E1, per entitlement — and never below zero.
  for (const m of roster) {
    for (const e of await ents.listByMember(ctx, m)) {
      const c = e.credits
      if (!c) continue
      const derived = c.granted + c.restored - c.consumed - c.held - c.revoked - c.expired
      if (derived < 0) violate(`op#${op} E1: ${e.id} negatif krediye düştü (${derived})`)
      if (c.held < 0 || c.consumed < 0 || c.granted < 0) {
        violate(`op#${op} E1: ${e.id} sayaçlarından biri negatif`)
      }
    }
  }

  // I-9 / I-10, per class.
  for (const id of classes) {
    const s = await sched.getSession(ctx, id)
    if (!s) continue
    const live = (await resRepo.listBySession(ctx, id)).filter((r) => r.status === 'booked')
    if (s.bookedCount !== live.length) {
      violate(`op#${op} I-10: ${id} bookedCount=${s.bookedCount} ama ${live.length} rezervasyon var`)
    }
    if (live.length > s.capacity) {
      violate(`op#${op} I-9: ${id} kapasitesi ${s.capacity}, içinde ${live.length} kişi var`)
    }
    const unique = new Set(live.map((r) => r.memberId as string)).size
    if (unique !== live.length) violate(`op#${op} I-9.x: ${id} aynı üye iki kez kayıtlı`)
  }

  // #10 — the till holds the cash the monkey put in it, to the kuruş.
  const drawer = (await finance.listDrawers(ctx))[0]
  if (drawer && drawer.expected.amount !== cashIn) {
    violate(`op#${op} KASA: beklenen ${cashIn}, kasada ${drawer.expected.amount}`)
  }
}

// ── the operations the monkey may perform ────────────────────────────────────────────────
type Op = () => Promise<string>

const newMember: Op = async () => {
  const n = roster.length
  const r = await registerMember(memberDeps, ctx, {
    fullName: `Üye ${n}`,
    phone: `+9053${String(10000000 + n).slice(0, 9)}`,
    homeBranchId: BRANCH,
    email: null,
    birthDate: null,
    notes: null,
    emergencyContact: null,
  })
  if (r.ok) roster.push(r.value.memberId as MemberId)
  return r.ok ? 'member.new' : `refused:${r.error.code}`
}

const sell: Op = async () => {
  const m = pick(roster)
  if (!m) return 'skip'
  const paying = rnd() < 0.7
  const amount = paying ? (rnd() < 0.5 ? PRICE : Math.floor(PRICE / 2 / 100) * 100) : 0
  const r = await sellPackage(sellDeps, ctx, {
    branchId: BRANCH,
    subscription: {
      memberId: m,
      productId: 'prd_x' as ProductId,
      productSnapshot: {
        productId: 'prd_x' as ProductId,
        name: '8 Ders Reformer',
        category: 'pilates_group',
        grant: { kind: 'credits', credits: 8, validForDays: 60 },
        listPrice: money(PRICE),
        serviceIds: [serviceId],
      },
      policyRef: { policyId: 'prd_x', version: 1 },
      priceAgreed: money(PRICE),
      validFrom: Date.now(),
      validUntil: null,
      freezeDays: 7,
      creditOverride: null,
      collectedAmount: money(0),
      method: 'cash' as const,
      note: '',
    },
    payment:
      amount > 0
        ? {
            amount: money(amount),
            method: 'cash',
            receivedAt: instant(Date.now()),
            drawerId: 'drw_main',
            giftCardCode: null,
            note: null,
          }
        : null,
    discountCeilingPercent: null,
  })
  if (r.ok && amount > 0) cashIn += amount
  return r.ok ? 'sell' : `refused:${r.error.code}`
}

const collectDebt: Op = async () => {
  const m = pick(roster)
  if (!m) return 'skip'
  const open = (await finance.listSalesByMember(ctx, m)).filter(
    (s) => s.status === 'open' && s.total.amount - s.paid.amount > 0,
  )
  const sale = pick(open)
  if (!sale) return 'skip'
  const amount = sale.total.amount - sale.paid.amount
  const r = await collect(financeDeps, ctx, {
    paymentId: `pay_mk_${SID}_${Math.floor(rnd() * 1e9)}`,
    memberId: m,
    branchId: BRANCH,
    amount: money(amount),
    method: 'cash',
    receivedAt: instant(Date.now()),
    drawerId: 'drw_main',
    giftCardCode: null,
    note: null,
  })
  if (r.ok) cashIn += amount
  return r.ok ? 'collect' : `refused:${r.error.code}`
}

const newClass: Op = async () => {
  const r = await scheduleSession(schedDeps, ownerCtx, {
    serviceId,
    branchId: BRANCH,
    branchName: 'Merkez',
    roomId,
    trainerId: null,
    trainerName: null,
    date: dayAfter(2 + Math.floor(rnd() * 10)),
    startTime: `${11 + Math.floor(rnd() * 8)}:00`,
    durationMinutes: 50,
    capacity: 1 + Math.floor(rnd() * 4), // small classes on purpose: contention is the point
  })
  if (r.ok) classes.push(r.value.sessionId)
  return r.ok ? 'class.new' : `refused:${r.error.code}`
}

const book: Op = async () => {
  const m = pick(roster)
  const c = pick(classes)
  if (!m || !c) return 'skip'
  const session = await sched.getSession(ctx, c)
  const member = await members.findById(ctx, m)
  if (!session || !member) return 'skip'
  const e = selectEntitlement(await ents.listActiveByMember(ctx, m), session, instant(Date.now()))
  if (!e) return 'skip:no_entitlement'
  const r = await bookReservation(resDeps, ctx, {
    sessionId: c,
    entitlementId: e.id,
    memberId: m,
    memberSnapshot: toMemberSnapshot(member),
  })
  return r.ok ? 'book' : `refused:${r.error.code}`
}

const liveReservations = async (): Promise<ReservationId[]> => {
  const out: ReservationId[] = []
  for (const c of classes) {
    for (const r of await resRepo.listBySession(ctx, c)) {
      if (r.status === 'booked') out.push(r.id as ReservationId)
    }
  }
  return out
}

const cancel: Op = async () => {
  const r = pick(await liveReservations())
  if (!r) return 'skip'
  const res = await cancelReservation(resDeps, ctx, { reservationId: r })
  return res.ok ? 'cancel' : `refused:${res.error.code}`
}

const move: Op = async () => {
  const r = pick(await liveReservations())
  const c = pick(classes)
  if (!r || !c) return 'skip'
  const res = await moveReservation(resDeps, ctx, { reservationId: r, targetSessionId: c })
  return res.ok ? 'move' : `refused:${res.error.code}`
}

const adjust: Op = async () => {
  const m = pick(roster)
  if (!m) return 'skip'
  const e = pick(await ents.listByMember(ctx, m))
  if (!e) return 'skip'
  // Negative deltas on purpose: a decrease below zero must be REFUSED, never clamped (AD-39).
  const delta = Math.floor(rnd() * 11) - 5
  if (delta === 0) return 'skip'
  const r = await adjustCredits(entDeps, ctx, {
    entitlementId: e.id as EntitlementId,
    delta,
    reason: 'correction',
    note: 'monkey',
  })
  return r.ok ? `adjust${delta > 0 ? '+' : ''}${delta}` : `refused:${r.error.code}`
}

const freeze: Op = async () => {
  const m = pick(roster)
  if (!m) return 'skip'
  const e = pick(await ents.listByMember(ctx, m))
  if (!e) return 'skip'
  const upcoming = (await resRepo.listByMember(ctx, m)).some((r) => r.status === 'booked')
  const r = await freezeEntitlement(entDeps, ctx, {
    entitlementId: e.id as EntitlementId,
    from: localDateAt(instant(Date.now()), 180),
    hasUpcomingReservation: upcoming,
  })
  return r.ok ? 'freeze' : `refused:${r.error.code}`
}

const unfreeze: Op = async () => {
  const m = pick(roster)
  if (!m) return 'skip'
  const e = pick((await ents.listByMember(ctx, m)).filter((x) => x.status === 'frozen'))
  if (!e) return 'skip'
  const r = await unfreezeEntitlement(entDeps, ctx, {
    entitlementId: e.id as EntitlementId,
    to: localDateAt(instant(Date.now() + 2 * 86_400_000), 180),
  })
  return r.ok ? 'unfreeze' : `refused:${r.error.code}`
}

const checkIn: Op = async () => {
  const m = pick(roster)
  if (!m) return 'skip'
  const r = await recordCheckIn(checkinDeps, ctx, {
    memberId: m,
    branchId: BRANCH,
    method: rnd() < 0.5 ? 'qr' : 'reception',
    occurredAt: instant(Date.now()),
    commandId: null,
  })
  return r.ok ? 'checkin' : `refused:${r.error.code}`
}

// Weighted: reception books and cancels all day; she sells a few times a week.
const DECK: readonly [Op, number][] = [
  [book, 22],
  [cancel, 12],
  [move, 10],
  [checkIn, 10],
  [newClass, 8],
  [sell, 8],
  [adjust, 8],
  [collectDebt, 6],
  [newMember, 6],
  [freeze, 5],
  [unfreeze, 5],
]
const TOTAL_WEIGHT = DECK.reduce((n, [, w]) => n + w, 0)
const nextOp = (): Op => {
  let r = rnd() * TOTAL_WEIGHT
  for (const [op, w] of DECK) {
    r -= w
    if (r <= 0) return op
  }
  return DECK[0]![0]
}

async function main(): Promise<void> {
  console.log(`🐒 monkey — ${OPS} işlem · seed ${SEED} · studio ${SID}\n`)

  // Setup enough of a studio for the monkey to have something to break.
  await db.doc(`studios/${SID}/settings/studio`).set({
    timeZone: 'Europe/Istanbul',
    defaultCancellationWindowHours: 6,
    defaultSessionDurationMinutes: 50,
    workingHours: null, // the monkey is about the ledger, not about opening hours
  })
  const svc = await createService(schedDeps, ownerCtx, {
    name: 'Reformer',
    category: 'pilates_group',
    policy: {
      maxDaysInAdvance: 30,
      cancellationWindowHours: 6,
      lateCancellationConsumesCredit: true,
      noShowConsumesCredit: false,
      attendanceDefaultOutcome: 'attended',
      autoResolveAfterMinutes: 15,
      allowMemberSelfBooking: false,
    },
  })
  if (!svc.ok) throw new Error('service')
  serviceId = svc.value.serviceId
  const room = await createRoom(schedDeps, ownerCtx, { branchId: BRANCH, name: 'Salon', capacity: 20 })
  if (!room.ok) throw new Error('room')
  roomId = room.value.roomId

  await db.doc(`studios/${SID}/products/prd_x`).set({
    name: '8 Ders Reformer',
    category: 'pilates_group',
    type: 'credit',
    creditCount: 8,
    durationDays: 60,
    listPrice: PRICE,
    priceInKurus: PRICE,
    freezeAllowanceDays: 7,
    serviceIds: [serviceId],
    active: true,
  })
  // The till is created through the PRODUCT's own path (hotfix B-2) — not hand-written into Firestore.
  // A harness that hand-crafts the state it tests proves nothing about the state the studio will have.
  const madeDrawer = await createDrawer(financeDeps, ownerCtx, {
    drawerId: 'drw_main',
    branchId: BRANCH,
    name: 'Merkez Kasa',
    kind: 'cash',
  })
  if (!madeDrawer.ok) throw new Error(`drawer create: ${madeDrawer.error.code}`)
  await openDrawer(financeDeps, ctx, { drawerId: 'drw_main', openingFloat: money(0) })
  await openBranch(checkinDeps, ctx, { branchId: BRANCH })
  await newMember()
  await newClass()

  for (let i = 1; i <= OPS; i++) {
    let outcome: string
    try {
      outcome = await nextOp()()
    } catch (err) {
      // A THROW is never acceptable. A refusal is the domain working; an exception is the domain
      // being surprised, and reception meets it as a white screen.
      violate(`op#${i} PATLADI: ${err instanceof Error ? err.message : String(err)}`)
      outcome = 'threw'
    }
    note(outcome.startsWith('refused') ? refusals : applied, outcome)
    await audit(i)
    if (violations.length > 0) break
    if (i % 50 === 0) process.stdout.write(`  …${i}\n`)
  }

  console.log('\n── ne yaptı ────────────────────────────')
  for (const [k, v] of [...applied].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`)
  console.log('\n── domain neyi reddetti (bunlar BAŞARIDIR) ──')
  for (const [k, v] of [...refusals].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(38)} ${v}`)

  const drawer = (await finance.listDrawers(ctx))[0]
  console.log('\n── son durum ───────────────────────────')
  console.log(`  üye: ${roster.length} · ders: ${classes.length}`)
  console.log(`  kasa: ${(drawer?.expected.amount ?? 0) / 100} ₺ (beklenen ${cashIn / 100} ₺)`)

  console.log('\n════════════════════════════════════════')
  if (violations.length === 0) {
    console.log(`✅ MONKEY: ${OPS} rastgele işlem, hiçbir değişmez bozulmadı.`)
  } else {
    console.log(`❌ ${violations.length} DEĞİŞMEZ İHLALİ (seed ${SEED} ile tekrar edilebilir):`)
    for (const v of violations) console.log(`   ${v}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
