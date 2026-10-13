import {
  adjustCredits,
  available,
  bookPastAttended,
  changeCapacity,
  correctReservation,
  DEFAULT_STUDIO_CONFIG,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  instant,
  systemClock,
  toMemberSnapshot,
  type ClassSessionId,
  type EntitlementId,
  type MemberId,
  type ReservationId,
  type TenantContext,
} from '@studio/core'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// BURÇİN GÖKNİL KAYA — BUGÜNKÜ 19:00 YERİNE 6 EKİM 19:00'A EKLENMİŞ (owner, 2026-10-13)
//
//   pnpm tsx tools/migration/fix-burcin-goknil-kaya-yanlis-ders-2026-10-13.ts            # kuru çalışma
//   pnpm tsx tools/migration/fix-burcin-goknil-kaya-yanlis-ders-2026-10-13.ts --apply    # yaz
//
// Owner: *"bugün 19'a alacaktım … bir baktım tarih yanlış, 6 Ekim 19'a almışım; onu düzeltsene, oradan
// al, kredisini geri ver."*
//
// Tanı: 19:33'te 6 Ekim 19:00 seansının kapasitesi 8 → 9 yapıldı, 19:34'te üye o seansa "geçmiş derse
// ekle" ile İKİNCİ kez yazıldı (ilk rezervasyonu 5 Ekim'de kendisi yapmış ve katılmıştı) — 1 hak düştü.
// Bugünkü 19:00 seansında (8 kişilik, 7 dolu) rezervasyonu yok.
//
// Sonuçlanmış bir rezervasyonu "hiç olmadı" sayan bir işlem alanda YOK. Owner'a iki yol soruldu
// (mevcut araç / yeni olay türü) ve MEVCUT ARACI seçti. Bedeli bilerek kabul edildi: yanlış satır
// 6 Ekim'de açıklamalı bir "Gelmedi" olarak kalır ve üyenin gelmedi sayısına 1 yazar.
//
// MASANIN YAPACAĞI DÖRT İŞLEM, aynı use-case'lerle:
//   1) correctReservation — yanlış satır attended → no_show (`reservation.corrected`, sebepli). Bu
//      stüdyoda gelmeyenin hakkı da yandığı için bu adım tek başına kredi OYNATMAZ.
//   2) adjustCredits      — +1 "Düzeltme" (`restored`; `consumed` sayacına dokunulmaz)
//   3) bookPastAttended   — bugünkü 19:00, katıldı (hak tutulur ve aynı işlemde tüketilir); seans doluysa
//                         önce changeCapacity +1 — owner'ın yanlış seansa yaptığı artışın doğru yeri
//   4) changeCapacity     — 6 Ekim 19:00 seansı 9 → 8
//   2b) BETİĞİN KENDİ HATASI: ilk sürüm 2. adımı iki kez yazdı; fazladan 1 hak `revoked` ile geri alındı.
//
// Sıra bilerek böyle: arada ölürse üyenin lehine bir durum kalır (hakkı geri verilmiş, bugünkü dersi
// yazılmamış) ve betik kaldığı yerden devam eder. Her adım önce kendi yapılmış mı diye bakar.

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'fix-burcin-goknil-kaya-yanlis-ders-2026-10-13'
const APPLY = process.argv.includes('--apply')

const VAKA = {
  memberId: 'mem_01KZRPWV6ZHAE5EE83AS43FEFJ' as MemberId,
  entitlementId: 'ent_01M20Z5MMGG9S819HJTFHH73KN' as EntitlementId,
  yanlisRezervasyon: 'res_01M4V1TGC5B6MFPB8F5XK9NW30' as ReservationId,
  yanlisSeans: 'cls_01M3PXSMT9TRS5ZB6MA0S2EWGR' as ClassSessionId, // 6 Ekim 19:00
  dogruSeans: 'cls_01M3PXSMYZCTZA9JDYHK0BTHDR' as ClassSessionId, // 13 Ekim 19:00
} as const

const REASON =
  'Yanlışlıkla eklendi: üye 13.10.2026 19:00 dersine alınacaktı, kayıt 06.10.2026 19:00 seansına ikinci kez ' +
  'yazıldı (o derse zaten katılmıştı). Düşen 1 hak geri verildi (owner talimatı, 2026-10-13).'

const an = (ms: number): string => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })

