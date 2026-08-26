// DEMO STÜDYOSU — satış için, içi dolu bir panel.
//
//   FIREBASE_PROJECT_ID=studio-yonetim-prod pnpm tsx tools/seed/demo-studio.ts          (kuru)
//   FIREBASE_PROJECT_ID=studio-yonetim-prod pnpm tsx tools/seed/demo-studio.ts --apply
//
// Boş bir panel hiçbir şey satmaz. İkna eden şey dolu bir ajanda, gerçekçi bir doluluk, birkaç
// haftalık geçmiş ve içi dolu bir satış hunisi — yani bir işletmenin RİTMİ. Bu yüzden veri
// rastgele değil: sabahlar dolu, akşamlar daha dolu, bazı üyeler gelmiyor, bazı paketler bitmek
// üzere, bazı faturalar açık.
//
// GÜVENLİK. Bu script Işıl'ın işletmesiyle AYNI veritabanına yazıyor. `lockToStudio` yüzünden
// `studios/demo/` dışındaki her yol — okuma dahil — veritabanına ulaşmadan çöküyor. Dikkatli
// olmaya güvenmiyoruz; yanlış yere yazmayı imkânsız kılıyoruz.
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
  FirestoreStudioHours,
  fixedClock,
  instant,
  markAttendance,
  money,
  newCommandId,
  recordCheckIn,
  registerMember,
  scheduleSession,
  selectEntitlement,
  toMemberSnapshot,
  systemClock,
  type ActorRef,
  type BranchId,
  type Category,
  type ClassSessionId,
  type CheckinDeps,
  type Clock,
  type EntitlementId,
  type Grant,
  type MemberId,
  type ProductId,
  type ReservationId,
  type RoomId,
  type SchedulingPolicy,
  type ServiceId,
  type StaffUserId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { lockToStudio } from './demo-guard'

const STUDIO = 'demo' as StudioId
const BRANCH = 'merkez' as BranchId
const BRANCH_NAME = 'Merkez'
const DAY = 86_400_000
const APPLY = process.argv.includes('--apply')

const ctx: TenantContext = {
  studioId: STUDIO,
  branchIds: [BRANCH],
  role: 'owner',
  actor: { type: 'owner', id: 'usr_demo_owner' as StaffUserId } as ActorRef,
}

const OFF = DEFAULT_STUDIO_CONFIG.utcOffsetMinutes
const gun = (ms: number) => new Date(ms + OFF * 60_000).toISOString().slice(0, 10)
const yerelUtc = (d: string, hhmm: string) => Date.parse(`${d}T${hhmm}:00Z`) - OFF * 60_000

const POLICY: SchedulingPolicy = {
  maxDaysInAdvance: 30,
  cancellationWindowHours: 6,
  lateCancellationConsumesCredit: true,
  noShowConsumesCredit: true,
  attendanceDefaultOutcome: 'attended',
  autoResolveAfterMinutes: 180,
  allowMemberSelfBooking: true,
}

function ok<T>(r: { ok: true; value: T } | { ok: false; error: unknown }, ne: string): T {
  if (!r.ok) throw new Error(`${ne}: ${JSON.stringify(r.error)}`)
  return r.value
}

