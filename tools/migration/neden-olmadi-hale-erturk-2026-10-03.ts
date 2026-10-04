import {
  available,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  selectEntitlement,
  systemClock,
  toMemberSnapshot,
  type ClassSessionId,
  type Entitlement,
  type MemberId,
  type ReservationId,
  type TenantContext,
} from '@studio/core'
// `decideBooking` modülün public kapısında DEĞİL (Faz 1'de deciderlar içeride; kapı yorumu
// "testler ./domain/decide'dan doğrudan alır" diyor). Bu betik de aynısını yapıyor: tools/
// dizini depcruise kapsamında değil (`depcruise packages apps`), yani kapı kuralı kırılmıyor —
// ve amaç tam olarak reddi TAHMİN etmemek, gerçek karar fonksiyonuna sormak.
import { decideBooking } from '../../packages/core/src/modules/reservations/domain/decide'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// HALE ERTÜRK · PERŞEMBE 19:00 — NEDEN OLMADI? (owner, 2026-10-03)
//
//   pnpm tsx tools/migration/neden-olmadi-hale-erturk-2026-10-03.ts
//
// SALT OKUNUR. Hiçbir şey yazmaz, `--apply` yoktur.
//
// Owner: *"mesela hale ertürk ü perşembe 19 a almak istedim olmadı, niye"*
//
// ── NEDEN TAHMİN ETMİYORUZ ──────────────────────────────────────────────────────────────────
//
// Reddin sebebini veriye bakıp akıl yürüterek bulmak, yanlış koruma adını söyleme riskini taşıyor
// (dün gece yanlış bir alete bakıp emin bir yanlış sonuç söylemenin bedeli ödendi). Bunun yerine
// GERÇEK karar fonksiyonu (`decideBooking`) üretim verisiyle çalıştırılıyor: cevabı kod veriyor.
// Fonksiyon saf olduğu için bu okuma kadar güvenli.
//
// İki aşama: önce limitler OLMADAN (paket/tarih/kredi/kontenjan/kategori korumaları), sonra
// geçerse sebep Faz 3 limitlerindedir (günlük/aktif/haftalık hak, gün/saat/eğitmen kısıtı).

const STUDIO = 'retro'
const BRANCH = 'mutlukent'
const RUN = 'neden-olmadi-hale-erturk-2026-10-03'
const ARANAN = 'hale erturk'
const OFFSET_MIN = 180 // Europe/Istanbul

/** Türkçe katlama — /hale/i "HÂLE" ile eşleşmez; sıfır sonucu kanıt sayma tuzağı. */
const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .toLowerCase()
    .trim()

const yerel = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long' })
const gun = (ms: number) => new Date(ms).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })

/** Studio-local weekday (0=Paz) ve saat — domain'deki ile aynı aritmetik. */
const yerelParca = (ms: number) => {
  const d = new Date(ms + OFFSET_MIN * 60_000)
  return { gun: d.getUTCDay(), saat: d.getUTCHours(), dk: d.getUTCMinutes() }
}

