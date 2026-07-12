// Block 2 (v1.22) proven end to end against the emulator: D19 move · D18 recurring · D20 waitlist,
// plus the operation rules the owner locked on 2026-07-13 (OP-1…OP-5).
//
// What must be true when this finishes:
//   • a MOVE writes one `reservation.moved` event, keeps the same hold on the same package, and
//     is never recorded as a cancellation
//   • a recurring series books only classes that EXIST, and names every week it skips
//   • a waitlist entry holds NO credit (I-29), and promotion is what finally holds one
//   • every sub-write of an operation carries the SAME OperationId (OP-2)
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  applyRecurring,
  available,
  bookReservation,
  cancelReservation,
  DEFAULT_STUDIO_CONFIG,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreWaitlistRepository,
  instant,
  joinWaitlist,
  moveReservation,
  previewRecurring,
  promoteFromWaitlist,
  scheduleSession,
  selectEntitlement,
  systemClock,
  toMemberSnapshot,
  type ClassSessionId,
  type PromoteDeps,
  type RecurringDeps,
  type StudioId,
  type TenantContext,
} from '@studio/core'

process.env.FIRESTORE_EMULATOR_HOST ??= 'localhost:8080'
initializeApp({ projectId: 'demo-sos' })
const db = getFirestore()

const SID = 'std_demo' as StudioId
const ctx: TenantContext = {
  studioId: SID,
  branchIds: ['brn_demo' as never],
  role: 'owner',
  actor: { type: 'owner', id: 'usr_verify' as never },
}

const sched = new FirestoreSchedulingRepository(db)
const ents = new FirestoreEntitlementRepository(db)
const res = new FirestoreReservationRepository(db)
const members = new FirestoreMemberRepository(db)
const wait = new FirestoreWaitlistRepository(db)

const schedDeps = { repo: sched, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG }
const resDeps = { repo: res, clock: systemClock }

let pass = 0
let fail = 0
const ok = (l: string, c: boolean, d = ''): void => {
  console.log(`${c ? '✅' : '❌'} ${l}${d ? ' — ' + d : ''}`)
  if (c) pass++
  else fail++
}

const DAY = 86_400_000
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

async function makeSession(date: string, time: string, capacity = 8): Promise<ClassSessionId> {
  const service = (await sched.listServices(ctx)).find((s) => s.name === 'Reformer Pilates')!
  const room = (await sched.listRooms(ctx))[0]!
  const created = await scheduleSession(schedDeps, ctx, {
    serviceId: service.id,
    branchId: room.branchId,
    branchName: 'Merkez Şube',
    roomId: room.id,
    trainerId: null,
    trainerName: null,
    date,
    startTime: time,
    durationMinutes: 50,
    capacity,
  })
  if (!created.ok) throw new Error('scheduleSession failed')
  return created.value.sessionId as ClassSessionId
}

async function eventsFor(correlationId: string): Promise<readonly string[]> {
  const snap = await db
    .collection(`studios/${SID}/events`)
    .where('correlationId', '==', correlationId)
    .get()
  return snap.docs.map((d) => d.data().type as string)
}

