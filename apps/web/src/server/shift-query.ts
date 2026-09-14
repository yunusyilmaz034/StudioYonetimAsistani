import 'server-only'

import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreCheckinRepository,
  FirestoreIdentityRepository,
  FirestoreStaffLeaveRepository,
  FirestoreStaffShiftRepository,
  FirestoreStaffWeekPlanRepository,
  addLocalDays,
  instant,
  leaveDaysInWeek,
  loadWeekPlans,
  localDateAt,
  mondayOf,
  planVsActual,
  systemClock,
  weekDates,
  type ShiftBlock,
  type StaffUserId,
  type TenantContext,
} from '@studio/core'
import { Timestamp } from 'firebase-admin/firestore'

import { adminDb } from './firebase-admin'
import { studioDayRange } from './reservations-query'

// MESAİ EKRANININ OKUMASI (owner, 2026-09-01).
//
// İki soru, ikisi de küçük: *benim açık mesaim var mı* ve *bugün kim kaçta girdi çıktı*. İkincisi
// yalnızca owner'a gösteriliyor — bir hocanın bir başkasının saatini görmesi için bir sebep yok.
//
// İsim burada ekleniyor, olayda değil (#6): olay opak kimliği taşır, `/staff` belgesi ismi.

export interface ShiftRow {
  readonly id: string
  readonly staffUserId: string
  readonly displayName: string
  readonly startedAt: number
  readonly endedAt: number | null
  /** Son turnike geçişi. `null` ⇒ elle açılmış bir vardiya. */
  readonly lastCrossingAt: number | null
}

/** Tek bir turnike geçişi (`staff.crossed`). Yön yalnızca biliniyorsa yazılır (#11). */
export interface CrossingRow {
  readonly at: number
  readonly direction: 'in' | 'out' | null
  readonly deviceName: string | null
}

/** Bir personelin seçilen günü: vardiya(lar)ı ve o günkü bütün geçişleri, saat sırasıyla. */
export interface StaffDayRow {
  readonly staffUserId: string
  readonly displayName: string
  readonly shifts: readonly ShiftRow[]
  readonly crossings: readonly CrossingRow[]
  /** O günün YAYINDAKİ planı (OR-77). `null` ⇒ planda yok ya da hafta onaylanmadı. */
  readonly planned: ShiftBlock | null
  /** İlk geçiş planlı girişten kaç dk sonra. Yalnızca görünür — kesinti yok. */
  readonly lateMinutes: number | null
  /** Son geçiş planlı çıkıştan kaç dk önce. Yalnızca GÜN BİTTİYSE: gün içindeki son geçiş öğle arası olabilir. */
  readonly earlyMinutes: number | null
  /** Planı vardı, planlı giriş saati geçti, hiç geçişi ya da vardiyası yok. */
  readonly absent: boolean
}

/** Personelin kendi haftası: yalnızca YAYINDAKİ plan (OR-77). Taslak personele gösterilmez. */
export interface MyWeek {
  readonly weekStart: string
  /** `false` ⇒ "Plan henüz onaylanmadı". */
  readonly published: boolean
  readonly days: readonly { readonly date: string; readonly block: ShiftBlock | null; readonly leave: string | null }[]
}

export interface ShiftView {
  readonly benimAcik: ShiftRow | null
  /** Listenin günü, 'YYYY-MM-DD' (stüdyonun yerel günü). */
  readonly tarih: string
  /**
   * GÜNLÜK GİRİŞ-ÇIKIŞLAR (owner, 2026-09-14 · OR-77 · iş 1). Owner değilse boş — ekran bunu "liste yok"
   * diye okur, "o gün kimse çalışmadı" diye değil.
   */
  readonly gunluk: readonly StaffDayRow[]
  /** Bu hafta ve önümüzdeki hafta. Owner için `null` — owner kendi mesaisini planlatmıyor. */
  readonly benimHaftam: readonly MyWeek[] | null
  /**
   * Stüdyoda çalışan bir turnike var mı? (OR-74) Varsa mesai turnikeden türetilir ve elle
   * başlat/bitir düğmeleri GÖSTERİLMEZ: ikisi yan yana dururken 17:00'de elle biten bir mesai,
   * 17:02'deki çıkış geçişiyle yeniden açılırdı.
   */
  readonly turnikeVar: boolean
}

