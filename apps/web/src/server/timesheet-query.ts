import 'server-only'

import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreIdentityRepository,
  FirestoreSchedulingRepository,
  FirestoreStaffBreakRepository,
  FirestoreStaffShiftRepository,
  FirestoreStaffTimesheetRepository,
  FirestoreStaffWeekPlanRepository,
  addLocalDays,
  buildTimesheetSnapshot,
  instant,
  instantFromLocalDate,
  loadWeekPlans,
  localDateAt,
  sameTimesheetContent,
  systemClock,
  type StaffUserId,
  type TenantContext,
  type TimesheetDay,
  type TimesheetSnapshot,
} from '@studio/core'

import { adminDb } from './firebase-admin'

// HAFTALIK RAPOR VE ÇİZELGE OKUMASI (owner, 2026-10-07 · OR-119 · Faz 6).
//
// İKİ AYRI ŞEY, ve ekran ikisini karıştırmamalı:
//
//   · CANLI hesap — plan, vardiyalar ve molalardan ŞU AN çıkan sayı. Bir düzeltmeyle değişir.
//   · KAYITLI çizelge — üretildiği anda dondurulmuş snapshot. İmzalanan kâğıt odur ve bir daha
//     hesaplanmaz; yeniden hesaplanan bir çizelge, sonradan yapılan bir düzeltmeyle imzalanmış
//     kâğıdın söylediğini sessizce değiştirirdi.
//
// İkisi farklıysa ekran bunu söyler ("kayıt güncel değil") ve yeniden üretmek YENİ bir sürüm verir.
// Snapshot'ı kuran hesap çekirdekte (`buildTimesheetSnapshot`): rapor ile kâğıt aynı fonksiyondan
// çıkıyor, iki ayrı toplama yok.

const OFF = DEFAULT_STUDIO_CONFIG.utcOffsetMinutes

/** Bir çizelgenin içeriği, tel üstünde: markalı tip yok, yalnızca sayı ve dizge. */
export interface SheetContent {
  readonly days: readonly TimesheetDay[]
  readonly plannedNetMinutes: number
  readonly actualNetMinutes: number
  readonly actualBreakMinutes: number
  readonly excessBreakMinutes: number
}

export interface SavedSheet extends SheetContent {
  readonly version: number
  readonly generatedAt: number
  /** `null` ⇒ imzasız. İmzanın işaretlenmesi Faz 7. */
  readonly signedAt: number | null
}

export interface TimesheetRow {
  readonly staffUserId: string
  readonly displayName: string
  /** Sözleşmedeki haftalık net (dk). Raporda bir satır; hiçbir şeyi reddetmez (OR-119). */
  readonly contractWeeklyMinutes: number | null
  readonly canli: SheetContent
  /** Bu haftanın bir vardiyasında KAPANMAMIŞ mola var: sayılmadı, ve kâğıda da girmez. */
  readonly acikMola: boolean
  /** Bu haftada kapanmamış vardiya var: son geçişine kadar sayıldı. */
  readonly acikVardiya: boolean
  readonly kayitli: SavedSheet | null
  /** Kayıtlı çizelge canlı hesapla AYNI kâğıt mı. Kayıt yoksa `false`. */
  readonly guncel: boolean
  /** Üretilecek bir şey var mı: planı da hareketi de olmayan birine boş kâğıt basılmaz. */
  readonly bos: boolean
}

export interface TimesheetWeekView {
  readonly weekStart: string
  /** Hafta onaylı bir plana sahip mi. Değilse "planlanan" sütunu boş kalır ve ekran bunu söyler. */
  readonly planYayinda: boolean
  /** Pazar geldi mi (owner: *"pazar çizelge üretilir"*). Hafta bitmeden üretilen kâğıt yarım haftadır. */
  readonly haftaKapandi: boolean
  readonly rows: readonly TimesheetRow[]
}

const icerik = (s: SheetContent): SheetContent => ({
  days: s.days,
  plannedNetMinutes: s.plannedNetMinutes,
  actualNetMinutes: s.actualNetMinutes,
  actualBreakMinutes: s.actualBreakMinutes,
  excessBreakMinutes: s.excessBreakMinutes,
})

/** Haftanın [başlangıç, bitiş] anı, stüdyo yerel saatiyle. Pazar 23:59:59.999 içeride. */
function haftaAraligi(weekStart: string): readonly [number, number] {
  const bas = instantFromLocalDate(weekStart, OFF) as number
  const bit = (instantFromLocalDate(addLocalDays(weekStart, 7), OFF) as number) - 1
  return [bas, bit]
}

/**
 * Haftanın ham girdileri ve her personelin CANLI snapshot'ı. Hem ekran hem üretim eylemi buradan
 * geçiyor: üretim, snapshot'ı İSTEMCİDEN ALMIYOR — ekranda görüneni değil, sunucunun o an
 * hesapladığını donduruyor.
 */
