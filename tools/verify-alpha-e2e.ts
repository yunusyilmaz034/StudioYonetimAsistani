// PRODUCT ALPHA — END TO END, a studio's day, against the emulator.
//
// Not a unit test and not a smoke test: it is the **whole chain**, in the order reception performs it,
// using the SAME use-cases the screens call. Every step asserts the thing the studio would actually
// notice if it broke — a credit that did not come back, a class booked at midnight, money that
// appears nowhere.
//
//   setup → üye → paket sat → tahsilat → rezervasyon → taşı → iptal → toplu işlem
//        → check-in → dondur/çöz → çalışma saatleri → raporlar → makbuz → import → KVKK → dashboard
//
// A failing step prints what was expected and what happened, and exits non-zero.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import {
  applyBulkCancel,
  applyBulkMove,
  bookReservation,
  cancelReservation,
  checkWorkingHours,
  collect,
  createRoom,
  createService,
  DEFAULT_STUDIO_CONFIG,
  eraseMember,
  FirestoreCatalogRepository,
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreFinanceRepository,
  FirestoreMemberRepository,
  FirestorePiiPurger,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  freezeEntitlement,
  instant,
  isClean,
  localDateAt,
  money,
  moneyByEntitlement,
  moveReservation,
  openBranch,
  openDrawer,
  previewBulkCancel,
  projectDaily,
  readBulutGymMembers,
  recordCheckIn,
  registerMember,
  scheduleSession,
  selectEntitlement,
  sellPackage,
  systemClock,
  toMemberSnapshot,
  unfreezeEntitlement,
  validateMembers,
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

const SID = `std_e2e_${Date.now()}` as StudioId
const BRANCH = 'brn_1' as BranchId
const ctx: TenantContext = {
  studioId: SID,
  branchIds: [BRANCH],
  role: 'receptionist',
  actor: { type: 'receptionist', id: 'usr_reception' as never },
}
const ownerCtx: TenantContext = { ...ctx, role: 'owner', actor: { type: 'owner', id: 'usr_owner' as never } }
const adminCtx: TenantContext = {
  ...ctx,
  role: 'platform_admin',
  actor: { type: 'platform_admin', id: 'usr_admin' as never },
}

// ── deps, exactly as the Server Actions build them ────────────────────────────────────────
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
const bulkDeps = {
  ...resDeps,
  async loadWorld(c: TenantContext, input: { sessionId: ClassSessionId; targetSessionId: ClassSessionId | null }) {
    const session = await sched.getSession(c, input.sessionId)
    if (!session) throw new Error('session missing')
    const roster = (await resRepo.listBySession(c, input.sessionId)).filter((r) => r.status === 'booked')
    const target = input.targetSessionId ? await sched.getSession(c, input.targetSessionId) : null
    const targetRoster = input.targetSessionId ? await resRepo.listBySession(c, input.targetSessionId) : []
    const ledger = new Map()
    for (const id of new Set(roster.map((r) => r.entitlementId as string))) {
      const e = await ents.getEntitlement(c, id as EntitlementId)
      if (e) ledger.set(id, e)
    }
    return {
      session,
      reservations: roster,
      target,
      targetMemberIds: new Set(targetRoster.filter((r) => r.status === 'booked').map((r) => r.memberId as string)),
      entitlements: ledger,
    }
  },
}
const sellDeps = { finance: financeDeps, entitlements: entDeps }