async function main(): Promise<void> {
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? 'studio-yonetim-prod' })
  const db = getFirestore()
  const ctx = {
    studioId: STUDIO,
    actor: { type: 'platform_admin', id: `migration:${RUN}` },
    branchIds: [BRANCH],
    correlationId: RUN,
    source: 'migration',
    role: 'platform_admin',
  } as unknown as TenantContext
  const ents = new FirestoreEntitlementRepository(db)
  const members = new FirestoreMemberRepository(db)
  const sched = new FirestoreSchedulingRepository(db)
  const hours = new FirestoreStudioHours(db)
  const resDeps = {
    repo: new FirestoreReservationRepository(db),
    clock: systemClock,
    hours,
    policy: { getMemberOverride: async () => (await members.findById(ctx, VAKA.memberId))?.restriction ?? null },
  }
  const col = (n: string) => db.collection(`studios/${STUDIO}/${n}`)
  const dur = (m: string): never => { console.error(`DUR: ${m}`); process.exit(1) }

  const oku = async () => {
    const [ent, yanlis, bugun, eski, yeni, olaylar] = await Promise.all([
      ents.getEntitlement(ctx, VAKA.entitlementId),
      col('reservations').doc(VAKA.yanlisRezervasyon).get(),
      col('reservations').where('memberId', '==', VAKA.memberId).where('classSessionId', '==', VAKA.dogruSeans).get(),
      sched.getSession(ctx, VAKA.yanlisSeans),
      sched.getSession(ctx, VAKA.dogruSeans),
      col('events').where('related.memberId', '==', VAKA.memberId).get(),
    ])
    // Bu betiğin verdiği NET hak. Zarftaki `correlationId` her işlemde yeniden üretiliyor, o yüzden
    // betiğin izi aktör kimliğidir — ilk sürüm correlationId'ye bakıyordu, hiç eşleşmedi ve ikinci
    // çalıştırmada +1'i TEKRAR verdi (19:41:32). Fazlası aşağıda 2b ile geri alınır.
    const net = olaylar.docs
      .filter((o) => o.get('type') === 'entitlement.adjusted' && o.get('actor.id') === `migration:${RUN}`)
      .reduce((n, o) => n + Number(o.get('payload.delta') ?? 0), 0)
    return { ent, yanlis, bugun, eski, yeni, net }
  }

  const d = await oku()
  if (!d.ent || !d.ent.credits) return dur('paket yok ya da kredili değil.')
  if (!d.yanlis.exists || d.yanlis.get('memberId') !== VAKA.memberId || d.yanlis.get('classSessionId') !== VAKA.yanlisSeans)
    return dur('yanlış rezervasyon tanıdaki gibi değil.')
  if (!d.eski || !d.yeni) return dur('seans bulunamadı.')
  if (d.ent.status !== 'active') dur(`paket beklenmeyen durumda: ${d.ent.status}`)

  const duzeltilecek = d.yanlis.get('status') === 'attended'
  if (!duzeltilecek && d.yanlis.get('status') !== 'no_show') dur(`yanlış rezervasyon beklenmeyen durumda: ${d.yanlis.get('status')}`)
  const iadeEdilecek = d.net < 1
  const fazla = Math.max(0, d.net - 1)
  const bugunCanli = d.bugun.docs.filter((r) => !['cancelled', 'late_cancelled'].includes(String(r.get('status'))))
  const eklenecek = bugunCanli.length === 0
  const kapasiteInecek = d.eski.capacity === 9

  console.log('━━ BURÇİN GÖKNİL KAYA')
  console.log(`   paket: ${d.ent.productSnapshot.name} · ${d.ent.status} · kalan ${available(d.ent.credits)} · ${JSON.stringify(d.ent.credits)}`)
  console.log(`   yanlış satır: ${an(d.yanlis.get('sessionStartsAt').toMillis())} · ${d.yanlis.get('status')} · ${d.yanlis.get('creditEffect')}`)
  console.log(`   6 Ekim 19:00 seansı: kapasite ${d.eski.capacity}, dolu ${d.eski.bookedCount}`)
  console.log(`   13 Ekim 19:00 seansı: kapasite ${d.yeni.capacity}, dolu ${d.yeni.bookedCount} · üyenin kaydı: ${bugunCanli.map((r) => r.get('status')).join(', ') || 'yok'}`)

  console.log(`\n── ${APPLY ? 'UYGULANIYOR' : 'KURU ÇALIŞMA'} ──`)
  console.log(`   1) yanlış satır → Gelmedi (düzeltme)${duzeltilecek ? '' : ' — ZATEN YAPILMIŞ'}`)
  console.log(`   2) +1 hak (Düzeltme)${iadeEdilecek ? '' : ' — ZATEN VERİLMİŞ'}`)
  if (fazla > 0) console.log(`   2b) betiğin fazladan verdiği ${fazla} hak geri alınır`)
  console.log(`   3) 13 Ekim 19:00'a Katıldı olarak ekle${eklenecek ? '' : ' — ZATEN VAR'}`)
  console.log(`   4) 6 Ekim 19:00 kapasitesi 9 → 8${kapasiteInecek ? '' : ` — atlanır (şu an ${d.eski.capacity})`}`)
  console.log(`   sebep: ${REASON}`)
  if (!APPLY) { console.log('\n   --apply ile çalıştır.'); return }

  if (duzeltilecek) {
    const r = await correctReservation(resDeps, ctx, { reservationId: VAKA.yanlisRezervasyon, toOutcome: 'no_show', reason: REASON })
    if (!r.ok) dur(`1) BAŞARISIZ: ${JSON.stringify(r.error)} — hiçbir şey yazılmadı.`)
    console.log('   1) ✓')
  }
  if (iadeEdilecek) {
    const r = await adjustCredits({ repo: ents, clock: systemClock }, ctx, { entitlementId: VAKA.entitlementId, delta: 1, reason: 'correction', note: REASON })
    if (!r.ok) dur(`2) BAŞARISIZ: ${JSON.stringify(r.error)} — satır düzeltildi ama hak geri verilmedi. Betiği yeniden çalıştır.`)
    console.log('   2) ✓')
  }
  if (fazla > 0) {
    const r = await adjustCredits({ repo: ents, clock: systemClock }, ctx, {
      entitlementId: VAKA.entitlementId,
      delta: -fazla,
      reason: 'correction',
      note: `Düzeltme betiği (${RUN}) aynı iadeyi iki kez yazdı (19:41:06 ve 19:41:32); fazladan verilen ${fazla} hak geri alındı. Üyenin doğru bakiyesi bu.`,
    })
    if (!r.ok) dur(`2b) BAŞARISIZ: ${JSON.stringify(r.error)} — üyede ${fazla} fazla hak duruyor.`)
    console.log('   2b) ✓')
  }
  if (eklenecek) {
    // İlk çalıştırmada 3. adım `class_full` ile reddedildi: seans 7 dolu + 1 TUTULAN koltuk = 8/8.
    // Owner'ın 19:33'te yaptığı kapasite artışı ("1 kişi gelmedi yerine başkasını aldık") tam da bunun
    // içindi ama yanlış seansa gitti. Aynı karar, aynı sebeple, doğru seansa uygulanıyor.
    const yeni = await sched.getSession(ctx, VAKA.dogruSeans)
    if (yeni && yeni.bookedCount + (yeni.heldCount ?? 0) >= yeni.capacity) {
      const c = await changeCapacity({ repo: sched, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG, hours }, ctx, {
        sessionId: VAKA.dogruSeans,
        capacity: yeni.capacity + 1,
        reason: '1 kişi gelmedi yerine başkasını aldık (owner, 2026-10-13 — yanlışlıkla 06.10 seansına girilmişti)',
      })
      if (!c.ok) dur(`3a) KAPASİTE ARTIRILAMADI: ${JSON.stringify(c.error)} — hak geri verildi, bugünkü ders YAZILMADI.`)
      console.log(`   3a) ✓ 13 Ekim 19:00 kapasitesi ${yeni.capacity} → ${yeni.capacity + 1}`)
    }
    const member = await members.findById(ctx, VAKA.memberId)
    if (!member) return dur('üye yok.')
    const r = await bookPastAttended(resDeps, ctx, {
      sessionId: VAKA.dogruSeans,
      entitlementId: VAKA.entitlementId,
      memberId: VAKA.memberId,
      memberSnapshot: toMemberSnapshot(member),
      earliest: instant(Date.now() - 86_400_000),
    })
    if (!r.ok) dur(`3) BAŞARISIZ: ${JSON.stringify(r.error)} — hak geri verildi, bugünkü ders YAZILMADI.`)
    console.log('   3) ✓')
  }
  if (kapasiteInecek) {
    const r = await changeCapacity({ repo: sched, clock: systemClock, studioConfig: DEFAULT_STUDIO_CONFIG, hours }, ctx, {
      sessionId: VAKA.yanlisSeans,
      capacity: 8,
      reason: REASON,
    })
    if (!r.ok) console.log(`   4) ✗ kapasite indirilemedi: ${JSON.stringify(r.error)} — zararsız, elde 9 kalır.`)
    else console.log('   4) ✓')
  }

  const s = await oku()
  console.log('\n✅ SON DURUM')
  console.log(`   paket: kalan ${available(s.ent!.credits!)} · ${JSON.stringify(s.ent!.credits)} · ${s.ent!.status}`)
  console.log(`   yanlış satır: ${s.yanlis.get('status')} · ${s.yanlis.get('creditEffect')}`)
  console.log(`   13 Ekim 19:00: ${s.bugun.docs.map((r) => `${r.id} ${r.get('status')}`).join(', ')} · seans dolu ${s.yeni!.bookedCount}/${s.yeni!.capacity}`)
  console.log(`   6 Ekim 19:00: dolu ${s.eski!.bookedCount}/${s.eski!.capacity}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