const kredi = (e: Entitlement): string =>
  e.credits
    ? `kalan ${available(e.credits)} (verilen ${e.credits.granted}, tutulan ${e.credits.held}, ` +
      `harcanan ${e.credits.consumed}, iade ${e.credits.restored}, geri alınan ${e.credits.revoked}, ` +
      `YANAN ${e.credits.expired})`
    : 'süreli paket (kredi saymaz)'

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

  const memberRepo = new FirestoreMemberRepository(db)
  const entRepo = new FirestoreEntitlementRepository(db)
  const resRepo = new FirestoreReservationRepository(db)
  const schedRepo = new FirestoreSchedulingRepository(db)
  const hours = await new FirestoreStudioHours(db).getStudioHours(ctx)

  // ── 1. ÜYE ────────────────────────────────────────────────────────────────────────────────
  const hepsi = await db.collection(`studios/${STUDIO}/members`).get()
  const adaylar = hepsi.docs.filter((d) => fold(String(d.get('fullName') ?? '')).includes(ARANAN))
  console.log(`━━ ÜYE ARAMASI "${ARANAN}" → ${adaylar.length} eşleşme (${hepsi.size} üye tarandı)`)
  if (adaylar.length === 0) {
    const parca = adaylar.length === 0 ? hepsi.docs.filter((d) => fold(String(d.get('fullName') ?? '')).includes('hale')) : []
    console.log(`   "hale" içerenler: ${parca.map((d) => d.get('fullName')).join(' · ') || 'yok'}`)
    process.exit(1)
  }
  const doc = adaylar[0]!
  const memberId = doc.id as MemberId
  console.log(`   ${doc.get('fullName')} · ${memberId}`)

  const member = await memberRepo.findById(ctx, memberId)
  if (!member) { console.error('DUR: üye okunamadı.'); process.exit(1) }
  const snapshot = toMemberSnapshot(member)
  console.log(`   üyelik durumu: ${snapshot.membershipStatus}`)

  // ── 2. PAKETLERİ ──────────────────────────────────────────────────────────────────────────
  const paketler = await entRepo.listByMember(ctx, memberId)
  console.log(`\n━━ PAKETLER (${paketler.length})`)
  for (const e of paketler) {
    console.log(
      `   ${e.productSnapshot.name} · ${e.status} · kategori=${e.productSnapshot.category}\n` +
        `      geçerlilik ${gun(e.validFrom as number)} → ${gun(e.validUntil as number)} · ${kredi(e)}` +
        (e.freeze ? ` · DONDURMA var` : '') +
        (e.productSnapshot.serviceIds ? `\n      hizmetler: ${e.productSnapshot.serviceIds.join(', ')}` : '\n      hizmetler: (liste yok — kategori geneli)'),
    )
  }

  // ── 3. PERŞEMBE ~19:00 DERSLERİ ───────────────────────────────────────────────────────────
  const now = systemClock.now()
  const from = now - 7 * 86_400_000
  const to = now + 21 * 86_400_000
  const snap = await db
    .collection(`studios/${STUDIO}/classSessions`)
    .where('startsAt', '>=', Timestamp.fromMillis(from))
    .where('startsAt', '<=', Timestamp.fromMillis(to))
    .get()
  const persembe = snap.docs
    .map((d) => ({ id: d.id, startsAt: (d.get('startsAt') as Timestamp).toMillis() }))
    .filter(({ startsAt }) => {
      const p = yerelParca(startsAt)
      return p.gun === 4 && p.saat >= 18 && p.saat <= 20
    })
    .sort((a, b) => a.startsAt - b.startsAt)
  console.log(`\n━━ PERŞEMBE 18–20 ARASI DERSLER (${persembe.length}) · pencere ${gun(from)} → ${gun(to)}`)

  const rezervasyonlar = await resRepo.listByMember(ctx, memberId)

  for (const { id } of persembe) {
    const session = await schedRepo.getSession(ctx, id as ClassSessionId)
    if (!session) continue
    const p = yerelParca(session.startsAt as number)
    const dolu = session.bookedCount >= session.capacity
    console.log(
      `\n   ▸ ${yerel(session.startsAt as number)} ${String(p.saat).padStart(2, '0')}:${String(p.dk).padStart(2, '0')} · ` +
        `${session.serviceName} · ${session.category} · ${session.bookedCount}/${session.capacity}${dolu ? ' DOLU' : ''} · ${session.status}`,
    )
    console.log(`     ders=${id} · hizmet=${session.serviceId} · eğitmen=${session.trainerName ?? '—'}`)
    if (session.admission) {
      console.log(
        `     admission: kategoriler=[${(session.admission.categories ?? []).join(', ')}]` +
          ` · haftalık hak=${JSON.stringify(session.admission.weeklyQuotaByCategory ?? {})}`,
      )
    }

    const mevcut = rezervasyonlar.find((r) => r.classSessionId === id && r.status === 'booked')
    if (mevcut) console.log(`     ⚠ BU DERSTE ZATEN REZERVASYONU VAR (${mevcut.id})`)

    // Eylemin otomatik seçimi: hiçbir şey seçmezse hata `no_bookable_entitlement` olur.
    const aktifler = await entRepo.listActiveByMember(ctx, memberId)
    const secilen = selectEntitlement(aktifler, session, now)
    console.log(`     otomatik seçim: ${secilen ? `${secilen.productSnapshot.name} (${secilen.id})` : 'HİÇBİRİ → no_bookable_entitlement'}`)

    // Her paket için GERÇEK karar — limitler olmadan.
    for (const e of paketler) {
      const r = decideBooking(
        { ...ctx, now, commandId: null } as unknown as Parameters<typeof decideBooking>[0],
        session,
        e,
        { reservationId: 'res_kuru' as ReservationId, memberId, memberSnapshot: snapshot },
        Boolean(mevcut),
        hours,
      )
      const izinli = decideBooking(
        { ...ctx, now, commandId: null } as unknown as Parameters<typeof decideBooking>[0],
        session,
        e,
        {
          reservationId: 'res_kuru' as ReservationId,
          memberId,
          memberSnapshot: snapshot,
          creditExemption: { reason: 'kuru deneme' },
        },
        Boolean(mevcut),
        hours,
      )
      const et = (x: typeof r) => (x.ok ? `KABUL (kredi etkisi: ${x.value.reservation.creditEffect})` : `RET → ${x.error.code}`)
      console.log(`     · ${e.productSnapshot.name} [${e.status}] : ${et(r)}  |  istisnayla: ${et(izinli)}`)
    }
  }

  console.log('\n(salt okunur — hiçbir şey yazılmadı)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