export async function buildWeekSnapshots(ctx: TenantContext, weekStart: string) {
  const db = adminDb()
  const [bas, bit] = haftaAraligi(weekStart)
  const [personel, planlar, vardiyalar, molalar] = await Promise.all([
    new FirestoreIdentityRepository(db).listStaff(ctx),
    loadWeekPlans(
      { repo: new FirestoreStaffWeekPlanRepository(db), clock: systemClock, utcOffsetMinutes: OFF },
      ctx,
      [weekStart],
    ),
    new FirestoreStaffShiftRepository(db).listShifts(ctx, bas, bit),
    // Mola VARDİYASININ gününe yazılıyor; pazar gecesi başlayan bir vardiyanın molası pazartesi
    // 00:10'da başlayabilir. Bir gün fazladan okumak onu kaçırmamak için — çekirdek, vardiyası bu
    // haftada olmayan molayı zaten saymıyor.
    new FirestoreStaffBreakRepository(db).listBreaksBetween(ctx, bas, bit + 86_400_000),
  ])
  const yayinda = planlar.find((p) => p.weekStart === weekStart)?.published ?? null
  const hareketli = new Set(vardiyalar.map((v) => String(v.staffUserId)))
  const vardiyaKimligi = new Set(vardiyalar.map((v) => v.id))

  const kisiler = personel
    .filter((s) => (s.active && s.inShiftPlan !== false) || hareketli.has(String(s.id)))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'tr'))
    .map((s) => {
      const id = String(s.id)
      const snapshot: TimesheetSnapshot = buildTimesheetSnapshot({
        weekStart,
        staffUserId: s.id,
        planned: yayinda?.[id] ?? null,
        shifts: vardiyalar,
        breaks: molalar,
        utcOffsetMinutes: OFF,
      })
      return {
        staff: s,
        snapshot,
        acikMola: molalar.some((m) => String(m.staffUserId) === id && m.endedAt === null && vardiyaKimligi.has(m.shiftId)),
        acikVardiya: vardiyalar.some((v) => String(v.staffUserId) === id && v.endedAt === null),
        bos: snapshot.plannedNetMinutes === 0 && !hareketli.has(id),
      }
    })
  return { kisiler, planYayinda: yayinda !== null }
}

export async function loadTimesheetWeek(ctx: TenantContext, weekStart: string): Promise<TimesheetWeekView> {
  const repo = new FirestoreStaffTimesheetRepository(adminDb())
  const { kisiler, planYayinda } = await buildWeekSnapshots(ctx, weekStart)
  // Kişi başına bir okuma (en yüksek sürüm). Küçük bir stüdyoda bir elin parmakları kadar; haftanın
  // bütün sürümlerini çekip burada ayıklamak, her düzeltmeyle büyüyen bir okuma olurdu.
  const kayitlar = await Promise.all(kisiler.map((k) => repo.getLatestTimesheet(ctx, weekStart, k.staff.id)))
  const bugun = localDateAt(instant(Date.now()), OFF) as string

  return {
    weekStart,
    planYayinda,
    haftaKapandi: bugun >= addLocalDays(weekStart, 6),
    rows: kisiler.map((k, i) => {
      const kayit = kayitlar[i] ?? null
      return {
        staffUserId: String(k.staff.id),
        displayName: k.staff.displayName,
        contractWeeklyMinutes: k.staff.contractWeeklyMinutes ?? null,
        canli: icerik(k.snapshot),
        acikMola: k.acikMola,
        acikVardiya: k.acikVardiya,
        kayitli: kayit
          ? {
              ...icerik(kayit),
              version: kayit.version,
              generatedAt: kayit.generatedAt as number,
              signedAt: kayit.signedAt === null ? null : (kayit.signedAt as number),
            }
          : null,
        guncel: kayit !== null && sameTimesheetContent(kayit, k.snapshot),
        bos: k.bos,
      }
    }),
  }
}

/** Basılacak kâğıt: KAYITLI bir sürüm. Canlı hesap asla basılmaz — imzalanan şey donmuş olandır. */
export interface TimesheetPaper {
  readonly studioName: string
  readonly staffName: string
  readonly weekStart: string
  readonly sheet: SavedSheet
  /** Bu, haftanın en yeni sürümü mü. Değilse kâğıt bunu üstünde yazar: eski bir sürüm basılıyor. */
  readonly enYeni: boolean
}

export async function loadTimesheetPaper(
  ctx: TenantContext,
  weekStart: string,
  staffUserId: string,
  version: number | null,
): Promise<TimesheetPaper | null> {
  const db = adminDb()
  const repo = new FirestoreStaffTimesheetRepository(db)
  const kim = staffUserId as StaffUserId
  const [enYeni, personel, ayarlar] = await Promise.all([
    repo.getLatestTimesheet(ctx, weekStart, kim),
    new FirestoreIdentityRepository(db).listStaff(ctx),
    new FirestoreSchedulingRepository(db).getStudioSettings(ctx),
  ])
  if (!enYeni) return null
  const sheet = version === null || version === enYeni.version ? enYeni : await repo.getTimesheet(ctx, weekStart, kim, version)
  if (!sheet) return null
  const sirket = ayarlar?.company ?? null
  return {
    // Kâğıt bir kayıt belgesi: üstünde tabeladaki ad değil, varsa resmî unvan yazar.
    studioName: sirket?.legalName || sirket?.displayName || 'Stüdyo',
    staffName: personel.find((s) => String(s.id) === staffUserId)?.displayName ?? '—',
    weekStart,
    sheet: {
      ...icerik(sheet),
      version: sheet.version,
      generatedAt: sheet.generatedAt as number,
      signedAt: sheet.signedAt === null ? null : (sheet.signedAt as number),
    },
    enYeni: sheet.version === enYeni.version,
  }
}
