import type { BranchId, Instant, StaffRole, StaffUserId } from '../../../shared'
import type { BreakSource, LeaveKind } from '../events'

// A staff principal, as the scheduling pickers need to name one (assign/change a
// session's trainer). Phase 1 is read-only: staff exist as auth principals with
// custom claims plus a `/staff` document; creation-with-events is a later milestone.
// Any active staff member may be a session's trainer (a small studio's owner teaches).
export interface StaffMember {
  readonly id: StaffUserId
  readonly displayName: string
  readonly role: StaffRole
  readonly active: boolean
  /**
   * Haftalık vardiya planında görünür mü (owner, 2026-09-14 · OR-77). Alan YOKSA planda sayılır: yeni eğitmen
   * kendiliğinden görünür. `false` — ortak resepsiyon hesabı, owner'ın eğitmen hesabı gibi planlanmayan biri.
   */
  readonly inShiftPlan?: boolean
  /**
   * Tam mı yarı zamanlı (owner, 2026-10-06). Haftalık YASAL tavan herkese uygulanır; bu alan
   * sözleşmenin kendisini söyler. Alan YOKSA belirtilmemiştir — varsayılan uydurulmaz.
   */
  readonly employmentType?: EmploymentType
  /**
   * Sözleşmedeki haftalık net çalışma (dakika). YASAL TAVANLA AYNI ŞEY DEĞİL (owner, 2026-10-06:
   * *"45 saat bir zorunluluk değil… MAXIMUM NORMAL WEEKLY WORK"*). Sözleşmesi 40:00 olan birinin
   * tavanı yine 45:00'tır, hedefi 2400 dakikadır.
   *
   * Planı REDDETMEZ (owner onayı, 2026-10-07): sözleşmenin altında ya da üstünde kalmak raporda bir
   * satırdır. Ret sebebi yapmak, 45 saati yeniden bir zorunluluğa çevirirdi.
   */
  readonly contractWeeklyMinutes?: number
}

export type EmploymentType = 'full_time' | 'part_time'

/**
 * Bir vardiya: başladı, belki bitti.
 *
 * `endedAt === null` AÇIK vardiya demek — ve aynı anda bir kişinin yalnızca bir açık vardiyası
 * olabilir. Bu kural belgenin kimliğinde değil kararda duruyor, çünkü "bugünün vardiyası" diye bir
 * şey yok: gece yarısını geçen bir mesai hâlâ tek bir vardiyadır.
 */
export interface StaffShift {
  readonly id: string
  readonly staffUserId: StaffUserId
  readonly branchId: BranchId | null
  readonly startedAt: Instant
  readonly endedAt: Instant | null
  /**
   * Bu vardiyadaki SON turnike geçişi (owner, 2026-09-13). Gece işi açık vardiyayı buraya kapatır:
   * "son okutma" ancak gün bitince bilinebilir. `null` ⇒ bu vardiyada hiç geçiş olmadı (elle
   * açılmış) — ve o zaman gece işi ona DOKUNMAZ: gözlenmemiş bir bitiş saati uydurulmaz.
   */
  readonly lastCrossingAt: Instant | null
}

/**
 * Bir yokluk kaydı: talep edildi, onaylandı ya da reddedildi.
 *
 * TARİHLER GÜN SINIRIDIR, an değil. `from` stüdyo yerel gününün başı, `to` son günün SONU (dahil).
 * Sebebi pratik: insanlar "12–15 Eylül yokum" der, "12 Eylül 00:00'dan 15 Eylül 23:59'a" demez —
 * ve saat taşıyan bir izin, yarım gün tartışması açar. Yarım gün gerekirse ayrı bir kavramdır.
 */
export interface StaffLeave {
  readonly id: string
  readonly staffUserId: StaffUserId
  readonly kind: LeaveKind
  readonly from: Instant
  readonly to: Instant
  readonly note: string
  readonly status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  readonly requestedAt: Instant
  /** Kim karar verdi — ONAYLAYAN BİR PRENSİPTİR (#5) ve adı değil kimliği yazılır. */
  readonly decidedBy: StaffUserId | null
  readonly decidedAt: Instant | null
  /** Reddin sebebi. Sebepsiz bir red, çalışana hiçbir şey söylemez. */
  readonly decisionReason: string
}

// ── HAFTALIK VARDİYA PLANI (owner, 2026-09-14 · OR-77) ─────────────────────────────────────

/** Bir günün planlı mesaisi, stüdyo yerel saatiyle 'HH:MM'. GÜNDE TEK BLOK (OR-77, karar 1). */
export interface ShiftBlock {
  readonly start: string
  readonly end: string
  /**
   * PLANLANAN toplam ara dinlenmesi (dakika). Owner, 2026-10-06.
   *
   * Günde tek blok kuralı (OR-77 karar 1) BOZULMUYOR: mola bloğu ikiye ayırmıyor, bloğun içinden
   * düşülüyor. Alan YOKSA plan bu alandan önce onaylanmıştır — "0 mola" demek DEĞİLDİR, ve geçmiş
   * planlar bu yüzden yeniden doğrulanmaz.
   */
  readonly breakMinutes?: number
}

/** personel kimliği → 'YYYY-MM-DD' → blok. Yazılmamış gün = çalışmıyor. */
export type WeekPlanEntries = Readonly<Record<string, Readonly<Record<string, ShiftBlock>>>>

