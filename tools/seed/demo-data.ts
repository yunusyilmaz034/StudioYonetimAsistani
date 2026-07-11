// Rich demo business data for the emulator — members, catalogue, subscriptions,
// sessions, reservations, check-ins and some resolved history — so every screen
// (Dashboard, Members, Member Workspace, Reservations, Packages, Schedule) shows
// realistic data for the owner UI review.
//
// It seeds by calling the REAL @studio/core use-cases against the Admin SDK, so
// document shapes and events are guaranteed correct. Emulator-only, manual dev tool.
import {
  assignSubscription,
  bookReservation,
  createProduct,
  createRoom,
  createService,
  DEFAULT_STUDIO_CONFIG,
  FirestoreCatalogRepository,
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  fixedClock,
  instant,
  markAttendance,
  money,
  newCommandId,
  openBranch,
  recordCheckIn,
  registerMember,
  scheduleSession,
  selectEntitlement,
  systemClock,
  toMemberSnapshot,
  type ActorRef,
  type BranchId,
  type Category,
  type ClassSessionId,
  type Clock,
  type EntitlementId,
  type Grant,
  type MemberId,
  type PaymentMethod,
  type ProductId,
  type RoomId,
  type SchedulingPolicy,
  type ServiceId,
  type StaffUserId,
  type StudioId,
  type TenantContext,
} from '@studio/core'

const STUDIO_ID = 'std_demo' as StudioId
const BRANCH_ID = 'brn_demo' as BranchId
const BRANCH_NAME = 'Merkez Şube'
const DAY = 86_400_000

const owner: ActorRef = { type: 'owner', id: 'usr_demo_owner' as StaffUserId }
const ctx: TenantContext = {
  studioId: STUDIO_ID,
  branchIds: [BRANCH_ID],
  role: 'owner',
  actor: owner,
}

// Repos are constructed lazily inside seedDemoData — their default getFirestore()
// must run AFTER the caller's initializeApp() (they would throw at import time).
let memberRepo!: FirestoreMemberRepository
let catalogRepo!: FirestoreCatalogRepository
let schedRepo!: FirestoreSchedulingRepository
let entRepo!: FirestoreEntitlementRepository
let resRepo!: FirestoreReservationRepository
let checkinRepo!: FirestoreCheckinRepository

let memberDeps!: { repo: FirestoreMemberRepository; clock: Clock }
let catalogDeps!: { repo: FirestoreCatalogRepository; clock: Clock }
let entDeps!: { repo: FirestoreEntitlementRepository; clock: Clock }
let checkinDeps!: { repo: FirestoreCheckinRepository; clock: Clock }
const schedDeps = (clock: Clock = systemClock) => ({ repo: schedRepo, clock, studioConfig: DEFAULT_STUDIO_CONFIG })
const resDeps = (clock: Clock = systemClock) => ({ repo: resRepo, clock })

function initRepos(): void {
  memberRepo = new FirestoreMemberRepository()
  catalogRepo = new FirestoreCatalogRepository()
  schedRepo = new FirestoreSchedulingRepository()
  entRepo = new FirestoreEntitlementRepository()
  resRepo = new FirestoreReservationRepository()
  checkinRepo = new FirestoreCheckinRepository()
  memberDeps = { repo: memberRepo, clock: systemClock }
  catalogDeps = { repo: catalogRepo, clock: systemClock }
  entDeps = { repo: entRepo, clock: systemClock }
  checkinDeps = { repo: checkinRepo, clock: systemClock }
}

function ok<T>(res: { ok: true; value: T } | { ok: false; error: unknown }, what: string): T {
  if (!res.ok) throw new Error(`${what} failed: ${JSON.stringify(res.error)}`)
  return res.value
}

const POLICY: SchedulingPolicy = {
  maxDaysInAdvance: 30,
  cancellationWindowHours: 6,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: true,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 180,
}

