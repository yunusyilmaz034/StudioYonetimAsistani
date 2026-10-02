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

// ENGELE RAĞMEN REZERVASYON — UÇTAN UCA (owner, 2026-10-02).
//
// *"Üyenin paketinin tarihi bitiyor, biz bitse de inisiyatif kullanıp süre dışındaki bir yere
// rezervasyon yapmak istiyoruz. Paketi yok ya da başka engeli varsa uyarı olarak çıkarsın, yine de
// 'kabul et rezervasyon yap' derse rezervasyon yapsın. Kredisi 0 ise eksiye gitmesin, ya da paketin
// tarihi bittiyse kredisi varsa kredisi bu derse istinaden düşsün."*
//
// Bu test neden gerçek veritabanının üstünde: aynı özelliğin bir önceki hâli (yanan hakkı
// kullandırma) altı domain testiyle yeşil görünürken canlıda BİR KEZ BİLE çalışmamıştı, çünkü iki
// kopukluk da katmanların ARASINDAydı. İki kuralın ikisi de defterin kendisiyle doğrulanıyor —
// `creditEffect` iddiası yetmez, sayaçlara bakmak gerekir.

const SID = 'std_credit_exemption' as StudioId
const BRANCH = 'brn_exm' as BranchId

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
  actor: { type: 'receptionist', id: 'usr_exm' as never },
}

beforeAll(() => {
  app = initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-sos' }, 'credit-exemption')
  db = getFirestore(app)
})

afterAll(async () => {
  await deleteApp(app)
})

/** İstisna olayını defterden okur — iddia, olayın GERÇEKTEN yazıldığı. */
async function istisnaOlayi(reservationId: string) {
  const snap = await db
    .collection(`studios/${SID}/events`)
    .where('type', '==', 'reservation.credit_exempted')
    .get()
  return snap.docs
    .map((d) => d.data() as { related?: { reservationId?: string }; payload?: Record<string, unknown> })
    .find((e) => e.related?.reservationId === reservationId)?.payload
}

async function kurulum(label: string) {
  const memberRepo = new FirestoreMemberRepository(db)
  const schedRepo = new FirestoreSchedulingRepository(db)
  const entRepo = new FirestoreEntitlementRepository(db)
  const resRepo = new FirestoreReservationRepository(db)
  const hours = new FirestoreStudioHours(db)
  const schedDeps = { repo: schedRepo, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG, hours }
  const entDeps = { repo: entRepo, clock: systemClock }
  const resDeps = { repo: resRepo, entitlements: entRepo, clock: systemClock, hours }

  const reformer = await createService(schedDeps, staffCtx, {
    name: `Reformer ${label}`,
    category: 'pilates_group',
    policy: POLICY,
  })
  if (!reformer.ok) throw new Error('createService failed')

  const phone = `+9053${Math.floor(10_000_000 + Math.random() * 89_999_999)}`
  const reg = await registerMember(
    { repo: memberRepo, clock: systemClock },
    staffCtx,
    {
      fullName: `İstisna Üye ${label}`,
      phone,
      homeBranchId: BRANCH,
      email: null,
      birthDate: null,
      notes: null,
      emergencyContact: null,
    },
  )
  if (!reg.ok) throw new Error(`registerMember failed: ${JSON.stringify(reg.error)}`)

  const member = await memberRepo.findById(staffCtx, reg.value.memberId)
  if (!member) throw new Error('member vanished')

  const ders = async (saat: string, gunSonra = 1) => {
    const s = await scheduleSession(schedDeps, staffCtx, {
      serviceId: reformer.value.serviceId,
      branchId: BRANCH,
      branchName: 'EXM',
      roomId: null,
      trainerId: null,
      trainerName: null,
      date: localDate(Date.now() + gunSonra * 24 * 3600_000),
      startTime: saat,
      durationMinutes: 50,
      capacity: 8,
    })
    if (!s.ok) throw new Error(`scheduleSession failed: ${JSON.stringify(s.error)}`)
    return s.value.sessionId
  }

  return {
    entRepo,
    resRepo,
    entDeps,
    resDeps,
    serviceId: reformer.value.serviceId,
    memberId: reg.value.memberId,
    snapshot: toMemberSnapshot(member),
    ders,
  }
}

