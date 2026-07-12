// Block 1 (v1.22) proven end to end against the emulator: the Studio Calendar (D23), the
// Holiday/Closure operation (D21) and Bulk package operations (D22).
//
// What must be true when this finishes:
//   • marking a day writes INFORMATION and nothing else — no session moves, no credit moves
//   • a closure cancels its sessions, RELEASES every held credit (never consumes one) and
//     extends only the packages that overlap the closed days
//   • a frozen package is skipped by name, never silently
//   • applying the same operation twice is a refusal, not a second write (I-28)
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  applyBulk,
  applyClosure,
  available,
  bookReservation,
  DEFAULT_STUDIO_CONFIG,
  FirestoreCalendarRepository,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreOperationsRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  instant,
  markCalendarDay,
  planBulk,
  planClosure,
  previewBulk,
  previewClosure,
  removeCalendarDay,
  scheduleSession,
  selectEntitlement,
  systemClock,
  toMemberSnapshot,
  type BulkDeps,
  type ClassSessionId,
  type ClosureDeps,
  type ClosureWorld,
  type LocalDate,
  type Reservation,
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
const cal = new FirestoreCalendarRepository(db)
const ops = new FirestoreOperationsRepository(db)

const OFFSET_MIN = 180
const dayStartMs = (d: LocalDate): number => Date.parse(`${d}T00:00:00Z`) - OFFSET_MIN * 60_000
const dayEndMs = (d: LocalDate): number => Date.parse(`${d}T23:59:59Z`) - OFFSET_MIN * 60_000

// The same world-loaders the Server Actions use — the planners only ever see this.
const calDeps = { repo: cal, clock: systemClock }
const closureDeps: ClosureDeps = {
  repo: ops,
  clock: systemClock,
  scheduling: { repo: sched, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG },
  reservations: { repo: res, clock: systemClock },
  entitlements: { repo: ents, clock: systemClock },
  loadWorld: async (c, from, to): Promise<ClosureWorld> => {
    const [sessions, entitlements, mems] = await Promise.all([
      sched.listSessionsForDay(c, instant(dayStartMs(from)), instant(dayEndMs(to))),
      ents.listActive(c),
      members.list(c),
    ])
    const reservationsBySession = new Map<string, readonly Reservation[]>()
    await Promise.all(
      sessions.map(async (s) => {
        reservationsBySession.set(s.id, await res.listBySession(c, s.id))
      }),
    )
    return {
      sessions,
      reservationsBySession,
      entitlements,
      memberNames: new Map(mems.map((m) => [m.id as string, m.fullName])),
    }
  },
}
const bulkDeps: BulkDeps = {
  repo: ops,
  clock: systemClock,
  entitlements: { repo: ents, clock: systemClock },
  loadWorld: async (c) => {
    const [entitlements, mems] = await Promise.all([ents.listAll(c), members.list(c)])
    return { entitlements, memberNames: new Map(mems.map((m) => [m.id as string, m.fullName])) }
  },
}

let pass = 0
let fail = 0
const ok = (l: string, c: boolean, d = ''): void => {
  console.log(`${c ? '✅' : '❌'} ${l}${d ? ' — ' + d : ''}`)
  if (c) pass++
  else fail++
}
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