// Deterministik "rastgelelik": aynı seed her çalıştırmada aynı stüdyoyu üretir, yani demo iki kez
// kurulduğunda aynı görünür ve "geçen sefer başkaydı" sorusu hiç doğmaz.
let tohum = 20260826
const rnd = () => ((tohum = (tohum * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const sec = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T
const arasi = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))

const AD = [
  'Elif Şahin', 'Zeynep Arslan', 'Merve Doğan', 'Ayşe Yıldırım', 'Fatma Çelik', 'Selin Koç',
  'Büşra Aydın', 'Derya Kaya', 'Ece Demir', 'Gamze Öztürk', 'Hande Yılmaz', 'İrem Kurt',
  'Melis Şen', 'Nazlı Polat', 'Özge Aksoy', 'Pelin Erdoğan', 'Sena Güneş', 'Tuğçe Bulut',
  'Yasemin Kara', 'Aslı Tekin', 'Bahar Sarı', 'Ceren Yavuz', 'Dilek Aslan', 'Esra Korkmaz',
  'Funda Çetin', 'Gizem Duman', 'Hilal Acar', 'Ilgın Taş', 'Jale Ercan', 'Kübra Şimşek',
  'Lale Bozkurt', 'Meltem Uçar', 'Nurgül Ateş', 'Oya Kaplan', 'Pınar Balcı', 'Rana Güler',
  'Sibel Turan', 'Tuba Eren', 'Ülkü Yalçın', 'Vildan Özkan', 'Yeliz Coşkun', 'Zehra Altun',
  'Aylin Sezer', 'Berna Kılıç', 'Cansu Uysal',
]

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = lockToStudio(getFirestore(), STUDIO)

  console.log(APPLY ? '── UYGULANIYOR ──' : '── KURU ÇALIŞMA ──')
  console.log(`Stüdyo: ${STUDIO} (kilit aktif — bu id dışına yazılamaz)\n`)

  const memberRepo = new FirestoreMemberRepository(db)
  const catalogRepo = new FirestoreCatalogRepository(db)
  const schedRepo = new FirestoreSchedulingRepository(db)
  const entRepo = new FirestoreEntitlementRepository(db)
  const resRepo = new FirestoreReservationRepository(db)
  const checkinRepo = new FirestoreCheckinRepository(db)
  const hours = new FirestoreStudioHours(db)

  const memberDeps = { repo: memberRepo, clock: systemClock }
  const catalogDeps = { repo: catalogRepo, clock: systemClock }
  const entDeps = { repo: entRepo, clock: systemClock }
  const checkinDeps: CheckinDeps = { repo: checkinRepo, clock: systemClock, entries: entRepo }
  const schedDeps = (c: Clock = systemClock) => ({ repo: schedRepo, clock: c, studioConfig: DEFAULT_STUDIO_CONFIG, hours })
  const resDeps = (c: Clock = systemClock) => ({ repo: resRepo, clock: c, hours })

  // Yeniden çalıştırmayı reddet: iki kez kurulan bir demo, iki kat üye ve anlamsız rakamlar demek.
  // Yarıda kalırsa çözüm "kaldığı yerden devam" değil, `demo-reset.ts` ile sıfırlayıp tek geçişte
  // kurmak — hiç çalıştırılmamış bir devam dalı, olmayan bir güvenlikten daha kötüdür.
  const mevcut = await db.collection(`studios/${STUDIO}/members`).limit(1).get()
  if (!mevcut.empty) {
    console.log('Demo stüdyosunda zaten üye var — hiçbir şey yapılmadı.')
    console.log('Sıfırdan kurmak için: pnpm tsx tools/seed/demo-reset.ts --apply')
    process.exit(0)
  }
  if (!APPLY) {
    console.log('Boş demo stüdyosu bulundu, kurulmaya hazır.\nUygulamak için --apply')
    process.exit(0)
  }

  const now = Date.now()

  // ── 1 · Katalog ────────────────────────────────────────────────────────────────────────────
  const svcReformer = ok(await createService(schedDeps(), ctx, { name: 'Reformer Pilates', category: 'pilates_group', policy: POLICY }), 'svc').serviceId
  const svcMat = ok(await createService(schedDeps(), ctx, { name: 'Mat Pilates', category: 'pilates_group', policy: { ...POLICY, cancellationWindowHours: null } }), 'svc').serviceId
  const svcFitness = ok(await createService(schedDeps(), ctx, { name: 'Fitness', category: 'fitness', policy: POLICY }), 'svc').serviceId
  const svcPt = ok(await createService(schedDeps(), ctx, { name: 'Kişisel Antrenman', category: 'private', policy: POLICY }), 'svc').serviceId
  console.log('✓ 4 ders türü')

  const odaReformer = ok(await createRoom(schedDeps(), ctx, { branchId: BRANCH, name: 'Reformer Salonu', capacity: 8 }), 'oda').roomId
  const odaMat = ok(await createRoom(schedDeps(), ctx, { branchId: BRANCH, name: 'Mat Salonu', capacity: 12 }), 'oda').roomId
  const odaFitness = ok(await createRoom(schedDeps(), ctx, { branchId: BRANCH, name: 'Fitness Alanı', capacity: 20 }), 'oda').roomId
  console.log('✓ 3 salon')

  const urun = async (
    name: string, category: Category, serviceIds: readonly ServiceId[],
    type: 'credit' | 'period', durationDays: number, creditCount: number | null,
    priceInKurus: number, entryAllowance: number | null = null,
  ): Promise<ProductId> =>
    ok(await createProduct(catalogDeps, ctx, {
      name, category, serviceIds, type, durationDays, creditCount, priceInKurus,
      cashPriceInKurus: null, freezeAllowanceDays: 14, dailyReservationLimit: 1,
      cancellationAllowanceCount: null, activeReservationLimit: null, entryAllowance,
      components: null, onlineSellable: true, memberSellable: true,
      description: name,
    }), `ürün ${name}`).productId

  const pR8 = await urun('Reformer 8 Ders', 'pilates_group', [svcReformer], 'credit', 30, 8, 480_000)
  const pR16 = await urun('Reformer 16 Ders', 'pilates_group', [svcReformer], 'credit', 60, 16, 880_000)
  const pMat = await urun('Mat Pilates 8 Ders', 'pilates_group', [svcMat], 'credit', 30, 8, 320_000)
  const pF1 = await urun('Fitness 1 Aylık', 'fitness', [svcFitness], 'period', 30, null, 150_000)
  const pF3 = await urun('Fitness 3 Aylık', 'fitness', [svcFitness], 'period', 90, null, 390_000)
  const pF12 = await urun('Fitness 12 Aylık', 'fitness', [svcFitness], 'period', 365, null, 1_290_000)
  const pPt = await urun('Kişisel Antrenman 8 Ders', 'private', [svcPt], 'credit', 60, 8, 960_000)
  console.log('✓ 7 paket')

  // ── 2 · Üyeler ─────────────────────────────────────────────────────────────────────────────
  const uyeler: { id: MemberId; ad: string }[] = []
  for (let i = 0; i < AD.length; i++) {
    const ad = AD[i] as string
    const tel = `53${String(10000000 + i * 137).slice(0, 8)}`
    const dogum = i === 0 ? `1991-${gun(now).slice(5)}` : `19${arasi(80, 99)}-${String(arasi(1, 12)).padStart(2, '0')}-${String(arasi(1, 28)).padStart(2, '0')}`
    const id = ok(await registerMember(memberDeps, ctx, {
      fullName: ad, phone: tel, homeBranchId: BRANCH, email: null, birthDate: dogum,
      notes: i % 9 === 0 ? 'Sabah seanslarını tercih ediyor.' : null, emergencyContact: null,
    }), `üye ${ad}`).memberId
    uyeler.push({ id, ad })
  }
  console.log(`✓ ${uyeler.length} üye`)

  // ── 3 · Abonelikler ────────────────────────────────────────────────────────────────────────
  // Karışım kasten: tamamı ödenmiş, kısmi, hiç ödenmemiş, bitmek üzere. Panelin "ilgilenmen
  // gerekenler" listesi ancak bu karışım varsa bir şey söyler.
  //
  // YENİLEME. İlk hâli üye başına TEK paket veriyordu ve 45 üyeye toplam 174 kredi düşüyordu —
  // 237 seansı doldurmaya uzaktan yetmiyor. Ölçünce göründü: gelecek 66 seansın 24'ü bomboştu,
  // ortalama doluluk 8 kişilik salonda 1,6. Boş bir ajanda hiçbir şey satmaz.
  //
  // Çözüm krediyi şişirmek değil — 8 derslik paketi 30 derse çıkarmak katalogu yalan yapardı.
  // Çözüm gerçeği taklit etmek: 50 günlük geçmişte bir üye paketini bir kez değil ÜÇ kez alır.
  // Yan faydası, demonun asıl anlatmak istediği şeyi de göstermesi: yenileme geçmişi, ciro
  // birikimi ve "paketi bitmek üzere" sinyali.
  const paketler: { id: ProductId; fiyat: number }[] = [
    { id: pR8, fiyat: 480_000 }, { id: pR16, fiyat: 880_000 }, { id: pMat, fiyat: 320_000 },
    { id: pF1, fiyat: 150_000 }, { id: pF3, fiyat: 390_000 }, { id: pF12, fiyat: 1_290_000 },
    { id: pPt, fiyat: 960_000 },
  ]
  /** Üyenin hangi ders türlerine hakkı olduğu — rezervasyon adaylarını buradan seçeceğiz. */
  const hakki = new Map<MemberId, Set<ServiceId>>()
  let abone = 0
  for (let i = 0; i < uyeler.length; i++) {
    if (i % 7 === 6) continue // birkaç üye paketsiz — "henüz satın almadı" hâli
    const p = paketler[i % paketler.length]!
    const urunRec = await catalogRepo.getProduct(ctx, p.id)
    if (!urunRec) continue

    // Kaç kez yenilemiş? Kredi paketleri tükenir, dönemsel paketler uzar — ikisi farklı ritim.
    const yenileme = urunRec.type === 'credit' ? arasi(2, 4) : arasi(1, 2)
    for (let k = yenileme - 1; k >= 0; k--) {
      const grant: Grant = urunRec.type === 'credit'
        ? { kind: 'credits', credits: urunRec.creditCount ?? 0, validForDays: urunRec.durationDays }
        : { kind: 'period', durationDays: urunRec.durationDays, access: 'unlimited' }

      // k=0 güncel paket, k>0 geçmiş yenilemeler. Geçmiştekiler tamamı ödenmiş — açık bakiye
      // aylar öncesinden sürünmez, o ancak GÜNCEL satışta anlamlı bir uyarıdır.
      const guncel = k === 0
      const tahsil = !guncel ? p.fiyat : i % 5 === 0 ? 0 : i % 3 === 0 ? Math.round(p.fiyat / 2) : p.fiyat
      const basla = now - (k * 26 + arasi(3, 14)) * DAY
      const bitis = guncel && i % 11 === 0 ? now + arasi(3, 9) * DAY : null // birkaçı bitmek üzere

      ok(await assignSubscription(entDeps, ctx, {
        memberId: uyeler[i]!.id,
        productId: urunRec.id,
        productSnapshot: {
          productId: urunRec.id, name: urunRec.name, category: urunRec.category, grant,
          listPrice: money(urunRec.priceInKurus), serviceIds: urunRec.serviceIds,
        },
        policyRef: { policyId: urunRec.id, version: 1 },
        priceAgreed: money(p.fiyat),
        validFrom: basla,
        validUntil: bitis,
        freezeDays: 14,
        creditOverride: null,
        collectedAmount: money(tahsil),
        method: sec(['cash', 'credit_card', 'bank_transfer'] as const),
        note: tahsil === 0 ? 'Bakiye açık' : tahsil < p.fiyat ? 'Kısmi tahsilat' : '',
      }), `abonelik ${uyeler[i]!.ad}`)
      abone++
    }
    hakki.set(uyeler[i]!.id, new Set(urunRec.serviceIds as readonly ServiceId[]))
  }
  console.log(`✓ ${abone} abonelik (yenilemeler dahil · tam ödenmiş / kısmi / açık bakiye karışık)`)

  // ── 4 · Seanslar, rezervasyonlar, yoklama, check-in ────────────────────────────────────────
  const seans = async (svc: ServiceId, oda: RoomId, d: string, saat: string, dk: number, kap: number, egt: string | null, c: Clock) =>
    ok(await scheduleSession(schedDeps(c), ctx, {
      serviceId: svc, branchId: BRANCH, branchName: BRANCH_NAME, roomId: oda,
      trainerId: null, trainerName: egt, date: d, startTime: saat, durationMinutes: dk, capacity: kap,
    }), `seans ${d} ${saat}`).sessionId

  const kitap = async (uye: MemberId, s: ClassSessionId, c: Clock): Promise<ReservationId | null> => {
    const [m, adaylar, ss] = await Promise.all([
      memberRepo.findById(ctx, uye), entRepo.listActiveByMember(ctx, uye), schedRepo.getSession(ctx, s),
    ])
    if (!m || !ss) return null
    const secilen = selectEntitlement(adaylar, ss, c.now())
    if (!secilen) return null
    const r = await bookReservation(resDeps(c), ctx, {
      sessionId: s, entitlementId: secilen.id as EntitlementId, memberId: uye, memberSnapshot: toMemberSnapshot(m),
    })
    return r.ok ? r.value.reservationId : null
  }

  const EGITMEN = ['Reyhan Yıldız', 'Selda Aksu']
  const PROGRAM: { svc: ServiceId; oda: RoomId; saat: string; dk: number; kap: number }[] = [
    { svc: svcReformer, oda: odaReformer, saat: '09:00', dk: 50, kap: 8 },
    { svc: svcReformer, oda: odaReformer, saat: '10:00', dk: 50, kap: 8 },
    { svc: svcMat, oda: odaMat, saat: '11:00', dk: 45, kap: 12 },
    { svc: svcFitness, oda: odaFitness, saat: '18:00', dk: 60, kap: 20 },
    { svc: svcReformer, oda: odaReformer, saat: '19:00', dk: 50, kap: 8 },
    { svc: svcReformer, oda: odaReformer, saat: '20:00', dk: 50, kap: 8 },
  ]

  let toplamSeans = 0, toplamRez = 0, toplamYok = 0
  for (let g = -35; g <= 14; g++) {
    const ms = now + g * DAY
    const d = gun(ms)
    const haftaGunu = new Date(ms + OFF * 60_000).getUTCDay()
    if (haftaGunu === 0) continue // pazar kapalı

    for (const p of PROGRAM) {
      if (haftaGunu === 6 && p.saat >= '18:00') continue // cumartesi akşamı yok
      const baslar = yerelUtc(d, p.saat)
      const gecmis = baslar < now
      const saatOnce = fixedClock(instant(baslar - 3 * 3_600_000))
      const sid = await seans(p.svc, p.oda, d, p.saat, p.dk, p.kap, sec(EGITMEN), gecmis ? saatOnce : systemClock)
      toplamSeans++

      // Doluluk: akşamlar daha dolu, sabahlar orta. Gerçek bir stüdyonun ritmi.
      //
      // Adaylar 45 üyeden rastgele değil, O DERSE HAKKI OLANLAR arasından seçiliyor. Rastgele
      // seçimde fitness üyesine reformer seansı denenip kategori duvarına takılıyor ve `kitap`
      // sessizce null dönüyordu — hedef 6 kişiyken salona 1 kişi giriyordu. Duvar doğru çalışıyor;
      // yanlış olan, resepsiyonun asla yapmayacağı bir denemeyi 1400 kez yapmaktı.
      const hedef = p.saat >= '18:00' ? arasi(Math.floor(p.kap * 0.6), p.kap) : arasi(2, Math.max(3, Math.floor(p.kap * 0.7)))
      const adaylar = uyeler.filter((u) => hakki.get(u.id)?.has(p.svc))
      const secilenler = [...adaylar].sort(() => rnd() - 0.5).slice(0, hedef)
      for (const u of secilenler) {
        const r = await kitap(u.id, sid, gecmis ? saatOnce : systemClock)
        if (!r) continue
        toplamRez++
        if (gecmis) {
          const cozum = instant(baslar + 2 * 3_600_000)
          const sonuc = rnd() < 0.88 ? 'attended' : 'no_show'
          const res = await markAttendance(resDeps(fixedClock(cozum)), ctx, {
            reservationId: r, outcome: sonuc, occurredAt: cozum, commandId: newCommandId(),
          })
          if (res.ok) toplamYok++
        }
      }
    }
    if (g % 10 === 0) console.log(`   … ${d}`)
  }
  console.log(`✓ ${toplamSeans} seans · ${toplamRez} rezervasyon · ${toplamYok} yoklama`)

  // Bugün içeride olanlar — panelin "şu an stüdyoda" göstergesi için.
  let ci = 0
  for (const u of uyeler.slice(0, 6)) {
    const r = await recordCheckIn(checkinDeps, ctx, {
      memberId: u.id, branchId: BRANCH, method: sec(['qr', 'reception', 'device'] as const),
      occurredAt: instant(now - arasi(10, 180) * 60_000), commandId: newCommandId(),
    })
    if (r.ok) ci++
  }
  console.log(`✓ ${ci} check-in (şu an içeride)`)

  console.log('\n✅ Faz 1-4 tamam: katalog, üyeler, abonelikler, ajanda, geçmiş, check-in')
  process.exit(0)
}

void main()
