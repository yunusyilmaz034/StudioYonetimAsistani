// PRODUCT ALPHA — STRESS & CONCURRENCY, against the emulator.
//
// Unit tests prove the deciders. `verify:alpha` proves the chain. Neither proves the thing that
// actually breaks a studio at 19:00 on a Tuesday: **two people pressing the same button at the same
// moment.** Eight women refreshing the app for the last seat in a class of eight. Reception cancelling
// a reservation while the member moves it. A trainer marking a roster while the sweep resolves it.
//
// Firestore transactions are supposed to make these safe. "Supposed to" is not a control. So each
// scenario below fires the real use-cases CONCURRENTLY and then asserts the invariant that money and
// capacity depend on:
//
//   I-9   a class never holds more reservations than its capacity
//   I-10  bookedCount equals the reservations that exist
//   E1    available = granted + restored − consumed − held − revoked − expired
//   #10   money is an integer number of kuruş, and it is conserved
//
// A drift here is not a slow screen. It is a member who paid for a class she cannot take, or a class
// that quietly refuses a member it has room for — and neither shows up as an error.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  adjustCredits,
  bookReservation,
  cancelReservation,
  createRoom,
  createService,
  DEFAULT_STUDIO_CONFIG,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  instant,
  money,
  moveReservation,
  openDrawer,
  registerMember,
  scheduleSession,
  selectEntitlement,
  sellPackage,
  systemClock,
  toMemberSnapshot,
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

const SID = `std_stress_${Date.now()}` as StudioId
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
const hours = new FirestoreStudioHours(db)

const entDeps = { repo: ents, clock: systemClock }
const financeDeps = { repo: finance, clock: systemClock }
const schedDeps = { repo: sched, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG, hours }
const resDeps = { repo: resRepo, clock: systemClock, hours }
const sellDeps = { finance: financeDeps, entitlements: entDeps }

let failures = 0
const ok = (l: string, d = '') => console.log(`  ✅ ${l}${d ? ` — ${d}` : ''}`)
const bad = (l: string, d: string) => {
  failures++
  console.log(`  ❌ ${l} — ${d}`)
}
const expect = (l: string, actual: unknown, wanted: unknown) =>
  actual === wanted ? ok(l, String(actual)) : bad(l, `beklenen ${String(wanted)}, gelen ${String(actual)}`)
const step = (n: string) => console.log(`\n── ${n} ──────────────────────────────────────`)

const PRICE = 300_000
const CAPACITY = 5
const CONTENDERS = 12

const dayAfter = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

/** E1, from the row itself. A drift means a write path bypassed a transaction — that is the bug. */
const ledgerOf = async (id: EntitlementId) => {
  const e = await ents.getEntitlement(ctx, id)
  const c = e?.credits
  if (!c) return null
  return {
    derived: c.granted + c.restored - c.consumed - c.held - c.revoked - c.expired,
    held: c.held,
    consumed: c.consumed,
  }
}

