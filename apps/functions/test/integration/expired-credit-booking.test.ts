import {
  available,
  bookReservation,
  createService,
  DEFAULT_STUDIO_CONFIG,
  expireEntitlement,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  money,
  purchaseEntitlement,
  registerMember,
  scheduleSession,
  systemClock,
  toMemberSnapshot,
  type BranchId,
  type SchedulingPolicy,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// SÜRESİ DOLMUŞ PAKETİN YANAN HAKKIYLA REZERVASYON — UÇTAN UCA (2026-10-02).
//
// Bu test bir hatanın üstüne yazıldı. Özellik 1 Eylül'de yapıldı, altı domain testi vardı, ve
// canlıda BİR KEZ BİLE çalışmadı. İki kopukluk vardı ve ikisi de katmanların ARASINDAydı:
//
//   1. `bookReservation`, `honourExpiredCredit` bayrağını `decideBooking`'e hiç geçirmiyordu.
//   2. Geçirse bile kredi kapısı kapalıydı: süre dolarken bütün haklar `expired` kovasına yakılır
//      ve `available` tam olarak 0 olur — ret kalkmıyor, adı `insufficient_credits` oluyordu.
//
// Domain testi ikisini de göremezdi: biri çağıran katmandaydı, öbürü ise testin KURGUSU gerçeği
// yansıtmadığı için görünmüyordu (fixture `restored: 3` taşıyordu; süre dolması böyle bir defter
// bırakmaz). Bu yüzden test buraya, gerçek veritabanının üstüne yazıldı.

const SID = 'std_expired_credit' as StudioId
const BRANCH = 'brn_exp' as BranchId

const POLICY: SchedulingPolicy = {
  maxDaysInAdvance: 30,
  cancellationWindowHours: 6,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: true,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 180,
  allowMemberSelfBooking: true,
}

const OFFSET = DEFAULT_STUDIO_CONFIG.utcOffsetMinutes
const localDate = (ms: number) => new Date(ms + OFFSET * 60_000).toISOString().slice(0, 10)

let app: ReturnType<typeof initializeApp>
let db: Firestore

const staffCtx: TenantContext = {
  studioId: SID,
  branchIds: [BRANCH],
  role: 'receptionist',
  actor: { type: 'receptionist', id: 'usr_exp' as never },
}

beforeAll(() => {
  app = initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-sos' }, 'expired-credit')
  db = getFirestore(app)
})

afterAll(async () => {
  await deleteApp(app)
})

describe('süresi dolmuş paketin yanan hakkı — gerçek veritabanı', () => {
  it('bayraksız reddeder, bayrakla rezerve eder ve defteri kayıtla hareket ettirir', async () => {
    const memberRepo = new FirestoreMemberRepository(db)
    const schedRepo = new FirestoreSchedulingRepository(db)
    const entRepo = new FirestoreEntitlementRepository(db)
    const resRepo = new FirestoreReservationRepository(db)
    const memberDeps = { repo: memberRepo, clock: systemClock }
    const schedDeps = { repo: schedRepo, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG, hours: new FirestoreStudioHours(db) }
    const entDeps = { repo: entRepo, clock: systemClock }
    const resDeps = { repo: resRepo, entitlements: entRepo, clock: systemClock, hours: new FirestoreStudioHours(db) }

    const reformer = await createService(schedDeps, staffCtx, { name: 'Reformer', category: 'pilates_group', policy: POLICY })
    if (!reformer.ok) throw new Error('createService failed')

    const phone = `+9053${Math.floor(10_000_000 + Math.random() * 89_999_999)}`
    const reg = await registerMember(memberDeps, staffCtx, {
      fullName: 'Süresi Dolmuş Üye',
      phone,
      homeBranchId: BRANCH,
      email: null,
      birthDate: null,
      notes: null,
      emergencyContact: null,
    })
    if (!reg.ok) throw new Error(`registerMember failed: ${JSON.stringify(reg.error)}`)
    const memberId = reg.value.memberId

    // Paket 100 gün önce alındı, 90 günlük: dün bitmiş durumda. Üretimdeki vakanın aynısı.
    const purchase = await purchaseEntitlement(entDeps, staffCtx, {
      memberId,
      productId: 'prd_exp' as never,
      productSnapshot: {
        productId: 'prd_exp' as never,
        name: 'Reformer 3',
        category: 'pilates_group',
        grant: { kind: 'credits', credits: 3, validForDays: 90 },
        listPrice: money(300_000),
        serviceIds: [reformer.value.serviceId],
      },
      policyRef: { policyId: 'prd_exp', version: 1 },
      priceAgreed: money(300_000),
      validFrom: Date.now() - 100 * 86_400_000,
      freezeDays: null,
    })
    if (!purchase.ok) throw new Error(`purchaseEntitlement failed: ${JSON.stringify(purchase.error)}`)
    const entitlementId = purchase.value.entitlementId

    // Süreyi gerçekten doldur: bu, defteri üretimdeki hale getiren tek yol — `decideExpire` kalan
    // hakkın TAMAMINI yakar.
    const expired = await expireEntitlement(entDeps, staffCtx, entitlementId)
    expect(expired.ok, `expireEntitlement failed: ${JSON.stringify(expired.ok ? '' : expired.error)}`).toBe(true)

    const bitmis = await entRepo.getEntitlement(staffCtx, entitlementId)
    expect(bitmis!.status).toBe('expired')
    // ÜRETİMDEKİ GERÇEK: üç ders yandı, elde kalan sıfır. Testin kurgusu burada gerçeğe eşit.
    expect(bitmis!.credits!.expired).toBe(3)
    expect(available(bitmis!.credits!), 'süresi dolmuş pakette available 0 olmalı').toBe(0)

    const session = await scheduleSession(schedDeps, staffCtx, {
      serviceId: reformer.value.serviceId,
      branchId: BRANCH,
      branchName: 'EXP',
      roomId: null,
      trainerId: null,
      trainerName: null,
      date: localDate(Date.now() + 24 * 3600_000),
      startTime: '11:00',
      durationMinutes: 50,
      capacity: 8,
    })
    if (!session.ok) throw new Error(`scheduleSession failed: ${JSON.stringify(session.error)}`)

    const member = await memberRepo.findById(staffCtx, memberId)
    if (!member) throw new Error('member vanished')
    const snapshot = toMemberSnapshot(member)

    // ── 1. BAYRAKSIZ: varsayılan davranış hiç değişmedi ─────────────────────────────────
    const reddedilen = await bookReservation(resDeps, staffCtx, {
      sessionId: session.value.sessionId,
      entitlementId,
      memberId,
      memberSnapshot: snapshot,
    })
    expect(reddedilen.ok, 'süresi dolmuş paket bayraksız rezerve edildi — kapı açık kalmış').toBe(false)

    // ── 2. BAYRAKLA: bu, bir ay boyunca çalışmayan yol ──────────────────────────────────
    const kabul = await bookReservation(resDeps, staffCtx, {
      sessionId: session.value.sessionId,
      entitlementId,
      memberId,
      memberSnapshot: snapshot,
      honourExpiredCredit: true,
    })
    expect(kabul.ok, `yanan hakla rezervasyon reddedildi: ${JSON.stringify(kabul.ok ? '' : kabul.error)}`).toBe(true)

    // ── 3. DEFTER: hak geri verildi ve harcandı; yakılan kova DOKUNULMADAN duruyor ──────
    const sonra = await entRepo.getEntitlement(staffCtx, entitlementId)
    expect(sonra!.credits!.restored, 'yanan hak kayıtlı bir düzeltmeyle geri verilmeliydi').toBe(1)
    expect(sonra!.credits!.held, 'rezervasyon krediyi TUTAR, tüketmez').toBe(1)
    expect(sonra!.credits!.consumed).toBe(0)
    // `expired` azaltılmaz: telafi kaydı, sessiz düzeltme değil (#9). Paket dirilmez.
    expect(sonra!.credits!.expired, 'yanan kova tüketildi — paket sessizce diriltilmiş').toBe(3)
    expect(available(sonra!.credits!)).toBe(0)
    expect(sonra!.status, 'paket diriltilmemeli — bir ders için bir hak').toBe('expired')
  })
})