// studio-local YYYY-MM-DD / HH:MM helpers (offset +180, Europe/Istanbul)
const OFF = DEFAULT_STUDIO_CONFIG.utcOffsetMinutes
const localDateStr = (ms: number) => new Date(ms + OFF * 60_000).toISOString().slice(0, 10)
const localToUtc = (dateStr: string, hhmm: string) => Date.parse(`${dateStr}T${hhmm}:00Z`) - OFF * 60_000

export async function seedDemoData(trainerUid: string | null): Promise<void> {
  initRepos()
  const now = Date.now()
  const trainerName = 'Reyhan Yıldız'
  const trainerId = (trainerUid ?? null) as StaffUserId | null

  // 2. Branch occupancy (required before any check-in).
  ok(await openBranch(checkinDeps, ctx, { branchId: BRANCH_ID }), 'openBranch')

  // 4. Services (category is immutable and becomes the session category).
  const svcReformer = ok(
    await createService(schedDeps(), ctx, { name: 'Reformer Pilates', category: 'pilates_group', policy: POLICY }),
    'createService reformer',
  ).serviceId
  const svcFitness = ok(
    await createService(schedDeps(), ctx, { name: 'Fitness', category: 'fitness', policy: POLICY }),
    'createService fitness',
  ).serviceId
  const svcPt = ok(
    await createService(schedDeps(), ctx, { name: 'Kişisel Antrenman', category: 'private', policy: POLICY }),
    'createService pt',
  ).serviceId

  // Rooms (branchId must match sessions; capacity ≥ session capacity).
  const roomReformer = ok(
    await createRoom(schedDeps(), ctx, { branchId: BRANCH_ID, name: 'Reformer Salonu', capacity: 8 }),
    'createRoom reformer',
  ).roomId
  const roomFitness = ok(
    await createRoom(schedDeps(), ctx, { branchId: BRANCH_ID, name: 'Fitness Salonu', capacity: 12 }),
    'createRoom fitness',
  ).roomId

  // 5. Products (category must match the service category to be bookable).
  const pReformer10 = await product('Reformer 10 Ders', 'pilates_group', [svcReformer], 'credit', 60, 10, 450_000, 15, 1)
  const pReformer20 = await product('Reformer 20 Ders', 'pilates_group', [svcReformer], 'credit', 90, 20, 800_000, 15, 1)
  const pFitness = await product('Fitness Aylık', 'fitness', [svcFitness], 'period', 30, null, 120_000, 7, null)
  const pPt8 = await product('PT 8 Ders', 'private', [svcPt], 'credit', 60, 8, 640_000, 0, 1)

  // 6. Members (valid TR mobiles, unique). One birthday today for the dashboard widget.
  const today = localDateStr(now) // e.g. 2026-07-11
  const bdayToday = `1990-${today.slice(5)}` // same MM-DD, birthday today
  const elif = await member('Elif Şahin', '5301112201', bdayToday, 'Sabah seanslarını tercih ediyor.')
  const zeynep = await member('Zeynep Arslan', '5322223302', '1988-03-22', null)
  const merve = await member('Merve Doğan', '5333334403', '1995-11-05', 'Diz rahatsızlığı var.')
  const ayse = await member('Ayşe Yıldırım', '5344445504', '1992-01-17', null)
  const fatma = await member('Fatma Çelik', '5355556605', '1985-06-30', 'Ödeme bakiyesi takip edilecek.')
  const selin = await member('Selin Koç', '5366667706', '1998-09-12', null)
  const busra = await member('Büşra Aydın', '5377778807', '2000-04-25', null)
  await member('Derya Kaya', '5388889908', '1993-12-01', 'Yeni üye, henüz paket almadı.')

  // 7. Subscriptions — mix of paid-in-full and balance-due; one expiring soon.
  await subscribe(elif, pReformer10, 450_000) // paid full
  await subscribe(zeynep, pReformer20, 400_000) // balance due 400.000
  await subscribe(merve, pFitness, 120_000, now + 10 * DAY) // expiring in 10 days
  await subscribe(ayse, pPt8, 640_000)
  await subscribe(fatma, pReformer10, 0) // fully unpaid → balance
  await subscribe(selin, pReformer10, 450_000)
  await subscribe(busra, pFitness, 60_000) // partial

  // 8. Sessions — today (for the dashboard's "today" widgets; may already have started)
  //    plus future sessions (bookable) and one past (created via a backdated clock).
  const todayStr = localDateStr(now)
  await session(svcReformer, roomReformer, todayStr, '10:00', 50, 8, trainerId, trainerName)
  await session(svcReformer, roomReformer, todayStr, '18:00', 50, 8, trainerId, trainerName)
  await session(svcFitness, roomFitness, todayStr, '19:00', 60, 12, null, null)
  const up1 = await session(svcReformer, roomReformer, localDateStr(now + DAY), '18:00', 50, 8, trainerId, trainerName)
  const up2 = await session(svcReformer, roomReformer, localDateStr(now + 2 * DAY), '10:00', 50, 8, trainerId, trainerName)
  const up3 = await session(svcFitness, roomFitness, localDateStr(now + 3 * DAY), '19:00', 60, 12, null, null)

  // 9. Reservations into FUTURE sessions (must be after now to be bookable, I-9.1).
  await book(selin, up1)
  await book(elif, up1)
  await book(zeynep, up2)
  await book(elif, up2)
  await book(merve, up3) // fitness member → fitness session
  await book(busra, up3)

  // 10. Past history — a session 3 days ago. Book with a clock set to that morning
  //     (08:00, before the 10:00 session), then mark attendance at noon (after it).
  const pastDayStr = localDateStr(now - 3 * DAY)
  const pastBook = fixedClock(instant(localToUtc(pastDayStr, '08:00')))
  const pastResolveMs = localToUtc(pastDayStr, '12:00')
  const past1 = await session(svcReformer, roomReformer, pastDayStr, '10:00', 50, 8, trainerId, trainerName, pastBook)
  const rElif = await book(elif, past1, pastBook)
  const rSelin = await book(selin, past1, pastBook)
  if (rElif) {
    ok(
      await markAttendance(resDeps(fixedClock(instant(pastResolveMs))), ctx, {
        reservationId: rElif, outcome: 'attended', occurredAt: instant(pastResolveMs), commandId: newCommandId(),
      }),
      'markAttendance elif',
    )
  }
  if (rSelin) {
    ok(
      await markAttendance(resDeps(fixedClock(instant(pastResolveMs))), ctx, {
        reservationId: rSelin, outcome: 'no_show', occurredAt: instant(pastResolveMs), commandId: newCommandId(),
      }),
      'markAttendance selin',
    )
  }

  // Check-ins today → dashboard "inside now" + occupancy + member check-in history.
  ok(
    await recordCheckIn(checkinDeps, ctx, {
      memberId: elif, branchId: BRANCH_ID, method: 'reception', occurredAt: instant(now - 3_600_000), commandId: newCommandId(),
    }),
    'checkIn elif',
  )
  ok(
    await recordCheckIn(checkinDeps, ctx, {
      memberId: selin, branchId: BRANCH_ID, method: 'qr', occurredAt: instant(now - 1_800_000), commandId: newCommandId(),
    }),
    'checkIn selin',
  )

  process.stdout.write('seeded demo business data (members, catalogue, subscriptions, sessions, reservations, check-ins)\n')
}