async function main(): Promise<void> {
  const all = await members.list(ctx)
  const elif = all.find((m) => m.fullName.startsWith('Elif'))!
  const service = (await sched.listServices(ctx)).find((s) => s.name === 'Reformer Pilates')!
  const room = (await sched.listRooms(ctx))[0]!

  // The closure window: two days, a week out, so nothing collides with the seeded demo week.
  const from = iso(Date.now() + 7 * 86_400_000) as LocalDate
  const to = iso(Date.now() + 8 * 86_400_000) as LocalDate

  // ── D23. Mark the days. This must move NOTHING. ────────────────────────────────────────
  const marked = await markCalendarDay(calDeps, ctx, {
    dateFrom: from,
    dateTo: to,
    timeFrom: null,
    timeTo: null,
    type: 'studio_closed',
    title: 'Yıllık bakım',
    note: null,
    branchIds: null,
  })
  ok('D23: gün işaretlendi', marked.ok)

  const daysBefore = await cal.listDays(ctx, from, to)
  ok('D23: takvim günü okunabiliyor', daysBefore.length === 1 && daysBefore[0]!.type === 'studio_closed')

  // ── Set the stage: a session inside the window, with a real booking on it. ─────────────
  const created = await scheduleSession(
    { repo: sched, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG },
    ctx,
    {
      serviceId: service.id,
      branchId: room.branchId,
      branchName: 'Merkez Şube',
      roomId: room.id,
      trainerId: null,
      trainerName: null,
      date: from,
      startTime: '09:00',
      durationMinutes: 50,
      capacity: 8,
    },
  )
  if (!created.ok) throw new Error('scheduleSession failed')
  const sessionId = created.value.sessionId as ClassSessionId
  const session = (await sched.getSession(ctx, sessionId))!
  ok('D23: kapalı güne seans oluşturmak ENGELLENMİYOR (uyarı, blok değil)', created.ok)

  // The booker must be a member who can ACTUALLY book this class today — re-runs against the same
  // emulator drain credits, and a test that silently books nobody proves nothing.
  let booker: { member: (typeof all)[number]; ent: NonNullable<ReturnType<typeof selectEntitlement>> } | null = null
  for (const m of [elif, ...all]) {
    const e = selectEntitlement(await ents.listActiveByMember(ctx, m.id), session, systemClock.now())
    if (e) {
      booker = { member: m, ent: e }
      break
    }
  }
  if (!booker) throw new Error('no member with a package covering this class')
  const elifM = booker.member
  const chosen = booker.ent
  const booked = await bookReservation(
    { repo: res, entitlements: ents, clock: systemClock },
    ctx,
    { memberId: elifM.id, memberSnapshot: toMemberSnapshot(elifM), sessionId, entitlementId: chosen.id },
  )
  if (!booked.ok) throw new Error('booking failed')
  const before = (await ents.listActiveByMember(ctx, elifM.id)).find((e) => e.id === chosen.id)!
  const availBefore = available(before.credits)
  const consumedBefore = before.credits.consumed
  const validUntilBefore = before.validUntil

  // ── D21 preview. Writes nothing. ───────────────────────────────────────────────────────
  const previewInput = {
    dateFrom: from,
    dateTo: to,
    reason: 'Yıllık bakım',
    scope: { kind: 'studio' as const },
    extensionDays: 2,
  }
  const closuresBeforePreview = (await ops.listClosures(ctx)).length
  const preview = await previewClosure(closureDeps, ctx, previewInput)
  ok(
    'D21: önizleme iptal edilecek seansı görüyor',
    preview.sessionsToCancel.some((s) => s.sessionId === sessionId),
    `${preview.sessionsToCancel.length} seans`,
  )
  ok('D21: önizleme uzatılacak paketleri görüyor', preview.entitlementsToExtend.length > 0)
  const closuresAfterPreview = (await ops.listClosures(ctx)).length
  ok(
    'D21: önizleme HİÇBİR ŞEY YAZMADI',
    closuresAfterPreview === closuresBeforePreview,
    `${closuresBeforePreview} → ${closuresAfterPreview} kayıt`,
  )

  // ── D21 apply. ─────────────────────────────────────────────────────────────────────────
  const planned = await planClosure(closureDeps, ctx, previewInput)
  if (!planned.ok) throw new Error('planClosure failed')
  const applied = await applyClosure(closureDeps, ctx, planned.value.closureId)
  ok('D21: kapanış uygulandı', applied.ok)
  if (!applied.ok) throw new Error('applyClosure failed')
  const summary = applied.value
  console.log(`   özet: ${JSON.stringify(summary)}`)

  const sessionAfter = (await sched.getSession(ctx, sessionId))!
  const reservationAfter = (await res.getReservation(ctx, booked.value.reservationId))!
  const entAfter = (await ents.listActiveByMember(ctx, elifM.id)).find((e) => e.id === chosen.id)!

  ok('D21: seans iptal edildi', sessionAfter.status === 'cancelled', sessionAfter.status)
  ok('D21: rezervasyon iptal edildi', reservationAfter.status === 'cancelled', reservationAfter.status)
  ok(
    'D21: kredi SERBEST BIRAKILDI, tüketilmedi (I-14)',
    reservationAfter.creditEffect === 'released' && entAfter.credits.consumed === consumedBefore,
    `effect=${reservationAfter.creditEffect} consumed ${consumedBefore} → ${entAfter.credits.consumed}`,
  )
  // Every credit this closure released on THIS package comes back — the studio cancelled, so
  // the member pays nothing. (She may have had more than one class in the closed window.)
  const releasedHere = before.credits.held - entAfter.credits.held
  ok(
    'D21: serbest bırakılan her kredi available’a geri döndü',
    releasedHere >= 1 && available(entAfter.credits) === availBefore + releasedHere,
    `held ${before.credits.held} → ${entAfter.credits.held}, available ${availBefore} → ${available(entAfter.credits)}`,
  )

  ok(
    'D21: paket 2 gün uzatıldı',
    entAfter.validUntil === validUntilBefore + 2 * 86_400_000,
    `${iso(validUntilBefore)} → ${iso(entAfter.validUntil)}`,
  )

  // ── I-28: the same operation cannot be applied twice. ──────────────────────────────────
  const again = await applyClosure(closureDeps, ctx, planned.value.closureId)
  ok(
    'I-28: aynı kapanış İKİNCİ KEZ uygulanamıyor',
    !again.ok && again.error.code === 'operation_already_applied',
    again.ok ? 'yeniden uygulandı!' : again.error.code,
  )

  // ── D22 bulk: extend every active package by 3 days. ───────────────────────────────────
  const bulkInput = {
    action: { kind: 'extend_days' as const, days: 3 },
    scope: { kind: 'studio' as const },
    reason: 'gift' as const,
    note: 'Blok 1 doğrulaması',
  }
  const bulkPreview = await previewBulk(bulkDeps, ctx, bulkInput)
  ok('D22: önizleme etkilenecek paketleri sayıyor', bulkPreview.toApply.length > 0, `${bulkPreview.toApply.length} paket`)
  const frozenSkips = bulkPreview.skipped.filter((s) => s.reason === 'frozen')
  console.log(`   atlananlar: ${JSON.stringify(bulkPreview.skipped.map((s) => s.reason))}`)

  const bulkPlanned = await planBulk(bulkDeps, ctx, bulkInput)
  if (!bulkPlanned.ok) throw new Error('planBulk failed')
  const validUntilBeforeBulk = (await ents.listActiveByMember(ctx, elifM.id)).find((e) => e.id === chosen.id)!
    .validUntil
  const bulkApplied = await applyBulk(bulkDeps, ctx, bulkPlanned.value.bulkId)
  ok('D22: toplu işlem uygulandı', bulkApplied.ok)
  const entAfterBulk = (await ents.listActiveByMember(ctx, elifM.id)).find((e) => e.id === chosen.id)!
  ok(
    'D22: paket 3 gün daha uzadı',
    entAfterBulk.validUntil === validUntilBeforeBulk + 3 * 86_400_000,
    `${iso(validUntilBeforeBulk)} → ${iso(entAfterBulk.validUntil)}`,
  )
  ok(
    'D22: dondurulmuş paketler ADIYLA atlandı (sessizce değil)',
    bulkPreview.skipped.every((s) => s.reason !== undefined),
    `${frozenSkips.length} dondurulmuş`,
  )
  const bulkAgain = await applyBulk(bulkDeps, ctx, bulkPlanned.value.bulkId)
  ok(
    'I-28: aynı toplu işlem İKİNCİ KEZ uygulanamıyor',
    !bulkAgain.ok && bulkAgain.error.code === 'operation_already_applied',
    bulkAgain.ok ? 'yeniden uygulandı!' : bulkAgain.error.code,
  )

  // ── The event log tells the whole story. ───────────────────────────────────────────────
  const evts = await db.collection(`studios/${SID}/events`).orderBy('recordedAt', 'desc').limit(40).get()
  const types = evts.docs.map((d) => d.data().type as string)
  ok('Event log: studio_calendar.day_marked yazıldı', types.includes('studio_calendar.day_marked'))
  ok('Event log: studio_closure.applied yazıldı', types.includes('studio_closure.applied'))
  ok('Event log: entitlement.extended yazıldı', types.includes('entitlement.extended'))
  ok(
    'Event log: iptal edilen ders için attendance event’i YOK',
    !types.includes('reservation.attended') && !types.includes('reservation.auto_resolved'),
  )

  // Clean up the marker so a re-run starts from the same place.
  await removeCalendarDay(calDeps, ctx, daysBefore[0]!.id)

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geçti, ${fail} kaldı`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()