/**
 * `draft` — üzerinde çalışılıyor (yayında daha eski bir sürüm olabilir).
 * `submitted` — owner onayı bekliyor.
 * `published` — yayında, bekleyen değişiklik yok (`draft` ile `published` aynı).
 */
export type WeekPlanStatus = 'draft' | 'submitted' | 'published'

/**
 * Bir haftanın planı. Belge kimliği haftanın pazartesisi: bir hafta, bir plan.
 *
 * İKİ KATMAN, bilerek: resepsiyonun düzenlediği `draft` ve personelin gördüğü `published`. Hafta içi
 * değişiklik onaylanana kadar personel yayındakini görür (OR-77, karar 2) — onaylanmamış bir saati
 * kesinmiş gibi göstermek, gelmemesi gereken birini getirir.
 */
export interface StaffWeekPlan {
  readonly weekStart: string
  readonly status: WeekPlanStatus
  readonly draft: WeekPlanEntries
  /** `null` ⇔ bu hafta hiç onaylanmadı. Personel "plan henüz onaylanmadı" görür. */
  readonly published: WeekPlanEntries | null
  /** Kaç kez yayınlandı. */
  readonly version: number
  /** Owner'ın son geri gönderme sebebi; yeniden gönderilince temizlenir. */
  readonly returnReason: string
  readonly updatedAt: Instant
  readonly updatedBy: StaffUserId | null
  readonly submittedAt: Instant | null
  readonly approvedAt: Instant | null
  readonly approvedBy: StaffUserId | null
}

/**
 * İzne eklenmiş rapor dosyası (OR-77, karar 4). `staffLeaves/{leaveId}/documents/{id}` — iznin altında,
 * istemcinin hiçbir kuralla okuyamadığı bir alt koleksiyonda. `pages` özel Storage yolları; bir sayfa bir
 * fotoğraf ya da bir PDF.
 */
export interface StaffLeaveDocument {
  readonly id: string
  readonly leaveId: string
  readonly staffUserId: StaffUserId
  readonly pages: readonly string[]
  readonly uploadedAt: Instant
  readonly uploadedBy: StaffUserId
}

// ── ARA DİNLENMESİ (owner, 2026-10-06/07) ───────────────────────────────────────────────────

/**
 * Bir ara dinlenmesi: başladı, belki bitti.
 *
 * `endedAt === null` AÇIK mola demek — ve bir kişinin aynı anda yalnızca bir açık molası olabilir.
 * DURUM ALANI YOK, bilerek: `StaffShift`te olduğu gibi durum türetilir. Saklanan bir durum,
 * gerçekle ayrışabilen ikinci bir doğru kaynağıdır.
 *
 * `shiftId` ZORUNLU: mola bir vardiyanın İÇİNDEN düşülür. Vardiyası olmayan bir mola, neyden
 * düşüleceği bilinmeyen bir süredir — bu yüzden vardiyasız mola reddedilir (owner, 2026-10-07).
 */
export interface StaffBreak {
  readonly id: string
  readonly staffUserId: StaffUserId
  readonly shiftId: string
  readonly startedAt: Instant
  readonly endedAt: Instant | null
  readonly source: BreakSource
}

// ── HAFTALIK ÇİZELGE (owner, 2026-10-07) ────────────────────────────────────────────────────

/** Çizelgedeki bir gün. Plan yoksa `planned` null — "plan yok" ile "0 saat plan" aynı şey değildir. */
export interface TimesheetDay {
  readonly date: string
  readonly planned:
    | { readonly start: string; readonly end: string; readonly breakMinutes: number; readonly netMinutes: number }
    | null
  readonly actualPresenceMinutes: number
  readonly actualBreakMinutes: number
  readonly actualNetMinutes: number
  readonly excessBreakMinutes: number
  readonly netDeficitMinutes: number
  readonly netSurplusMinutes: number
  /** Kaç molası sonradan girildi / otomatik kapatıldı. Kâğıtta ayrı görünür (#11). */
  readonly retroEntryCount: number
  readonly autoClosedCount: number
}

/**
 * Bir haftanın DONMUŞ çizelgesi — ıslak imzayla imzalanan şey (owner, 2026-10-07).
 *
 * SNAPSHOT, hesap değil: üretildiği anda saklanır, her görüntülemede yeniden hesaplanmaz. Yeniden
 * hesaplanan bir çizelge, bir hafta sonra yapılan bir düzeltmeyle imzalanmış kâğıdın söylediğini
 * sessizce değiştirirdi.
 *
 * Düzeltme `version`'ı artırır ve YENİ bir kâğıt üretir; eski sürüm silinmez (#9).
 */
export interface WeeklyTimesheet {
  readonly weekStart: string
  readonly staffUserId: StaffUserId
  readonly version: number
  readonly generatedAt: Instant
  readonly generatedBy: StaffUserId | null
  readonly days: readonly TimesheetDay[]
  readonly plannedNetMinutes: number
  readonly actualNetMinutes: number
  readonly actualBreakMinutes: number
  readonly excessBreakMinutes: number
  /** `null` ⇒ henüz imzalanmadı. Panel "imzasız hafta" diye uyarabilir. */
  readonly signedAt: Instant | null
  readonly signedBy: StaffUserId | null
}