import 'server-only'

import {
  dayTotals,
  FirestoreStaffBreakRepository,
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
  /**
   * O GÜNÜN MOLALARI (owner, 2026-10-06/07 · OR-119). Mola, işyerinde BULUNMAK değildir: bulunma
   * süresinden düşülür, çalışmaya eklenmez.
   */
  readonly molaKapanmisDk: number
  /** Açık mola varsa başlangıcı — sayacı tarayıcı hesaplar, sunucu saniye yazmaz. `null` ⇒ molada değil. */
  readonly molaAcikBaslangic: number | null
  /** Planlanan mola (dk). `null` ⇒ plan yok ya da plan bu alandan önce onaylandı. */
  readonly planliMolaDk: number | null
  /** Planlanan net çalışma (dk). `null` ⇒ o gün için yayındaki plan yok. */
  readonly planNetDk: number | null
  /**
   * İŞYERİNDE BULUNMA, iki parça — çünkü biri bitmiş, öbürü hâlâ akıyor. `bulunmaKapaliDk` artık
   * değişmeyecek olan kısım; `bulunmaAcikBaslangic` hâlâ sayan vardiyanın başlangıcı ve aradaki
   * dakikayı tarayıcı hesaplıyor (sunucu "şu an"ı yazsaydı sayı sayfa yüklendiği anda donardı).
   * Yalnızca görünürlük ve kayıt — hiçbir ücret kesintisi üretmez (OR-119).
   */
  readonly bulunmaKapaliDk: number
  readonly bulunmaAcikBaslangic: number | null
  /**
   * Vardiya açık ama son geçiş ÇIKIŞ yönünde: içeride değil. Yön yalnızca cihaz bildirdiyse
   * bilinir (#11) — bilinmiyorsa `false`, "içeride" varsayılmış olmaz, yalnızca iddia edilmez.
   */
  readonly disarida: boolean
}

/** Personelin kendi haftası: yalnızca YAYINDAKİ plan (OR-77). Taslak personele gösterilmez. */
export interface MyWeek {
  readonly weekStart: string
  /** `false` ⇒ "Plan henüz onaylanmadı". */
  readonly published: boolean
  readonly days: readonly { readonly date: string; readonly block: ShiftBlock | null; readonly leave: string | null }[]
}

/**
 * BUGÜNÜN MOLA DURUMU (owner, 2026-10-06/07 · OR-119).
 *
 * Sunucu yalnızca üç şey veriyor: kapanmış molaların toplamı, açık molanın başlangıcı ve planlı
 * sayılar. Aradaki her saniyeyi tarayıcı `startedAt`ten hesaplıyor — backend'e saniyede bir yazmak
 * da, saniyede bir okumak da gereksiz (owner §11).
 */
export interface MolaDurumu {
  /** Açık mola varsa başlangıcı; sayaç bundan hesaplanır. `null` ⇒ çalışıyor. */
  readonly acikBaslangic: number | null
  /** Bugün KAPANMIŞ molaların toplamı (dk). Açık mola buna dahil DEĞİL — onu istemci ekliyor. */
  readonly kapanmisDk: number
  /** Bugünün YAYINDAKİ planından mola (dk). `null` ⇒ plan yok ya da plan bu alandan önce onaylandı. */
  readonly planliDk: number | null
  /** Planlanan net çalışma (dk) ve planlı çıkış saati ('HH:MM'). Plan yoksa null. */
  readonly planNetDk: number | null
  readonly planCikis: string | null
}

export interface ShiftView {
  readonly benimAcik: ShiftRow | null
  /** Bugünün mola durumu — personelin kendi kartı için. */
  readonly molam: MolaDurumu
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
  const molalar = new FirestoreStaffBreakRepository(db)
  const [bugunBas, bugunBit] = studioDayRange(bugun)
  const [acik, gunlukler, gecisler, personel, cihazlar, planlar, izinlerim, acikMola, bugunMolalar, gecmisGunMolalar] =
    await Promise.all([
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
    molalar.getOpenBreak(ctx, ben),
    // BUGÜNÜN molaları — kartın "kullanılan" sayısı. Aralık sorgusu tek alan üzerinde, bileşik
    // index istemiyor.
    molalar.listBreaksBetween(ctx, bugunBas, bugunBit),
    // YÖNETİCİ CANLI DURUMU (OR-119) seçilen GÜNÜN molalarını istiyor; owner `?gun=` ile geçmişi
    // gezebiliyor. Bugün geziliyorsa yukarıdaki okuma yeniden kullanılıyor — aynı aralığı iki kez
    // okumak bütçeyi sebepsiz ikiye katlardı.
    ownerMu && dateStr !== bugun ? molalar.listBreaksBetween(ctx, fromMs, toMs) : Promise.resolve([]),
  ])
  const gunMolalar = dateStr === bugun ? bugunMolalar : gecmisGunMolalar