// ── helpers ─────────────────────────────────────────────────────────────────
async function product(
  name: string,
  category: Category,
  serviceIds: readonly ServiceId[],
  type: 'credit' | 'period',
  durationDays: number,
  creditCount: number | null,
  priceInKurus: number,
  freezeAllowanceDays: number,
  dailyReservationLimit: number | null,
): Promise<ProductId> {
  const res = ok(
    await createProduct(catalogDeps, ctx, {
      name, category, serviceIds, type, durationDays, creditCount, priceInKurus,
      freezeAllowanceDays, dailyReservationLimit, cancellationAllowanceCount: null,
      description: `${name} — demo`,
    }),
    `createProduct ${name}`,
  )
  return res.productId
}

async function member(fullName: string, phone: string, birthDate: string, notes: string | null): Promise<MemberId> {
  const res = ok(
    await registerMember(memberDeps, ctx, {
      fullName, phone, homeBranchId: BRANCH_ID, email: null, birthDate, notes,
      emergencyContact: null,
    }),
    `registerMember ${fullName}`,
  )
  return res.memberId
}

async function subscribe(memberId: MemberId, productId: ProductId, collected: number, validUntil: number | null = null): Promise<void> {
  const product = await catalogRepo.getProduct(ctx, productId)
  if (!product) throw new Error(`product missing: ${productId}`)
  const grant: Grant =
    product.type === 'credit'
      ? { kind: 'credits', credits: product.creditCount ?? 0, validForDays: product.durationDays }
      : { kind: 'period', durationDays: product.durationDays, access: 'unlimited' }
  const method: PaymentMethod = 'cash'
  ok(
    await assignSubscription(entDeps, ctx, {
      memberId,
      productId: product.id,
      productSnapshot: {
        productId: product.id, name: product.name, category: product.category, grant, listPrice: money(product.priceInKurus),
      },
      policyRef: { policyId: product.id, version: 1 },
      priceAgreed: money(product.priceInKurus),
      validFrom: Date.now(),
      validUntil,
      freezeDays: product.freezeAllowanceDays > 0 ? product.freezeAllowanceDays : null,
      creditOverride: null,
      collectedAmount: money(collected),
      method,
      note: collected > 0 ? 'Demo tahsilat' : 'Demo — bakiye açık',
    }),
    `assignSubscription ${memberId}`,
  )
}