async function main(): Promise<void> {
  const all = await members.list(ctx)
  const elif = all.find((m) => m.fullName.startsWith('Elif'))!

  // ── D19 — MOVE ──────────────────────────────────────────────────────────────────────────
  const fromId = await makeSession(iso(Date.now() + 3 * DAY), '07:00')
  const toId = await makeSession(iso(Date.now() + 4 * DAY), '07:00')
  const fromSession = (await sched.getSession(ctx, fromId))!

  const cand = await ents.listActiveByMember(ctx, elif.id)
  const chosen = selectEntitlement(cand, fromSession, systemClock.now())!
  const booked = await bookReservation(resDeps, ctx, {
    memberId: elif.id,
    memberSnapshot: toMemberSnapshot(elif),
    sessionId: fromId,
    entitlementId: chosen.id,
  })
  if (!booked.ok) throw new Error('booking failed')
  const beforeMove = (await ents.listActiveByMember(ctx, elif.id)).find((e) => e.id === chosen.id)!

  const moved = await moveReservation(resDeps, ctx, {
    reservationId: booked.value.reservationId,
    targetSessionId: toId,
  })
  ok('D19: rezervasyon taşındı', moved.ok)

  const afterMove = (await res.getReservation(ctx, booked.value.reservationId))!
  const entAfterMove = (await ents.listActiveByMember(ctx, elif.id)).find((e) => e.id === chosen.id)!
  const fromAfter = (await sched.getSession(ctx, fromId))!
  const toAfter = (await sched.getSession(ctx, toId))!

  ok('D19: rezervasyon yeni seansa bağlı', afterMove.classSessionId === toId)
  ok('D19: durum hâlâ "booked" — iptal DEĞİL', afterMove.status === 'booked', afterMove.status)
  ok(
    'D19: kredi kıpırdamadı (aynı pakette, hâlâ held)',
    afterMove.creditEffect === 'held' &&
      entAfterMove.credits.held === beforeMove.credits.held &&
      entAfterMove.credits.consumed === beforeMove.credits.consumed &&
      available(entAfterMove.credits) === available(beforeMove.credits),
    `held=${entAfterMove.credits.held} consumed=${entAfterMove.credits.consumed}`,
  )
  // The origin was empty before her booking, so a correct move puts it back to empty.
  ok('D19: eski seansta koltuk boşaldı', fromAfter.bookedCount === 0, `bookedCount=${fromAfter.bookedCount}`)
  ok('D19: yeni seansta koltuk doldu', toAfter.bookedCount === 1)

  const moveEvents = await db
    .collection(`studios/${SID}/events`)
    .where('related.reservationId', '==', afterMove.id)
    .get()
  const moveTypes = moveEvents.docs.map((d) => d.data().type as string)
  ok('D19: tam olarak bir reservation.moved event’i', moveTypes.filter((t) => t === 'reservation.moved').length === 1)
  ok(
    'D19: log’da İPTAL yok — iptal oranı şişmiyor',
    !moveTypes.includes('reservation.cancelled') && !moveTypes.includes('reservation.late_cancelled'),
    moveTypes.join(', '),
  )

  // ── D18 — RECURRING ────────────────────────────────────────────────────────────────────
  // A weekly slot: create the seed + weeks 1 and 3 only. Week 2 must be skipped BY NAME, and
  // no class may be invented for it.
  const seedDate = iso(Date.now() + 2 * DAY)
  const seedId = await makeSession(seedDate, '06:30')
  await makeSession(iso(Date.now() + 9 * DAY), '06:30')
  await makeSession(iso(Date.now() + 23 * DAY), '06:30')

  const recurringDeps: RecurringDeps = {
    repo: res,
    clock: systemClock,
    utcOffsetMinutes: 180,
    loadWorld: async (c, memberId, sessionId, weeks) => {
      const seed = await sched.getSession(c, sessionId)
      const member = await members.findById(c, memberId)
      if (!seed || !member) return null
      const [sessions, entitlements, memberReservations] = await Promise.all([
        sched.listSessionsForDay(c, instant(seed.startsAt), instant(seed.startsAt + (weeks + 1) * 7 * DAY)),
        ents.listActiveByMember(c, memberId),
        res.listByMember(c, memberId),
      ])
      return { seed, sessions, entitlements, memberReservations, memberSnapshot: toMemberSnapshot(member) }
    },
  }

  const sessionsBefore = (
    await sched.listSessionsForDay(ctx, instant(Date.now()), instant(Date.now() + 40 * DAY))
  ).length

  const plan = await previewRecurring(recurringDeps, ctx, { memberId: elif.id, sessionId: seedId, weeks: 3 })
  ok('D18: önizleme var olan 2 seansı buldu', plan?.toBook.length === 2, `${plan?.toBook.length} seans`)
  ok(
    'D18: olmayan hafta ADIYLA atlandı (no_session)',
    plan?.skipped.some((s) => s.reason === 'no_session') ?? false,
    JSON.stringify(plan?.skipped.map((s) => s.reason)),
  )
  const sessionsAfterPreview = (
    await sched.listSessionsForDay(ctx, instant(Date.now()), instant(Date.now() + 40 * DAY))
  ).length
  ok(
    'D18: önizleme HİÇBİR SEANS UYDURMADI ve hiçbir şey yazmadı',
    sessionsAfterPreview === sessionsBefore,
    `${sessionsBefore} → ${sessionsAfterPreview}`,
  )

  const applied = await applyRecurring(recurringDeps, ctx, { memberId: elif.id, sessionId: seedId, weeks: 3 })
  ok('D18: sabit rezervasyon uygulandı', applied.ok)
  if (!applied.ok) throw new Error('applyRecurring failed')
  ok('D18: 2 rezervasyon oluştu', applied.value.booked === 2, `booked=${applied.value.booked}`)

  // OP-2 — every booking of the series shares ONE operation id.
  const seriesEvents = await eventsFor(applied.value.operationId)
  ok(
    'OP-2: serinin tüm event’leri AYNI OperationId ile bağlı',
    seriesEvents.filter((t) => t === 'reservation.booked').length === 2 &&
      seriesEvents.filter((t) => t === 'entitlement.credit_held').length === 2,
    `${seriesEvents.length} event: ${[...new Set(seriesEvents)].join(', ')}`,
  )

  // ── D20 — WAITLIST ─────────────────────────────────────────────────────────────────────
  const fullId = await makeSession(iso(Date.now() + 5 * DAY), '20:30', 1) // capacity 1
  const fullSession = (await sched.getSession(ctx, fullId))!

  // The seat-taker must be someone who can actually book THIS class — a member without a covering
  // package would be refused, and the test would be measuring the wrong thing.
  let seatTaker: { member: (typeof all)[number]; entitlementId: string } | null = null
  for (const m of all) {
    if (m.id === elif.id) continue
    const e = selectEntitlement(await ents.listActiveByMember(ctx, m.id), fullSession, systemClock.now())
    if (e) {
      seatTaker = { member: m, entitlementId: e.id }
      break
    }
  }
  if (!seatTaker) throw new Error('no member with a package covering this class')
  const firstBooking = await bookReservation(resDeps, ctx, {
    memberId: seatTaker.member.id,
    memberSnapshot: toMemberSnapshot(seatTaker.member),
    sessionId: fullId,
    entitlementId: seatTaker.entitlementId as never,
  })
  ok('Kurulum: seans doldu (kapasite 1)', firstBooking.ok)

  const waitDeps: PromoteDeps = {
    repo: wait,
    clock: systemClock,
    scheduling: schedDeps,
    reservations: resDeps,
    loadEntitlements: (c, memberId) => ents.listActiveByMember(c, memberId),
  }

  const entBeforeWait = (await ents.listActiveByMember(ctx, elif.id)).find((e) => e.id === chosen.id)!
  const joined = await joinWaitlist(
    {
      ...waitDeps,
      hasBooking: async (sessionId, memberId) =>
        (await res.listBySession(ctx, sessionId)).some((r) => r.memberId === memberId && r.status === 'booked'),
    },
    ctx,
    { sessionId: fullId, memberId: elif.id, memberSnapshot: toMemberSnapshot(elif) },
  )
  ok('D20: dolu seansın bekleme listesine girildi', joined.ok)
  if (!joined.ok) throw new Error('joinWaitlist failed')

  const entAfterWait = (await ents.listActiveByMember(ctx, elif.id)).find((e) => e.id === chosen.id)!
  ok(
    'I-29: bekleme KREDİ TUTMAZ (held değişmedi)',
    entAfterWait.credits.held === entBeforeWait.credits.held &&
      available(entAfterWait.credits) === available(entBeforeWait.credits),
    `held ${entBeforeWait.credits.held} → ${entAfterWait.credits.held}`,
  )

  // A seat opens — and NOTHING happens on its own. That is the point (owner: no auto-promotion).
  await cancelReservation(resDeps, ctx, { reservationId: firstBooking.ok ? firstBooking.value.reservationId : ('x' as never) })
  const queueAfterSeat = await wait.listBySession(ctx, fullId)
  ok(
    'D20: yer açıldığında OTOMATİK terfi YOK — üye hâlâ bekliyor',
    queueAfterSeat.every((e) => e.status === 'waiting'),
    queueAfterSeat.map((e) => e.status).join(', '),
  )

  const promoted = await promoteFromWaitlist(waitDeps, ctx, { entryId: joined.value.entryId })
  ok('D20: personel elle terfi etti', promoted.ok)
  const entAfterPromote = (await ents.listActiveByMember(ctx, elif.id)).find((e) => e.id === chosen.id)!
  ok(
    'D20: terfi ANCAK ŞİMDİ kredi tutuyor',
    entAfterPromote.credits.held === entBeforeWait.credits.held + 1,
    `held ${entBeforeWait.credits.held} → ${entAfterPromote.credits.held}`,
  )
  const entry = (await wait.listBySession(ctx, fullId)).find((e) => e.id === joined.value.entryId)!
  ok('D20: kuyruk kaydı "promoted" ve rezervasyona bağlı', entry.status === 'promoted' && entry.reservationId !== null)

  const promoteEvents = await db
    .collection(`studios/${SID}/events`)
    .where('related.classSessionId', '==', fullId)
    .get()
  const promoTypes = promoteEvents.docs.map((d) => d.data().type as string)
  ok('D20: waitlist.joined ve waitlist.promoted yazıldı', promoTypes.includes('waitlist.joined') && promoTypes.includes('waitlist.promoted'))

  // OP-2 — the promotion and the booking it produced are ONE operation.
  const promoCorr = promoteEvents.docs
    .filter((d) => d.data().type === 'waitlist.promoted')
    .map((d) => d.data().correlationId as string)[0]!
  const promoOp = await eventsFor(promoCorr)
  ok(
    'OP-2: terfi + rezervasyon + kredi tutma AYNI OperationId altında',
    promoOp.includes('waitlist.promoted') && promoOp.includes('reservation.booked') && promoOp.includes('entitlement.credit_held'),
    promoOp.join(', '),
  )

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geçti, ${fail} kaldı`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