  // ── MOLA ALANLARI (OR-119) ─────────────────────────────────────────────────────────────────
  //
  // Bulunma süresi vardiyalardan geliyor, geçişlerden değil: geçiş sürtünmesiz ve gün içinde
  // defalarca oluyor (OR-74), vardiya ise bilinçli olarak açılıp kapanıyor.
  //
  // AÇIK VARDİYA ÜÇ AYRI ŞEY OLABİLİR, ve üçü aynı sayılmıyor:
  //   · bugün, son geçiş çıkış DEĞİL → hâlâ sayıyor; başlangıcı gidiyor, dakikayı tarayıcı sayıyor.
  //   · bugün, son geçiş ÇIKIŞ      → son geçişte duruyor. Gece süpürgesi vardiyayı zaten tam o
  //     saate kapatacak (OR-74); 17:02'de çıkmış birinin neti 23:00'a kadar büyüseydi ekran, yarın
  //     sabah kaydın söyleyeceği şeyle çelişirdi.
  //   · geçmiş gün                   → son geçişte duruyor. Şimdiye kadar saymak, kapanmamış bir
  //     vardiyayı her gün biraz daha uzatırdı.
  const dk = (bas: number, bit: number) => Math.max(0, Math.floor((bit - bas) / 60_000))
  const molaAlanlari = (
    staffUserId: string,
    planned: ShiftBlock | null,
    shifts: readonly ShiftRow[],
    crossings: readonly CrossingRow[],
  ): Pick<
    StaffDayRow,
    | 'molaKapanmisDk'
    | 'molaAcikBaslangic'
    | 'planliMolaDk'
    | 'planNetDk'
    | 'bulunmaKapaliDk'
    | 'bulunmaAcikBaslangic'
    | 'disarida'
  > => {
    const benimkiler = gunMolalar.filter((m) => String(m.staffUserId) === staffUserId)
    const kapanmisDk = benimkiler
      .filter((m) => m.endedAt !== null)
      .reduce((a, m) => a + dk(m.startedAt as number, m.endedAt as number), 0)
    const acikOlan = benimkiler.find((m) => m.endedAt === null) ?? null
    const planliMolaDk = planned?.breakMinutes ?? null
    const planToplam = planned
      ? dayTotals({ start: planned.start, end: planned.end, breakMinutes: planliMolaDk ?? 0 })
      : null
    const sonGecis = crossings.at(-1) ?? null
    const acikVardiya = shifts.find((s) => s.endedAt === null) ?? null
    const disarida = dateStr === bugun && acikVardiya !== null && sonGecis?.direction === 'out'
    const sayiyor = dateStr === bugun && acikVardiya !== null && !disarida
    const bulunmaKapaliDk = shifts.reduce((a, s) => {
      if (s.endedAt !== null) return a + dk(s.startedAt, s.endedAt)
      if (sayiyor && s === acikVardiya) return a
      return a + dk(s.startedAt, s.lastCrossingAt ?? s.startedAt)
    }, 0)
    return {
      molaKapanmisDk: kapanmisDk,
      molaAcikBaslangic: acikOlan ? (acikOlan.startedAt as number) : null,
      planliMolaDk,
      planNetDk: planToplam?.netMinutes ?? null,
      bulunmaKapaliDk,
      bulunmaAcikBaslangic: sayiyor ? acikVardiya.startedAt : null,
      disarida,
    }
  }

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
        ...molaAlanlari(staffUserId, planned, shifts, crossings),
      }
    })
    .sort((a, b) => ilkHareket(a) - ilkHareket(b) || a.displayName.localeCompare(b.displayName, 'tr'))

  // PERSONELİN KENDİ HAFTASI — yalnızca yayındaki plan. Taslak GÖSTERİLMEZ (OR-77): onaylanmamış
  // bir saati kesinmiş gibi göstermek, gelmemesi gereken birini getirir.
  // Plandan çıkarılmış hesap (ortak resepsiyon, owner'ın eğitmen hesabı) "Haftam"ı da görmez: planlanmayacak
  // birine her hafta "plan onaylanmadı" demek, olmayan bir beklenti yaratır.
  const planDisi = personel.find((s) => String(s.id) === String(ben))?.inShiftPlan === false
  const benimHaftam: MyWeek[] | null = ownerMu || planDisi
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

  // BUGÜNÜN PLANI: mola sayıları her zaman bugüne ait, owner başka bir günü gezse de — kart
  // "BUGÜN" diyor. Yayındaki plan; taslak personele gösterilmez (OR-77).
  const bugunBlok = planlar.find((p) => p.weekStart === buHafta)?.published?.[String(ben)]?.[bugun] ?? null
  const planliMolaDk = bugunBlok?.breakMinutes ?? null
  const planToplam = bugunBlok ? dayTotals({ start: bugunBlok.start, end: bugunBlok.end, breakMinutes: planliMolaDk ?? 0 }) : null
  const molam: MolaDurumu = {
    acikBaslangic: acikMola ? (acikMola.startedAt as number) : null,
    kapanmisDk: bugunMolalar
      .filter((m) => String(m.staffUserId) === String(ben) && m.endedAt !== null)
      .reduce((a, m) => a + Math.max(0, Math.floor(((m.endedAt as number) - (m.startedAt as number)) / 60_000)), 0),
    planliDk: planliMolaDk,
    planNetDk: planToplam?.netMinutes ?? null,
    planCikis: bugunBlok?.end ?? null,
  }

  return {
    benimAcik: acik ? satir(acik) : null,
    molam,
    tarih: dateStr,
    gunluk,
    benimHaftam,
    turnikeVar: cihazlar.some((d) => d.active),
  }
}