// ── the harness ───────────────────────────────────────────────────────────────────────────
let failures = 0
const ok = (label: string, detail = '') => console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`)
const bad = (label: string, detail: string) => {
  failures++
  console.log(`  ❌ ${label} — ${detail}`)
}
const expect = (label: string, actual: unknown, wanted: unknown) =>
  actual === wanted ? ok(label, String(actual)) : bad(label, `beklenen ${String(wanted)}, gelen ${String(actual)}`)
const step = (n: string) => console.log(`\n── ${n} ────────────────────────────────────────────`)

const PRICE = 300_000
const dayAfter = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const creditsOf = async (id: EntitlementId): Promise<number> => {
  const e = await ents.getEntitlement(ctx, id)
  if (!e?.credits) return -1
  const c = e.credits
  return c.granted + c.restored - c.consumed - c.held - c.revoked - c.expired
}

async function main(): Promise<void> {
  // ═══ SETUP — a studio defines itself, exactly as the settings screen now lets it ═════════
  step('KURULUM: ders türü · salon · ürün · çalışma saatleri')

  await db.doc(`studios/${SID}/settings/studio`).set({
    timeZone: 'Europe/Istanbul',
    defaultCancellationWindowHours: 6,
    defaultSessionDurationMinutes: 50,
    lowCreditThreshold: 2,
    discountCeilingPercent: 20,
    // Open 10:00–21:00 every day except Sunday. This is the rule AG-1 now enforces.
    workingHours: {
      0: null,
      1: { open: '10:00', close: '21:00' },
      2: { open: '10:00', close: '21:00' },
      3: { open: '10:00', close: '21:00' },
      4: { open: '10:00', close: '21:00' },
      5: { open: '10:00', close: '21:00' },
      6: { open: '10:00', close: '21:00' },
    },
  })

  const svc = await createService(schedDeps, ownerCtx, {
    name: 'Reformer',
    category: 'pilates_group',
    policy: {
      maxDaysInAdvance: 14,
      cancellationWindowHours: 6,
      lateCancellationConsumesCredit: true,
      noShowConsumesCredit: false,
      attendanceDefaultOutcome: 'attended',
      autoResolveAfterMinutes: 15,
      allowMemberSelfBooking: false,
    },
  })
  if (!svc.ok) throw new Error(`service: ${svc.error.code}`)
  ok('ders türü oluşturuldu', 'Reformer')

  const room = await createRoom(schedDeps, ownerCtx, { branchId: BRANCH, name: 'Salon 1', capacity: 8 })
  if (!room.ok) throw new Error(`room: ${room.error.code}`)
  ok('salon oluşturuldu', 'Salon 1 · 8 kişi')

  const productId = 'prd_reformer8' as ProductId
  await db.doc(`studios/${SID}/products/${productId}`).set({
    name: '8 Ders Reformer',
    category: 'pilates_group',
    type: 'credit',
    creditCount: 8,
    durationDays: 60,
    listPrice: PRICE,
    priceInKurus: PRICE,
    freezeAllowanceDays: 7,
    serviceIds: [svc.value.serviceId],
    active: true,
  })
  ok('ürün kataloğa girdi', '8 Ders Reformer · 3.000 ₺')

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
  const drw = await openDrawer(financeDeps, ctx, { drawerId: 'drw_main', openingFloat: money(0) })
  if (!drw.ok) throw new Error(`drawer: ${drw.error.code}`)
  ok('kasa açıldı')

  await openBranch({ repo: checkin, clock: systemClock }, ctx, { branchId: BRANCH })
  ok('şube açıldı')

  // ═══ 1. ÜYE ══════════════════════════════════════════════════════════════════════════════
  step('1. ÜYE OLUŞTUR')
  const reg = await registerMember(memberDeps, ctx, {
    fullName: 'Ayşe Yılmaz',
    phone: '+905321112233',
    homeBranchId: BRANCH,
    email: null,
    birthDate: null,
    notes: null,
    emergencyContact: null,
  })
  if (!reg.ok) throw new Error(`member: ${reg.error.code}`)
  const ayse = reg.value.memberId as MemberId
  ok('üye kaydedildi', 'Ayşe Yılmaz')

  const dupe = await registerMember(memberDeps, ctx, {
    fullName: 'Başkası',
    phone: '+905321112233',
    homeBranchId: BRANCH,
    email: null,
    birthDate: null,
    notes: null,
    emergencyContact: null,
  })
  expect('aynı telefonla ikinci üye REDDEDİLDİ (I-21)', dupe.ok, false)

  // ═══ 2. PAKET SAT — para deftere ═════════════════════════════════════════════════════════
  step('2. PAKET SAT (yarısı peşin)')
  const product = await new FirestoreCatalogRepository(db).getProduct(ctx, productId)
  if (!product) throw new Error('product missing')

  const subscription = {
    memberId: ayse,
    productId,
    productSnapshot: {
      productId,
      name: product.name,
      category: product.category,
      grant: { kind: 'credits' as const, credits: 8, validForDays: 60 },
      listPrice: money(PRICE),
      serviceIds: product.serviceIds,
    },
    policyRef: { policyId: productId as string, version: 1 },
    priceAgreed: money(PRICE),
    validFrom: Date.now(),
    validUntil: null,
    freezeDays: 7,
    creditOverride: null,
    collectedAmount: money(0),
    method: 'cash' as const,
    note: '',
  }

  const sold = await sellPackage(sellDeps, ctx, {
    branchId: BRANCH,
    subscription,
    payment: {
      amount: money(150_000), // half now — selling on account is legal
      method: 'cash',
      receivedAt: instant(Date.now()),
      drawerId: 'drw_main',
      giftCardCode: null,
      note: null,
    },
    discountCeilingPercent: 20,
  })
  if (!sold.ok) throw new Error(`sell: ${JSON.stringify(sold.error)}`)
  const entId = sold.value.entitlementId
  ok('paket satıldı', '3.000 ₺ · 1.500 ₺ peşin')

  const ledger1 = await moneyByEntitlement(financeDeps, ctx, ayse)
  expect('defterde kalan borç', ledger1.get(entId as string)?.due.amount, 150_000)
  expect('kredi verildi', await creditsOf(entId), 8)

  // ═══ 3. TAHSİLAT — kalan borç ════════════════════════════════════════════════════════════
  step('3. TAHSİLAT AL (kalan 1.500 ₺)')
  const col = await collect(financeDeps, ctx, {
    paymentId: `pay_rest_${Date.now()}`,
    memberId: ayse,
    branchId: BRANCH,
    amount: money(150_000),
    method: 'cash',
    receivedAt: instant(Date.now()),
    drawerId: 'drw_main',
    giftCardCode: null,
    note: null,
  })
  if (!col.ok) throw new Error(`collect: ${col.error.code}`)
  const ledger2 = await moneyByEntitlement(financeDeps, ctx, ayse)
  expect('borç kapandı', ledger2.get(entId as string)?.due.amount, 0)

  const drawerNow = (await finance.listDrawers(ctx))[0]
  expect('kasada beklenen tutar', drawerNow?.expected.amount, 300_000)

  // ═══ 4. REZERVASYON ══════════════════════════════════════════════════════════════════════
  step('4. REZERVASYON OLUŞTUR')
  const s1 = await scheduleSession(schedDeps, ownerCtx, {
    serviceId: svc.value.serviceId as ServiceId,
    branchId: BRANCH,
    branchName: 'Merkez',
    roomId: room.value.roomId,
    trainerId: null,
    trainerName: null,
    date: dayAfter(2),
    startTime: '19:00',
    durationMinutes: 50,
    capacity: 8,
  })
  if (!s1.ok) throw new Error(`session: ${JSON.stringify(s1.error)}`)
  ok('ders oluşturuldu', `${dayAfter(2)} 19:00`)

  const member = await members.findById(ctx, ayse)
  const session1 = await sched.getSession(ctx, s1.value.sessionId)
  const candidates = await ents.listActiveByMember(ctx, ayse)
  const chosen = selectEntitlement(candidates, session1!, instant(Date.now()))
  if (!chosen) throw new Error('no bookable entitlement')

  const booked = await bookReservation(resDeps, ctx, {
    sessionId: s1.value.sessionId,
    entitlementId: chosen.id,
    memberId: ayse,
    memberSnapshot: toMemberSnapshot(member!),
  })
  if (!booked.ok) throw new Error(`book: ${booked.error.code}`)
  const resId = booked.value.reservationId as ReservationId
  expect('rezervasyon kredi TUTTU (harcamadı)', await creditsOf(entId), 7)

  // ═══ 5. TAŞI ═════════════════════════════════════════════════════════════════════════════
  step('5. REZERVASYON TAŞI')
  const s2 = await scheduleSession(schedDeps, ownerCtx, {
    serviceId: svc.value.serviceId as ServiceId,
    branchId: BRANCH,
    branchName: 'Merkez',
    roomId: room.value.roomId,
    trainerId: null,
    trainerName: null,
    date: dayAfter(3),
    startTime: '19:00',
    durationMinutes: 50,
    capacity: 8,
  })
  if (!s2.ok) throw new Error(`session2: ${JSON.stringify(s2.error)}`)

  const moved = await moveReservation(resDeps, ctx, {
    reservationId: resId,
    targetSessionId: s2.value.sessionId,
  })
  if (!moved.ok) throw new Error(`move: ${moved.error.code}`)
  const afterMove = await resRepo.getReservation(ctx, resId)
  expect('rezervasyon yeni derse taşındı', afterMove?.classSessionId, s2.value.sessionId)
  expect('taşıma krediyi HAREKET ETTİRMEDİ', await creditsOf(entId), 7)

  // ═══ 6. İPTAL ════════════════════════════════════════════════════════════════════════════
  step('6. REZERVASYON İPTAL (pencere içinde)')
  const cancelled = await cancelReservation(resDeps, ctx, { reservationId: resId })
  if (!cancelled.ok) throw new Error(`cancel: ${cancelled.error.code}`)
  expect('kredi İADE edildi', await creditsOf(entId), 8)

  // ═══ 7. TOPLU İŞLEMLER ═══════════════════════════════════════════════════════════════════
  step('7. TOPLU İŞLEMLER')
  // Three more members, each with a package, all booked into s1.
  const others: MemberId[] = []
  for (let i = 0; i < 3; i++) {
    const r = await registerMember(memberDeps, ctx, {
      fullName: `Üye ${i + 1}`,
      phone: `+90532111${String(4000 + i).padStart(4, '0')}`,
      homeBranchId: BRANCH,
      email: null,
      birthDate: null,
      notes: null,
      emergencyContact: null,
    })
    if (!r.ok) throw new Error(`member ${i}: ${r.error.code}`)
    const mid = r.value.memberId as MemberId
    others.push(mid)

    const s = await sellPackage(sellDeps, ctx, {
      branchId: BRANCH,
      subscription: { ...subscription, memberId: mid },
      payment: {
        amount: money(PRICE),
        method: 'cash',
        receivedAt: instant(Date.now()),
        drawerId: 'drw_main',
        giftCardCode: null,
        note: null,
      },
      discountCeilingPercent: 20,
    })
    if (!s.ok) throw new Error(`sell ${i}: ${JSON.stringify(s.error)}`)

    const m = await members.findById(ctx, mid)
    const cands = await ents.listActiveByMember(ctx, mid)
    const e = selectEntitlement(cands, (await sched.getSession(ctx, s1.value.sessionId))!, instant(Date.now()))
    if (!e) throw new Error('no entitlement')
    const b = await bookReservation(resDeps, ctx, {
      sessionId: s1.value.sessionId,
      entitlementId: e.id,
      memberId: mid,
      memberSnapshot: toMemberSnapshot(m!),
    })
    if (!b.ok) throw new Error(`book ${i}: ${b.error.code}`)
  }
  ok('üç üye derse kaydedildi')

  const preview = await previewBulkCancel(bulkDeps, ctx, {
    sessionId: s1.value.sessionId,
    reservationIds: [],
  })
  expect('toplu iptal önizlemesi üç satır', preview.length, 3)
  expect('önizleme: kredi İADE edilecek diyor', preview[0]?.effect, 'released')

  const bulkMoved = await applyBulkMove(bulkDeps, ctx, {
    sessionId: s1.value.sessionId,
    targetSessionId: s2.value.sessionId,
    reservationIds: [],
    overrideReason: null,
  })
  expect('toplu taşıma: üçü de taşındı', bulkMoved.applied, 3)
  expect('toplu taşıma: hiçbiri reddedilmedi', bulkMoved.failed.length, 0)

  const bulkCancelled = await applyBulkCancel(bulkDeps, ctx, {
    sessionId: s2.value.sessionId,
    reservationIds: [],
  })
  expect('toplu iptal: üçü de iptal edildi', bulkCancelled.applied, 3)

  // ═══ 8. CHECK-IN ═════════════════════════════════════════════════════════════════════════
  step('8. CHECK-IN')
  const ci = await recordCheckIn({ repo: checkin, clock: systemClock }, ctx, {
    memberId: ayse,
    branchId: BRANCH,
    method: 'qr',
    occurredAt: instant(Date.now()),
    commandId: null,
  })
  if (!ci.ok) throw new Error(`checkin: ${ci.error.code}`)
  const presence = await checkin.listPresence(ctx, BRANCH)
  expect('üye içeride görünüyor', presence.length, 1)
  expect('check-in kredi HARCAMADI', await creditsOf(entId), 8)

  // ═══ 9. DONDUR / ÇÖZ ═════════════════════════════════════════════════════════════════════
  step('9. PAKET DONDUR / ÇÖZ')
  const before = await ents.getEntitlement(ctx, entId)
  const today = localDateAt(instant(Date.now()), 180)
  const frozen = await freezeEntitlement(entDeps, ctx, {
    entitlementId: entId,
    from: today,
    hasUpcomingReservation: false,
  })
  if (!frozen.ok) throw new Error(`freeze: ${frozen.error.code}`)
  const isFrozen = await ents.getEntitlement(ctx, entId)
  expect('paket donduruldu', isFrozen?.status, 'frozen')

  // Three days later she comes back.
  const backOn = localDateAt(instant(Date.now() + 3 * 86_400_000), 180)
  const thawed = await unfreezeEntitlement(entDeps, ctx, { entitlementId: entId, to: backOn })
  if (!thawed.ok) throw new Error(`unfreeze: ${thawed.error.code}`)
  const after = await ents.getEntitlement(ctx, entId)
  expect('paket çözüldü', after?.status, 'active')
  if ((after?.validUntil ?? 0) >= (before?.validUntil ?? 0)) {
    ok('bitiş tarihi dondurulan kadar ileri gitti')
  } else {
    bad('dondurma uzatması', 'validUntil geriye gitti')
  }

  // ═══ 10. ÇALIŞMA SAATLERİ (AG-1) ═════════════════════════════════════════════════════════
  step('10. ÇALIŞMA SAATLERİ UYGULANIYOR MU?')
  const sunday = (() => {
    const d = new Date(Date.now() + 86_400_000)
    while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
  })()
  const onSunday = await scheduleSession(schedDeps, ownerCtx, {
    serviceId: svc.value.serviceId as ServiceId,
    branchId: BRANCH,
    branchName: 'Merkez',
    roomId: room.value.roomId,
    trainerId: null,
    trainerName: null,
    date: sunday,
    startTime: '12:00',
    durationMinutes: 50,
    capacity: 8,
  })
  expect('PAZAR günü ders REDDEDİLDİ', onSunday.ok, false)
  if (!onSunday.ok) expect('  sebep', onSunday.error.code, 'studio_closed_on_day')

  const lateClass = await scheduleSession(schedDeps, ownerCtx, {
    serviceId: svc.value.serviceId as ServiceId,
    branchId: BRANCH,
    branchName: 'Merkez',
    roomId: room.value.roomId,
    trainerId: null,
    trainerName: null,
    date: dayAfter(2),
    startTime: '22:00',
    durationMinutes: 50,
    capacity: 8,
  })
  expect('KAPANIŞ SONRASI ders REDDEDİLDİ', lateClass.ok, false)

  const studioHours = await hours.getStudioHours(ctx)
  const verdict = checkWorkingHours(studioHours, instant(Date.now()), instant(Date.now() + 3_600_000))
  ok('çalışma saatleri motoru okunuyor', verdict.ok ? 'açık' : 'kapalı')

  // ═══ 11. RAPORLARA YANSIMASI ═════════════════════════════════════════════════════════════
  step('11. RAPORLARA YANSIMASI')
  const from = Date.now() - 86_400_000
  const to = Date.now() + 86_400_000
  const sales = await finance.listSalesBetween(ctx, from, to)
  const payments = await finance.listPaymentsBetween(ctx, from, to)
  expect('satış raporu: 4 satış (1 Ayşe + 3 üye)', sales.length, 4)
  expect('tahsilat raporu: 5 tahsilat (2 Ayşe + 3 üye)', payments.length, 5)

  const totalSold = sales.reduce((n, s) => n + s.total.amount, 0)
  const totalPaid = payments.reduce((n, p) => n + p.amount.amount, 0)
  expect('satılan toplam', totalSold, 4 * PRICE)
  expect('tahsil edilen toplam', totalPaid, 4 * PRICE)

  // ═══ 12. MAKBUZ ══════════════════════════════════════════════════════════════════════════
  step('12. MAKBUZ')
  const receiptLedger = await moneyByEntitlement(financeDeps, ctx, ayse)
  const slip = receiptLedger.get(entId as string)
  expect('makbuzdaki ödenen tutar', slip?.paid.amount, PRICE)
  expect('makbuzdaki kalan', slip?.due.amount, 0)
  expect('makbuzdaki ödeme yöntemi', slip?.method, 'cash')

  // ═══ 13. GÖSTERGE PANELİ / HAREKET MERKEZİ ═══════════════════════════════════════════════
  step('13. GÖSTERGE PANELİ & HAREKET MERKEZİ')
  const eventDocs = await db.collection(`studios/${SID}/events`).get()
  let salesKurus = 0
  let collectedKurus = 0
  let bookings = 0
  let checkIns = 0
  let newMembers = 0
  for (const doc of eventDocs.docs) {
    const e = doc.data()
    const inc = projectDaily(
      { type: e.type, occurredAt: instant(e.occurredAt.toMillis()), payload: e.payload } as never,
      180,
    )
    if (!inc) continue
    salesKurus += inc.counters.salesKurus ?? 0
    collectedKurus += inc.counters.collectedKurus ?? 0
    bookings += inc.counters.bookings ?? 0
    checkIns += inc.counters.checkIns ?? 0
    newMembers += inc.counters.newMembers ?? 0
  }
  expect('dashboard · satış', salesKurus, 4 * PRICE)
  expect('dashboard · tahsilat', collectedKurus, 4 * PRICE)
  expect('dashboard · yeni üye', newMembers, 4)
  expect('dashboard · rezervasyon', bookings, 4)
  expect('dashboard · check-in', checkIns, 1)
  ok('hareket merkezi', `${eventDocs.size} event yazıldı`)

  // ═══ 14. IMPORT ══════════════════════════════════════════════════════════════════════════
  step('14. BULUTGYM IMPORT')
  // Two good rows, and two the file cannot be trusted about: a nameless one and an unreadable phone.
  // Neither is guessed, neither is fixed, and ONE of them blocks the whole run.
  const csv =
    'ad;soyad;telefon\n' +
    'Fatma;Demir;0532 999 88 77\n' +
    'Zeynep;Kaya;05329998878\n' +
    ';;05329998879\n' +
    'Ali;Veli;12\n'
  const report = validateMembers(readBulutGymMembers(csv))
  expect('import: 4 satır okundu', report.total, 4)
  expect('import: 2 geçerli', report.valid.length, 2)
  expect('import: 2 REDDEDİLDİ (adsız + okunamayan telefon)', report.rejected.length, 2)
  expect('import: hiçbiri tahmin edilmedi', report.rejected.map((r) => r.reason).sort().join(','), 'missing_name,phone_not_normalisable')
  expect('import: dosya temiz DEĞİL → tüm koşum engellendi', isClean(report), false)

  // ═══ 15. KVKK ════════════════════════════════════════════════════════════════════════════
  step('15. KVKK ANONİMLEŞTİRME')
  const eventsBefore = (await db.collection(`studios/${SID}/events`).get()).size
  const erased = await eraseMember({ repo: members, clock: systemClock }, adminCtx, {
    memberId: others[0]!,
    reason: 'kvkk_request',
    note: 'Üye talep etti',
  })
  if (!erased.ok) throw new Error(`erase: ${erased.error.code}`)
  await new FirestorePiiPurger(db).purge(SID, others[0]!)

  const gone = await members.findById(ctx, others[0]!)
  expect('üye kaydı mezar taşı oldu', Boolean(gone?.erased), true)
  expect('adı silindi', gone?.fullName !== 'Üye 1', true)

  const eventsAfter = (await db.collection(`studios/${SID}/events`).get()).size
  expect('EVENT LOG’A DOKUNULMADI (sadece member.erased eklendi)', eventsAfter, eventsBefore + 1)

  const again = await eraseMember({ repo: members, clock: systemClock }, adminCtx, {
    memberId: others[0]!,
    reason: 'kvkk_request',
    note: null,
  })
  const eventsAfter2 = (await db.collection(`studios/${SID}/events`).get()).size
  expect('ikinci silme yeni event ÜRETMEDİ (idempotent)', eventsAfter2, eventsAfter)
  expect('  ve hata da vermedi', again.ok, true)

  // Reception may not erase. The domain refuses, not the screen.
  const byReception = await eraseMember({ repo: members, clock: systemClock }, ctx, {
    memberId: others[1]!,
    reason: 'kvkk_request',
    note: null,
  })
  expect('resepsiyon silemez (domain reddediyor)', byReception.ok, false)

  // ═══ SONUÇ ═══════════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════════════')
  if (failures === 0) {
    console.log('✅ PRODUCT ALPHA — uçtan uca senaryoların tamamı geçti.')
  } else {
    console.log(`❌ ${failures} adım başarısız.`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