async function main(): Promise<void> {
  step('KURULUM')
  await db.doc(`studios/${SID}/settings/studio`).set({
    timeZone: 'Europe/Istanbul',
    defaultCancellationWindowHours: 6,
    defaultSessionDurationMinutes: 50,
    // No working hours configured: this run is about capacity and money under contention, and a
    // refusal for a reason that is not the one under test would only hide the result.
    workingHours: null,
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
  const room = await createRoom(schedDeps, ownerCtx, {
    branchId: BRANCH,
    name: 'Salon 1',
    capacity: 50,
  })
  if (!room.ok) throw new Error('room')

  const productId = 'prd_x' as ProductId
  await db.doc(`studios/${SID}/products/${productId}`).set({
    name: '8 Ders Reformer',
    category: 'pilates_group',
    type: 'credit',
    creditCount: 8,
    durationDays: 60,
    listPrice: PRICE,
    priceInKurus: PRICE,
    freezeAllowanceDays: 0,
    serviceIds: [svc.value.serviceId],
    active: true,
  })

  await db.doc(`studios/${SID}/cashDrawers/drw_main`).set({
    name: 'Merkez Kasa',
    kind: 'cash',
    status: 'closed',
    branchId: BRANCH,
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
  await openDrawer(financeDeps, ctx, { drawerId: 'drw_main', openingFloat: money(0) })

  // ── Twelve members, each with a package, sold CONCURRENTLY ──────────────────────────────
  step(`1. ${CONTENDERS} PAKET SATIŞI, AYNI ANDA — para korunuyor mu?`)
  const people = await Promise.all(
    Array.from({ length: CONTENDERS }, async (_, i) => {
      const r = await registerMember({ repo: members, clock: systemClock }, ctx, {
        fullName: `Üye ${i}`,
        phone: `+9053200${String(10000 + i).padStart(5, '0')}`,
        homeBranchId: BRANCH,
        email: null,
        birthDate: null,
        notes: null,
        emergencyContact: null,
      })
      if (!r.ok) throw new Error(`member ${i}: ${r.error.code}`)
      return r.value.memberId as MemberId
    }),
  )

  const sales = await Promise.all(
    people.map((memberId) =>
      sellPackage(sellDeps, ctx, {
        branchId: BRANCH,
        subscription: {
          memberId,
          productId,
          productSnapshot: {
            productId,
            name: '8 Ders Reformer',
            category: 'pilates_group',
            grant: { kind: 'credits', credits: 8, validForDays: 60 },
            listPrice: money(PRICE),
            serviceIds: [svc.value.serviceId],
          },
          policyRef: { policyId: productId as string, version: 1 },
          priceAgreed: money(PRICE),
          validFrom: Date.now(),
          validUntil: null,
          freezeDays: null,
          creditOverride: null,
          collectedAmount: money(0),
          method: 'cash' as const,
          note: '',
        },
        payment: {
          amount: money(PRICE),
          method: 'cash',
          receivedAt: instant(Date.now()),
          drawerId: 'drw_main',
          giftCardCode: null,
          note: null,
        },
        discountCeilingPercent: null,
      }),
    ),
  )
  const soldOk = sales.filter((s) => s.ok).length
  expect('hepsi satıldı', soldOk, CONTENDERS)

  // The till is the assertion that matters: twelve concurrent cash payments into ONE drawer document.
  // If the drawer's `expected` were written outside a transaction, this is where it would drift — and
  // the day-end count would be short by a random amount nobody could explain.
  const drawer = (await finance.listDrawers(ctx))[0]
  expect('KASA: 12 eşzamanlı nakit tahsilat, kuruşu kuruşuna', drawer?.expected.amount, CONTENDERS * PRICE)

  const payments = await finance.listPaymentsBetween(ctx, Date.now() - 86_400_000, Date.now() + 86_400_000)
  expect('tahsilat sayısı', payments.length, CONTENDERS)

  // ── The last seat ───────────────────────────────────────────────────────────────────────
  step(`2. SON KOLTUK: kapasite ${CAPACITY}, ${CONTENDERS} kişi AYNI ANDA rezervasyon yapıyor`)
  const s1 = await scheduleSession(schedDeps, ownerCtx, {
    serviceId: svc.value.serviceId as ServiceId,
    branchId: BRANCH,
    branchName: 'Merkez',
    roomId: room.value.roomId,
    trainerId: null,
    trainerName: null,
    date: dayAfter(3),
    startTime: '19:00',
    durationMinutes: 50,
    capacity: CAPACITY,
  })
  if (!s1.ok) throw new Error('session')
  const sessionId = s1.value.sessionId

  const session = (await sched.getSession(ctx, sessionId))!
  const bookings = await Promise.all(
    people.map(async (memberId) => {
      const m = await members.findById(ctx, memberId)
      const cands = await ents.listActiveByMember(ctx, memberId)
      const e = selectEntitlement(cands, session, instant(Date.now()))
      if (!e || !m) return { ok: false as const, error: { code: 'no_entitlement' } }
      return bookReservation(resDeps, ctx, {
        sessionId,
        entitlementId: e.id,
        memberId,
        memberSnapshot: toMemberSnapshot(m),
      })
    }),
  )

  const won = bookings.filter((b) => b.ok).length
  const refused = bookings.filter((b) => !b.ok)
  expect('TAM kapasite kadar rezervasyon geçti — fazlası YOK', won, CAPACITY)
  expect('geri kalanlar reddedildi', refused.length, CONTENDERS - CAPACITY)
  const fullCode = refused.every((r) => !r.ok && r.error.code === 'class_full')
  expect('reddedilenlerin sebebi "class_full"', fullCode, true)

  // I-10 — the denormalised counter IS what capacity is judged against. If it drifts high the class
  // silently refuses members it has room for; if it drifts low it oversells. Neither is an error.
  const after = (await sched.getSession(ctx, sessionId))!
  const live = (await resRepo.listBySession(ctx, sessionId)).filter((r) => r.status === 'booked')
  expect('bookedCount = gerçek rezervasyon sayısı (I-10)', after.bookedCount, live.length)
  expect('bookedCount = kapasite', after.bookedCount, CAPACITY)

  // E1 — a member who was REFUSED must not be holding a credit for a class she never got into.
  let heldByLosers = 0
  for (const [i, b] of bookings.entries()) {
    if (b.ok) continue
    const cands = await ents.listByMember(ctx, people[i]!)
    for (const e of cands) heldByLosers += e.credits?.held ?? 0
  }
  expect('REDDEDİLEN üyelerde tutulan kredi YOK', heldByLosers, 0)

  // ── Cancel and re-book the freed seat, concurrently ─────────────────────────────────────
  step('3. BİR KİŞİ İPTAL EDİYOR, BEKLEYENLER AYNI ANDA O KOLTUĞU KAPMAYA ÇALIŞIYOR')
  const winner = live[0]!
  const losers = people.filter((p) => !live.some((r) => r.memberId === p))

  const cancelAndRace = await Promise.all([
    cancelReservation(resDeps, ctx, { reservationId: winner.id as ReservationId }),
    ...losers.slice(0, 4).map(async (memberId) => {
      // They are hammering the button while the cancel is in flight. Some will lose the race and be
      // refused — which is correct. What must NEVER happen is two of them getting the same seat.
      const m = await members.findById(ctx, memberId)
      const cands = await ents.listActiveByMember(ctx, memberId)
      const e = selectEntitlement(cands, (await sched.getSession(ctx, sessionId))!, instant(Date.now()))
      if (!e || !m) return { ok: false as const, error: { code: 'no_entitlement' } }
      return bookReservation(resDeps, ctx, {
        sessionId,
        entitlementId: e.id,
        memberId,
        memberSnapshot: toMemberSnapshot(m),
      })
    }),
  ])
  const cancelOk = cancelAndRace[0]!.ok

  const finalSession = (await sched.getSession(ctx, sessionId))!
  const finalLive = (await resRepo.listBySession(ctx, sessionId)).filter((r) => r.status === 'booked')
  expect('iptal geçti', cancelOk, true)
  expect('sınıf HÂLÂ kapasiteyi aşmıyor', finalLive.length <= CAPACITY, true)
  expect('bookedCount hâlâ gerçekle uyuşuyor (I-10)', finalSession.bookedCount, finalLive.length)

  const uniqueMembers = new Set(finalLive.map((r) => r.memberId as string)).size
  expect('aynı üye iki kez listede YOK', uniqueMembers, finalLive.length)

  // ── Every ledger, checked ───────────────────────────────────────────────────────────────
  step('4. HER KREDİ DEFTERİ TUTUYOR MU? (E1)')
  let drifted = 0
  let totalHeld = 0
  for (const memberId of people) {
    for (const e of await ents.listByMember(ctx, memberId)) {
      const l = await ledgerOf(e.id)
      if (!l) continue
      totalHeld += l.held
      const stored = e.credits!.granted + e.credits!.restored - e.credits!.consumed - e.credits!.held - e.credits!.revoked - e.credits!.expired
      if (stored !== l.derived) drifted++
      if (l.derived < 0) drifted++
    }
  }
  expect('hiçbir kredi defteri KAYMADI', drifted, 0)
  expect('tutulan kredi = derste oturan kişi sayısı', totalHeld, finalLive.length)

  // ── Move storm: everyone moves to another class at once ─────────────────────────────────
  step('5. TAŞIMA FIRTINASI: herkes aynı anda başka derse taşınıyor')
  const s2 = await scheduleSession(schedDeps, ownerCtx, {
    serviceId: svc.value.serviceId as ServiceId,
    branchId: BRANCH,
    branchName: 'Merkez',
    roomId: room.value.roomId,
    trainerId: null,
    trainerName: null,
    date: dayAfter(4),
    startTime: '19:00',
    durationMinutes: 50,
    capacity: 2, // deliberately SMALLER than the roster: most of them must be refused
  })
  if (!s2.ok) throw new Error('session2')

  const moves = await Promise.all(
    finalLive.map((r) =>
      moveReservation(resDeps, ctx, {
        reservationId: r.id as ReservationId,
        targetSessionId: s2.value.sessionId as ClassSessionId,
      }),
    ),
  )
  const movedOk = moves.filter((m) => m.ok).length
  const target = (await sched.getSession(ctx, s2.value.sessionId))!
  const targetLive = (await resRepo.listBySession(ctx, s2.value.sessionId)).filter((r) => r.status === 'booked')

  expect('hedef ders kapasitesini AŞMADI', targetLive.length <= 2, true)
  expect('taşınan sayısı = hedefteki rezervasyon', movedOk, targetLive.length)
  expect('hedefin bookedCount’u gerçekle uyuşuyor', target.bookedCount, targetLive.length)

  const source = (await sched.getSession(ctx, sessionId))!
  const sourceLive = (await resRepo.listBySession(ctx, sessionId)).filter((r) => r.status === 'booked')
  expect('kaynak dersin bookedCount’u gerçekle uyuşuyor', source.bookedCount, sourceLive.length)

  // Nothing may have been lost in the storm: a moved reservation still holds ONE credit, and a
  // refused move must not have moved one.
  let held2 = 0
  for (const memberId of people) {
    for (const e of await ents.listByMember(ctx, memberId)) held2 += e.credits?.held ?? 0
  }
  expect('tutulan kredi = hâlâ oturan kişi sayısı', held2, sourceLive.length + targetLive.length)

  // ── The credit ledger under a WRITE-WRITE race ─────────────────────────────────────────
  //
  // Entitlements are saved with a BATCH, not a transaction: atomic, but it serialises nothing. The
  // owner running a bulk credit adjustment while reception books that same member is a real Tuesday,
  // and if the adjust's batch clobbers the booking's hold, the member gets a free class and the
  // ledger stops adding up. E1 is the assertion; a drift here means a write path bypassed a
  // transaction, which is the thing the health check exists to shout about.
  step('6. KREDİ DEFTERİ: aynı pakete AYNI ANDA rezervasyon + kredi düzeltmesi')
  const victim = people[0]!
  const vEnt = (await ents.listByMember(ctx, victim))[0]!

  const s3 = await scheduleSession(schedDeps, ownerCtx, {
    serviceId: svc.value.serviceId as ServiceId,
    branchId: BRANCH,
    branchName: 'Merkez',
    roomId: room.value.roomId,
    trainerId: null,
    trainerName: null,
    date: dayAfter(5),
    startTime: '19:00',
    durationMinutes: 50,
    capacity: 20,
  })
  if (!s3.ok) throw new Error('session3')

  const beforeLedger = await ledgerOf(vEnt.id)
  const vm = (await members.findById(ctx, victim))!

  await Promise.all([
    (async () => {
      const cands = await ents.listActiveByMember(ctx, victim)
      const e = selectEntitlement(cands, (await sched.getSession(ctx, s3.value.sessionId))!, instant(Date.now()))
      if (!e) return
      await bookReservation(resDeps, ctx, {
        sessionId: s3.value.sessionId,
        entitlementId: e.id,
        memberId: victim,
        memberSnapshot: toMemberSnapshot(vm),
      })
    })(),
    adjustCredits(entDeps, ctx, {
      entitlementId: vEnt.id,
      delta: 2,
      reason: 'gift',
      note: 'stres testi',
    }),
  ])

  const finalEnt = (await ents.getEntitlement(ctx, vEnt.id))!
  const c = finalEnt.credits!
  const derived = c.granted + c.restored - c.consumed - c.held - c.revoked - c.expired
  // Her OWN live reservations — she may still be sitting in an earlier class from scenario 3 or 5.
  const herLive = (await resRepo.listByMember(ctx, victim)).filter((r) => r.status === 'booked').length
  const newlyBooked = herLive - (beforeLedger?.held ?? 0)

  // Whatever order they landed in, BOTH must have landed: +2 restored, and the hold if the booking
  // went through. A lost update shows up as a `restored` of 0 or as a `held` that does not match the
  // reservations she actually holds.
  expect('kredi düzeltmesi kayboldu mu?', c.restored, 2)
  expect('tutulan kredi = onun gerçek rezervasyonları (kayıp yok)', c.held, herLive)
  expect('defter hâlâ tutuyor (E1)', derived, (beforeLedger?.derived ?? 0) + 2 - newlyBooked)

  console.log('\n════════════════════════════════════════════')
  if (failures === 0) {
    console.log('✅ STRESS: kapasite, sayaçlar ve para yarış altında bozulmadı.')
  } else {
    console.log(`❌ ${failures} kontrol başarısız.`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