async function session(
  serviceId: ServiceId,
  roomId: RoomId,
  date: string,
  startTime: string,
  durationMinutes: number,
  capacity: number,
  trainerId: StaffUserId | null,
  trainerName: string | null,
  clock: Clock = systemClock,
): Promise<ClassSessionId> {
  const res = ok(
    await scheduleSession(schedDeps(clock), ctx, {
      serviceId,
      branchId: BRANCH_ID,
      branchName: BRANCH_NAME,
      roomId,
      trainerId,
      trainerName,
      date,
      startTime,
      durationMinutes,
      capacity,
    }),
    `scheduleSession ${date} ${startTime}`,
  )
  return res.sessionId
}

// Book with auto entitlement selection. Returns the reservationId, or null when the
// member has no bookable entitlement for the session's category (logged, not fatal).
async function book(
  memberId: MemberId,
  sessionId: ClassSessionId,
  clock: Clock = systemClock,
): Promise<string | null> {
  const [member, candidates, sess] = await Promise.all([
    memberRepo.findById(ctx, memberId),
    entRepo.listActiveByMember(ctx, memberId),
    schedRepo.getSession(ctx, sessionId),
  ])
  if (!member || !sess) return null
  const chosen = selectEntitlement(candidates, sess, clock.now())
  if (!chosen) {
    process.stdout.write(`  · book skipped (no bookable entitlement) member=${member.fullName}\n`)
    return null
  }
  const res = await bookReservation(resDeps(clock), ctx, {
    sessionId,
    entitlementId: chosen.id as EntitlementId,
    memberId,
    memberSnapshot: toMemberSnapshot(member),
  })
  if (!res.ok) {
    process.stdout.write(`  · book failed member=${member.fullName}: ${JSON.stringify(res.error)}\n`)
    return null
  }
  return res.value.reservationId
}