describe('engele rağmen rezervasyon — gerçek veritabanı', () => {
  it('kredisi 0: uyarıya rağmen rezerve eder ve DEFTERE HİÇ DOKUNMAZ', async () => {
    const k = await kurulum('A')

    // Tek kredilik paket. İlk rezervasyon krediyi tutar ve `available` 0'a düşer — paket AKTİF
    // kalır. Owner'ın anlattığı "kredisi 0" durumunun üretimdeki en sık hâli tam olarak bu.
    const purchase = await purchaseEntitlement(k.entDeps, staffCtx, {
      memberId: k.memberId,
      productId: 'prd_exm' as never,
      productSnapshot: {
        productId: 'prd_exm' as never,
        name: 'Reformer 1',
        category: 'pilates_group',
        grant: { kind: 'credits', credits: 1, validForDays: 90 },
        listPrice: money(100_000),
        serviceIds: [k.serviceId],
      },
      policyRef: { policyId: 'prd_exm', version: 1 },
      priceAgreed: money(100_000),
      validFrom: Date.now(),
      freezeDays: null,
    })
    if (!purchase.ok) throw new Error(`purchaseEntitlement failed: ${JSON.stringify(purchase.error)}`)
    const entitlementId = purchase.value.entitlementId

    const ilkDers = await k.ders('09:00')
    const ikinciDers = await k.ders('11:00')

    const ilk = await bookReservation(k.resDeps, staffCtx, {
      sessionId: ilkDers,
      entitlementId,
      memberId: k.memberId,
      memberSnapshot: k.snapshot,
    })
    expect(ilk.ok, `ilk rezervasyon reddedildi: ${JSON.stringify(ilk.ok ? '' : ilk.error)}`).toBe(true)

    const kredisiz = await k.entRepo.getEntitlement(staffCtx, entitlementId)
    expect(kredisiz!.status, 'paket aktif kalmalı — süresi dolmadı, kredisi bitti').toBe('active')
    expect(available(kredisiz!.credits!), 'ikinci rezervasyon için alınacak hak kalmamalı').toBe(0)

    // ── 1. İZİNSİZ: reddediyor, davranış değişmedi ──────────────────────────────────────
    const reddedilen = await bookReservation(k.resDeps, staffCtx, {
      sessionId: ikinciDers,
      entitlementId,
      memberId: k.memberId,
      memberSnapshot: k.snapshot,
    })
    expect(reddedilen.ok, 'kredisi olmayan üye izinsiz rezerve edildi — kapı açık kalmış').toBe(false)
    if (!reddedilen.ok) expect(reddedilen.error.code).toBe('insufficient_credits')

    // ── 2. İZİNLE: kabul ediyor ─────────────────────────────────────────────────────────
    const SEBEP = 'Paketi bugün bitti, telafi dersi — patron onayı var'
    const kabul = await bookReservation(k.resDeps, staffCtx, {
      sessionId: ikinciDers,
      entitlementId,
      memberId: k.memberId,
      memberSnapshot: k.snapshot,
      creditExemption: { reason: SEBEP },
    })
    expect(kabul.ok, `izinli rezervasyon reddedildi: ${JSON.stringify(kabul.ok ? '' : kabul.error)}`).toBe(true)
    if (!kabul.ok) return

    // ── 3. DEFTER: HİÇBİR sayaç oynamadı (owner: *"kredisi 0 ise eksiye gitmesin"*) ─────
    const sonra = await k.entRepo.getEntitlement(staffCtx, entitlementId)
    expect(sonra!.credits!.held, 'ikinci rezervasyon kredi TUTMAMALI — alınacak hak yoktu').toBe(1)
    expect(sonra!.credits!.consumed).toBe(0)
    expect(sonra!.credits!.restored, 'yoktan hak yaratılmamalı').toBe(0)
    expect(available(sonra!.credits!), 'bakiye eksiye gitmemeli (I-1)').toBe(0)

    // ── 4. REZERVASYON GERÇEKTEN VAR: üye kendi uygulamasında görecek ───────────────────
    const rez = await k.resRepo.getReservation(staffCtx, kabul.value.reservationId)
    expect(rez!.status).toBe('booked')
    expect(rez!.creditEffect, 'istisna rezervasyonu kredi hareketi taşımaz').toBe('none')

    // ── 5. İSTİSNA DEFTERE YAZILDI: sebebiyle ve aşılan korumayla ───────────────────────
    expect(await istisnaOlayi(kabul.value.reservationId as string)).toEqual({
      steppedPast: 'insufficient_credits',
      creditEffect: 'none',
      creditsAvailable: 0,
      entitlementStatus: 'active',
      reason: SEBEP,
    })
  })

  it('süresi dolmuş ama kredisi var: izinle rezerve eder ve KREDİ DÜŞER', async () => {
    const k = await kurulum('B')

    // 100 gün önce alınmış 90 günlük paket: dün bitti, içinde kullanılmamış hak var.
    const purchase = await purchaseEntitlement(k.entDeps, staffCtx, {
      memberId: k.memberId,
      productId: 'prd_exm2' as never,
      productSnapshot: {
        productId: 'prd_exm2' as never,
        name: 'Reformer 3',
        category: 'pilates_group',
        grant: { kind: 'credits', credits: 3, validForDays: 90 },
        listPrice: money(300_000),
        serviceIds: [k.serviceId],
      },
      policyRef: { policyId: 'prd_exm2', version: 1 },
      priceAgreed: money(300_000),
      validFrom: Date.now() - 100 * 86_400_000,
      freezeDays: null,
    })
    if (!purchase.ok) throw new Error(`purchaseEntitlement failed: ${JSON.stringify(purchase.error)}`)
    const entitlementId = purchase.value.entitlementId

    const expired = await expireEntitlement(k.entDeps, staffCtx, entitlementId)
    expect(expired.ok).toBe(true)

    const bitmis = await k.entRepo.getEntitlement(staffCtx, entitlementId)
    expect(bitmis!.credits!.expired, 'süre dolarken üç hak yanmalı').toBe(3)
    expect(available(bitmis!.credits!)).toBe(0)

    const ders = await k.ders('14:00')
    const SEBEP = 'Paketin süresi geçti, kalan dersini kullandırıyoruz'
    const kabul = await bookReservation(k.resDeps, staffCtx, {
      sessionId: ders,
      entitlementId,
      memberId: k.memberId,
      memberSnapshot: k.snapshot,
      creditExemption: { reason: SEBEP },
    })
    expect(kabul.ok, `izinli rezervasyon reddedildi: ${JSON.stringify(kabul.ok ? '' : kabul.error)}`).toBe(true)
    if (!kabul.ok) return

    // Owner'ın 2. kuralı: *"kredisi varsa düşsün her zaman."* Yanan haktan BİR tanesi kayıtlı bir
    // düzeltmeyle geri verilir ve tutulur; `expired` kovası dokunulmadan durur — paket dirilmiyor.
    const sonra = await k.entRepo.getEntitlement(staffCtx, entitlementId)
    expect(sonra!.credits!.restored, 'yanan hak kayıtlı düzeltmeyle geri verilmeliydi').toBe(1)
    expect(sonra!.credits!.held, 'rezervasyon krediyi TUTAR').toBe(1)
    expect(sonra!.credits!.expired, 'yanan kova tüketilmemeli').toBe(3)
    expect(sonra!.status, 'paket diriltilmemeli — bir ders için bir hak').toBe('expired')

    const rez = await k.resRepo.getReservation(staffCtx, kabul.value.reservationId)
    expect(rez!.creditEffect, 'kredi alındığı için bu rezervasyon hak tutar').toBe('held')

    // Aşılan koruma "paket aktif değil" olarak yazılır: istisnanın sebebi süreydi, kredi değil.
    const olay = await istisnaOlayi(kabul.value.reservationId as string)
    expect(olay).toMatchObject({
      steppedPast: 'entitlement_not_active',
      creditEffect: 'held',
      entitlementStatus: 'expired',
      reason: SEBEP,
    })
  })
})
