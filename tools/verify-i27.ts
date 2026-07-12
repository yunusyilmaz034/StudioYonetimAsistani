// I-27, proven end to end against the emulator: cancel a class that people are booked into, run
// the nightly sweep, and watch what happens to their credits.
//
// Before the guard: the sweep presumed `attended` and CONSUMED the credit — the studio cancels,
// the member pays. After: the credit is RELEASED.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  available,
  bookReservation,
  cancelSession,
  DEFAULT_STUDIO_CONFIG,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  fixedClock,
  instant,
  scheduleSession,
  selectEntitlement,
  sweepAutoResolve,
  systemClock,
  toMemberSnapshot,
  type ClassSessionId,
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

let pass = 0
let fail = 0
const ok = (l: string, c: boolean, d = ''): void => {
  console.log(`${c ? '✅' : '❌'} ${l}${d ? ' — ' + d : ''}`)
  if (c) pass++
  else fail++
}

async function main(): Promise<void> {
  const all = await members.list(ctx)
  const elif = all.find((m) => m.fullName.startsWith('Elif'))!

  // 1. A class two days out, and Elif books it.
  const service = (await sched.listServices(ctx)).find((s) => s.name === 'Reformer Pilates')!
  const room = (await sched.listRooms(ctx))[0]!
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
  const created = await scheduleSession(
    { repo: sched, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG },
    ctx,
    {
      serviceId: service.id, branchId: room.branchId, branchName: 'Merkez Şube',
      roomId: room.id, trainerId: null, trainerName: null,
      date, startTime: '08:00', durationMinutes: 50, capacity: 8,
    },
  )
  if (!created.ok) throw new Error('scheduleSession failed')
  const sessionId = created.value.sessionId as ClassSessionId
  const session = (await sched.getSession(ctx, sessionId))!

  const candidates = await ents.listActiveByMember(ctx, elif.id)
  const chosen = selectEntitlement(candidates, session, systemClock.now())!
  const booked = await bookReservation(
    { repo: res, entitlements: ents, clock: systemClock },
    ctx,
    { memberId: elif.id, memberSnapshot: toMemberSnapshot(elif), sessionId, entitlementId: chosen.id },
  )
  ok('Kurulum: üye derse rezerve edildi', booked.ok)

  const beforeLedger = (await ents.listActiveByMember(ctx, elif.id)).find((e) => e.id === chosen.id)!.credits!
  const availBefore = available(beforeLedger)
  console.log(`   kredi: available=${availBefore} held=${beforeLedger.held} consumed=${beforeLedger.consumed}`)

  // 2. The studio cancels the class. (Today this does NOT touch the reservation.)
  const cancelled = await cancelSession(
    { repo: sched, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG },
    ctx,
    { sessionId, reason: 'Eğitmen hasta' },
  )
  ok('Stüdyo dersi iptal etti', cancelled.ok)
  const stranded = (await res.getReservation(ctx, booked.ok ? booked.value.reservationId : ('x' as never)))!
  ok('Rezervasyon hâlâ "booked" — seans iptali ona dokunmuyor', stranded.status === 'booked')

  // 3. The nightly sweep runs, AFTER the class would have ended.
  const afterClass = instant(session.endsAt + 4 * 3_600_000)
  const summary = await sweepAutoResolve(
    { repo: res, entitlements: ents, clock: fixedClock(afterClass) },
    ctx,
    afterClass,
  )
  console.log(`   sweep: ${JSON.stringify(summary)}`)

  // 4. What happened to her credit?
  const after = (await res.getReservation(ctx, booked.ok ? booked.value.reservationId : ('x' as never)))!
  const afterLedger = (await ents.listActiveByMember(ctx, elif.id)).find((e) => e.id === chosen.id)!.credits!

  ok('I-27: rezervasyon "cancelled" (katıldı sayılmadı)', after.status === 'cancelled', `status=${after.status}`)
  ok('I-27: kredi SERBEST BIRAKILDI, tüketilmedi', after.creditEffect === 'released', `effect=${after.creditEffect}`)
  ok(
    'I-27: consumed sayacı ARTMADI — üye iptal edilen ders için ödemedi',
    afterLedger.consumed === beforeLedger.consumed,
    `consumed ${beforeLedger.consumed} → ${afterLedger.consumed}`,
  )
  ok(
    'I-27: available geri geldi',
    available(afterLedger) === availBefore + 1,
    `available ${availBefore} → ${available(afterLedger)}`,
  )

  const events = await db.collection(`studios/${SID}/events`)
    .where('related.reservationId', '==', after.id).get()
  const types = events.docs.map((d) => d.data().type as string)
  ok('I-27: attendance event’i YAZILMADI', !types.includes('reservation.auto_resolved') && !types.includes('reservation.attended'), types.join(', '))

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geçti, ${fail} kaldı`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