const OFF = DEFAULT_STUDIO_CONFIG.utcOffsetMinutes

export async function loadShiftView(ctx: TenantContext, dateStr: string): Promise<ShiftView> {
  const db = adminDb()
  const shifts = new FirestoreStaffShiftRepository(db)
  const ben = String(ctx.actor.id) as StaffUserId
  const [fromMs, toMs] = studioDayRange(dateStr)

  const ownerMu = ctx.actor.type === 'owner' || ctx.actor.type === 'platform_admin'
  const bugun = localDateAt(instant(Date.now()), OFF)
  const buHafta = mondayOf(bugun)
  const haftalarim = [buHafta, addLocalDays(buHafta, 7)]
  const planDeps = { repo: new FirestoreStaffWeekPlanRepository(db), clock: systemClock, utcOffsetMinutes: OFF }
  const [acik, gunlukler, gecisler, personel, cihazlar, planlar, izinlerim] = await Promise.all([
    shifts.getOpenShift(ctx, ben),
    // Gün listesi yalnızca owner için okunuyor: göstermeyeceğimiz bir şeyi okumak, sızıntının
    // en ucuz hâlidir.
    ownerMu ? shifts.listShifts(ctx, fromMs, toMs) : Promise.resolve([]),
    // GÜNÜN GEÇİŞLERİ. İndeks YENİ DEĞİL: `(type ASC, recordedAt DESC)` zaten canlıda — ve sıralama
    // yönü indeksinkiyle AYNI (desc). Ters yön, emülatörde geçen ama canlıda "requires an index"
    // diye düşen bir sorgu olurdu. Personel geçişi anında yazıldığı için `recordedAt` günü doğru çizer.
    ownerMu
      ? db
          .collection('studios')
          .doc(ctx.studioId)
          .collection('events')
          .where('type', '==', 'staff.crossed')
          .where('recordedAt', '>=', Timestamp.fromMillis(fromMs))
          .where('recordedAt', '<', Timestamp.fromMillis(toMs))
          .orderBy('recordedAt', 'desc')
          .limit(500)
          .get()
          .then((s) => s.docs)
      : Promise.resolve([]),
    new FirestoreIdentityRepository(db).listStaff(ctx),
    new FirestoreCheckinRepository(db).listDevices(ctx),
    // Plan: owner için listenin haftası, personel için kendi iki haftası. Belge kimliği tarih — sorgu
    // değil, en fazla üç doğrudan okuma; indeks gerekmiyor.
    loadWeekPlans(planDeps, ctx, ownerMu ? [mondayOf(dateStr)] : haftalarim),
    ownerMu ? Promise.resolve([]) : new FirestoreStaffLeaveRepository(db).listLiveLeavesOf(ctx, ben),
  ])

  const ad = new Map(personel.map((s) => [String(s.id), s.displayName]))
  const cihazAdi = new Map(cihazlar.map((d) => [String(d.id), d.name]))
  const satir = (s: {
    id: string
    staffUserId: StaffUserId
    startedAt: number
    endedAt: number | null
    lastCrossingAt: number | null
  }): ShiftRow => ({
    id: s.id,
    staffUserId: String(s.staffUserId),
    displayName: ad.get(String(s.staffUserId)) ?? '—',
    startedAt: Number(s.startedAt),
    endedAt: s.endedAt === null ? null : Number(s.endedAt),
    lastCrossingAt: s.lastCrossingAt === null ? null : Number(s.lastCrossingAt),
  })

  // Personel başına grupla: vardiyası olup geçişi olmayan (elle açılmış) ve geçişi olup o gün başlamış
  // vardiyası olmayan (dünden açık kalmış) biri de listede görünür.
  const gruplar = new Map<string, { shifts: ShiftRow[]; crossings: CrossingRow[] }>()
  const grup = (id: string) => {
    let g = gruplar.get(id)
    if (!g) gruplar.set(id, (g = { shifts: [], crossings: [] }))
    return g
  }
  for (const s of gunlukler) grup(String(s.staffUserId)).shifts.push(satir(s))
  for (const d of gecisler) {
    const id = String(d.get('payload.staffUserId') ?? '')
    if (!id) continue
    const zaman = d.get('occurredAt') as Timestamp | number | null
    const at = zaman instanceof Timestamp ? zaman.toMillis() : Number(zaman ?? 0)
    const yon = d.get('payload.direction') as 'in' | 'out' | null | undefined
    const cihaz = String(d.get('payload.deviceId') ?? '')
    grup(id).crossings.push({ at, direction: yon ?? null, deviceName: cihazAdi.get(cihaz) ?? null })
  }
  // PLAN İLE TURNİKE (OR-77, karar 3). Planda olup hiç gelmeyen de listede görünsün diye grup açılır.
  const gununPlani = ownerMu ? (planlar.find((p) => p.weekStart === mondayOf(dateStr))?.published ?? null) : null
  for (const [sid, gunler] of Object.entries(gununPlani ?? {})) if (gunler[dateStr]) grup(sid)

  const ilkHareket = (g: { shifts: readonly ShiftRow[]; crossings: readonly CrossingRow[] }) =>
    Math.min(...g.shifts.map((s) => s.startedAt), ...g.crossings.map((c) => c.at))
  const gunluk: StaffDayRow[] = [...gruplar]
    .map(([staffUserId, g]) => {
      const shifts = g.shifts.sort((a, b) => a.startedAt - b.startedAt)
      const crossings = g.crossings.sort((a, b) => a.at - b.at)
      const planned = gununPlani?.[staffUserId]?.[dateStr] ?? null
      const zamanlar = [...crossings.map((c) => c.at), ...shifts.map((s) => s.startedAt)]
      const bitisler = [...crossings.map((c) => c.at), ...shifts.map((s) => s.endedAt ?? s.lastCrossingAt ?? s.startedAt)]
      const ilk = zamanlar.length > 0 ? Math.min(...zamanlar) : null
      const son = bitisler.length > 0 ? Math.max(...bitisler) : null
      const fark = planned ? planVsActual(dateStr, planned, ilk, son, OFF) : null
      // "Erken çıktı" ancak gün bittiyse kesin: geçmiş bir gün, ya da bütün vardiyaları kapanmış.
      const gunBitti = dateStr < bugun || (shifts.length > 0 && shifts.every((s) => s.endedAt !== null))
      return {
        staffUserId,
        displayName: ad.get(staffUserId) ?? '—',
        shifts,
        crossings,
        planned,
        lateMinutes: fark?.lateMinutes ?? null,
        earlyMinutes: gunBitti ? (fark?.earlyMinutes ?? null) : null,
        absent: fark !== null && ilk === null && (dateStr < bugun || Date.now() > (fark.plannedStart as number)),
      }
    })
    .sort((a, b) => ilkHareket(a) - ilkHareket(b) || a.displayName.localeCompare(b.displayName, 'tr'))

  // PERSONELİN KENDİ HAFTASI — yalnızca yayındaki plan. Taslak GÖSTERİLMEZ (OR-77): onaylanmamış
  // bir saati kesinmiş gibi göstermek, gelmemesi gereken birini getirir.
  const benimHaftam: MyWeek[] | null = ownerMu
    ? null
    : haftalarim.map((w) => {
        const yayinda = planlar.find((p) => p.weekStart === w)?.published ?? null
        const izinli = leaveDaysInWeek(w, izinlerim, OFF)[String(ben)] ?? {}
        return {
          weekStart: w,
          published: yayinda !== null,
          days: weekDates(w).map((d) => ({ date: d, block: yayinda?.[String(ben)]?.[d] ?? null, leave: izinli[d] ?? null })),
        }
      })

  return {
    benimAcik: acik ? satir(acik) : null,
    tarih: dateStr,
    gunluk,
    benimHaftam,
    turnikeVar: cihazlar.some((d) => d.active),
  }
}
