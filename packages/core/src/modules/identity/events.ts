import type { StaffRole } from '../../shared'

// Staff — who may work here, and as what (v1.27 S1 · owner, 2026-07-13).
//
// Until now the `identity` module was READ-ONLY: a list of names to hang on a class. Staff accounts
// existed only because a seed script put them in the emulator, which meant that on a fresh
// production project **nobody could log in at all** — and that no second receptionist could ever be
// added without a developer.
//
// ── Why these are events at all ─────────────────────────────────────────────────────────────
// Because they are the most consequential writes in the system that touch no money. Granting
// somebody the receptionist role hands her every member's phone number and the key to the till;
// changing a role is the quietest possible way to widen access, and a role that changed with no
// record is a role nobody can explain. The audit answers *who could do what, when* — and it can only
// answer that if the change was written down at the moment it happened.
//
// ── No PII, as everywhere else (#6) ─────────────────────────────────────────────────────────
// A staff member's NAME and e-mail are PII, and they never enter a payload. They live on the
// `/staff` document, which is where an erasure would reach them. What the log records is the opaque
// user id and the ROLE — which is the analysable part, and the part that must survive her leaving.
export const STAFF_CREATED = 'staff.created'
export const STAFF_ROLE_CHANGED = 'staff.role_changed'
export const STAFF_DEACTIVATED = 'staff.deactivated'
export const STAFF_REACTIVATED = 'staff.reactivated'

export type StaffCreatedPayload = {
  readonly staffUserId: string
  readonly role: StaffRole
}

// `from` and `to`, both — a role change is only legible if you can see what it changed FROM. "Ayşe
// became a receptionist" tells you nothing about whether that was a promotion or a demotion.
export type StaffRoleChangedPayload = {
  readonly staffUserId: string
  readonly from: StaffRole
  readonly to: StaffRole
}

export type StaffDeactivatedPayload = {
  readonly staffUserId: string
  readonly reason: string
}

export type StaffReactivatedPayload = {
  readonly staffUserId: string
}

// Vardiya planında görünmek (owner, 2026-09-14 · OR-77). Plana giren kişi bir rol değil bir KARAR — ortak
// resepsiyon hesabının ya da owner'ın eğitmen hesabının vardiyası planlanmaz. İsim yok (#6).
export const STAFF_SHIFT_PLAN_MEMBERSHIP_SET = 'staff.shift_plan_membership_set'
export type StaffShiftPlanMembershipSetPayload = {
  readonly staffUserId: string
  readonly included: boolean
}

// ── MESAİ (owner, 2026-09-01) ───────────────────────────────────────────────────────────────
//
// Owner: *"personel de giriş çıkış yapabilsin pdks gibi değil de en azından saat kaçta girdi çıktı
// görsek yeterli."*
//
// ── Neden turnikeden DEĞİL ─────────────────────────────────────────────────────────────────
//
// Personel gün içinde defalarca girip çıkıyor: kargo, öğle, komşu dükkân. Her geçişi mesai sayarsak
// "saat kaçta geldi" sorusunun cevabı otuz satır olur ve hiçbiri doğru olmaz — öğle çıkışıyla mesai
// bitişi aynı şekle sahip. Turnikeden geçiş SÜRTÜNMESİZ kalıyor; mesai günde iki kez, elle,
// bilinçli olarak yazılıyor. Ölçmek istediğimiz şey geçiş değil, VARDİYA.
//
// ── Neden üye giriş-çıkışıyla aynı yerde değil ─────────────────────────────────────────────
//
// `member.checked_in` doluluk sayar. Personeli oraya karıştırmak, salondaki üye sayısını kalıcı
// olarak yanlış yapardı — check-in/attendance karışıklığının aynısı, bir kez karıştıktan sonra
// ayrıştırılamaz.
//
// PII yok (#6): olayda yalnızca opak kullanıcı kimliği duruyor, isim `/staff` belgesinde.
export const STAFF_SHIFT_STARTED = 'staff.shift_started'
export const STAFF_SHIFT_ENDED = 'staff.shift_ended'

// ── İZİN / YOKLUK (owner onayı, 2026-09-11) ─────────────────────────────────────────────────
//
// Owner: *"mesaiye bir de izin yönetim sistemi eklesek mi?"*
//
// EKLENEN ŞEY İZİN BAKİYESİ DEĞİL, YOKLUKTUR — ve fark, ürünün tamamını belirliyor.
//
// Yıllık izin hakkı, devreden gün, kıdeme göre 14/20/26 gün aritmetiği İK yazılımıdır: otuz kişilik
// bir şirket için yazılır, İş Kanunu'nu koda gömer ve her yıl çürür. Beş eğitmenli bir stüdyoda
// owner'ın hiçbir günlük kararını değiştirmez.
//
// Değiştirdiği karar şu: **eğitmen yarın yok, ve o gün ona atanmış dersler sahipsiz.** Yerine biri
// konacak mı, yoksa ders iptal mi edilecek? Bugün bu ancak eğitmen söylerse ve owner hatırlarsa
// biliniyor; perşembe sabahı öğrenilen bir yokluk üç ders demek.
//
// Bakiye aritmetiği SONRADAN, veriye dokunmadan eklenebilir. Yokluğun kendisi eklenemez: bugün
// kaydedilmeyen izin, yarın raporlanamaz.
//
// PII yok (#6): olayda opak kullanıcı kimliği, tarihler ve kapalı bir tür duruyor. İsim `/staff`te.
export const STAFF_LEAVE_REQUESTED = 'staff.leave_requested'
export const STAFF_LEAVE_APPROVED = 'staff.leave_approved'
export const STAFF_LEAVE_REJECTED = 'staff.leave_rejected'
// Geri çekmek SİLMEK değildir: talep kaydı duruyor, durumu değişiyor. Silinen bir izin talebi,
// "ben istemiştim / bana gelmedi" tartışmasının iki tarafını da kanıtsız bırakır.
export const STAFF_LEAVE_CANCELLED = 'staff.leave_cancelled'

/** Kapalı enum: yokluğun sebepleri sayılabilir olmalı, serbest metin değil — rapor buna dayanıyor. */
export type LeaveKind = 'izin' | 'rapor' | 'egitim' | 'diger'

export type StaffLeaveRequestedPayload = {
  readonly leaveId: string
  readonly staffUserId: string
  readonly kind: LeaveKind
  /** Stüdyo yerel saatiyle GÜN sınırları: `from` günün başı, `to` günün SONU (dahil). */
  readonly fromMs: number
  readonly toMs: number
  readonly days: number
  /** Not YAZILDI MI — notun kendisi olayda değil: serbest metin, PII'nin sızdığı yerdir. */
  readonly hasNote: boolean
}

export type StaffLeaveApprovedPayload = {
  readonly leaveId: string
  readonly staffUserId: string
  /** Onay anında o aralıkta bu eğitmene atanmış ders sayısı. Onaylayan bunu GÖRDÜ demektir —
   *  ve altı ay sonra "haberim yoktu" cümlesinin karşısına konacak tek kayıt budur. */
  readonly affectedSessions: number
}

export type StaffLeaveRejectedPayload = {
  readonly leaveId: string
  readonly staffUserId: string
  readonly reason: string
}

export type StaffLeaveCancelledPayload = {
  readonly leaveId: string
  readonly staffUserId: string
  /** Onaylanmış bir izni geri almak ile talebi geri çekmek aynı şey değil; rapor ikisini ayırıyor. */
  readonly wasApproved: boolean
}

// ── TURNİKEDEN GEÇEN PERSONEL (owner, 2026-09-13) ─────────────────────────────────────────
//
// *"Eğitmenlerin gün içinde ilk QR okutması mesai başlangıcı, son okutması mesai çıkışı sayılsın;
// gün içinde çoklu giriş yapabilirler."* — bu, yukarıdaki "neden turnikeden DEĞİL" gerekçesini
// bilerek tersine çeviriyor (OR-74, OR-58'in yerine).
//
// ── Neden AYRI bir olay, `member.checked_in` değil ─────────────────────────────────────────
//
// `member.checked_in` doluluk sayar. Personel oraya girseydi salondaki üye sayısı kalıcı olarak
// yanlış olurdu. Üretici (turnike) olay adında yok (#2): kapının kendisi değil, KİMİN geçtiği.
//
// ── Neden geçiş ve vardiya AYRI olaylar ────────────────────────────────────────────────────
//
// Geçiş bir GÖZLEMDİR: bu kişi bu kapıdan şu saatte geçti. Vardiya bir YORUMDUR: "günün ilk geçişi
// başlangıç, son geçişi bitiş". Yorum kuralı yarın değişirse (öğle arası düşülsün, ilk giriş değil
// ilk DERS saati sayılsın…) geçişler yeniden okunabilir — ama yalnızca yorumla KARIŞTIRILMADAN
// yazıldılarsa. Bu yüzden yükte `shiftId` yok, bilerek.
//
// `direction` null OLABİLİR: tek ekranlı bir kapıda yön bilinmiyor ve personelin varlık kaydı yok
// ki çıkarım yapılsın. Bilinmeyen bir yönü tahminle doldurmak, bir tahmini gözlem diye yazmaktır (#11).
export const STAFF_CROSSED = 'staff.crossed'

export type StaffCrossedPayload = {
  readonly staffUserId: string
  readonly deviceId: string
  readonly direction: 'in' | 'out' | null
}

export type StaffShiftStartedPayload = {
  readonly staffUserId: string
  readonly shiftId: string
}

export type StaffShiftEndedPayload = {
  readonly staffUserId: string
  readonly shiftId: string
  /** Dakika. Türetilebilir ama olayın kendisi okunabilir olsun diye yazılıyor — bir vardiyanın
   *  uzunluğu, o vardiya hakkında sorulan ilk sorudur. */
  readonly minutes: number
}

// ── HAFTALIK VARDİYA PLANI (owner, 2026-09-14 · OR-77) ─────────────────────────────────────
//
// *"haftalık mesai planlaması olsun … cuma bu planlama yapılsın cumartesi onaylansın ve hafta hazır
// olsun herkes bilsin, personel de kendi ekranında bu mesai tablosunu görüp ben şu gün şu saatte gelip
// gitmeliyim diye bilsin."*
//
// Akış: resepsiyon TASLAK hazırlar → onaya gönderir → owner onaylar (plan YAYINA çıkar) ya da sebep
// yazıp geri gönderir. Yayından sonraki değişiklik yine taslaktır ve yeniden onay ister; personel o
// arada yayındaki eski saati görür.
//
// PLAN BİR NİYETTİR, geçiş bir gözlem (#11). İkisi ayrı kalır: plan ile turnikedeki gerçek giriş-çıkış
// yan yana konup karşılaştırılır — ama biri ötekinin yerine yazılmaz.
//
// ONAY OLAYI HAFTANIN BÜTÜN SAATLERİNİ TAŞIR. "O hafta plan neydi, kim geç kaldı" sorusu altı ay sonra
// da cevaplanabilsin: belge değişir, olay değişmez. İsim yok (#6) — yalnızca opak personel kimliği.
export const STAFF_WEEK_PLAN_DRAFT_SAVED = 'staff.week_plan_draft_saved'
export const STAFF_WEEK_PLAN_SUBMITTED = 'staff.week_plan_submitted'
export const STAFF_WEEK_PLAN_APPROVED = 'staff.week_plan_approved'
export const STAFF_WEEK_PLAN_RETURNED = 'staff.week_plan_returned'

export type StaffWeekPlanDraftSavedPayload = {
  /** Haftanın pazartesisi, 'YYYY-MM-DD' (stüdyonun yerel günü). */
  readonly weekStart: string
  readonly staffCount: number
  readonly blockCount: number
}

export type StaffWeekPlanSubmittedPayload = {
  readonly weekStart: string
  readonly staffCount: number
  readonly blockCount: number
  /** Yayındaki plana göre değişen (personel, gün) hücresi. İlk gönderimde her dolu hücre değişmiştir. */
  readonly changedDays: number
}

export type StaffWeekPlanApprovedPayload = {
  readonly weekStart: string
  /** Bu hafta kaçıncı kez yayınlandı. 1 = ilk onay; üstü = hafta içi değişiklik. */
  readonly version: number
  readonly blocks: readonly {
    readonly staffUserId: string
    readonly date: string
    readonly start: string
    readonly end: string
  }[]
}

export type StaffWeekPlanReturnedPayload = {
  readonly weekStart: string
  /** Sebepsiz bir geri gönderme resepsiyona hiçbir şey söylemez (OR-72'deki red kuralıyla aynı). */
  readonly reason: string
}

// ── İZNE RAPOR DOSYASI (owner, 2026-09-14 · OR-77, karar 4) ────────────────────────────────
//
// *"sağlık raporu yükleyebilsin hastaysa."* "Rapor" türündeki bir izne fotoğraf ya da PDF eklenir.
//
// SAĞLIK VERİSİ, KVKK'da özel nitelikli. Bu yüzden:
//   · Dosya özel Storage yolunda; istemci OKUYAMAZ, açılınca 5 dakikalık imzalı link üretilir.
//   · Görebilen yalnızca izin sahibi ve owner. Resepsiyon ve diğer hocalar göremez.
//   · Olayda dosya YOLU yok, içerik yok: yalnızca kimlikler ve sayfa sayısı (#6).
//   · Kaldırmak bir düzeltmedir, sessiz silme değil (#9): sebep zorunlu.
export const STAFF_LEAVE_DOCUMENT_ADDED = 'staff.leave_document_added'
export const STAFF_LEAVE_DOCUMENT_REMOVED = 'staff.leave_document_removed'

export type StaffLeaveDocumentAddedPayload = {
  readonly leaveId: string
  readonly staffUserId: string
  readonly documentId: string
  readonly pageCount: number
}

export type StaffLeaveDocumentRemovedPayload = {
  readonly leaveId: string
  readonly staffUserId: string
  readonly documentId: string
  readonly reason: string
}

// ── ARA DİNLENMESİ (owner, 2026-10-06/07) ───────────────────────────────────────────────────
//
// Mola, vardiyanın İÇİNDEN düşülen süredir: aynı kişi aynı anda hem çalışıyor hem molada olamaz.
// `PRESENT + WORKING` ile `PRESENT + ON_BREAK` iki ayrı durumdur (owner, 2026-10-06).
//
// NEDEN HER MOLA AYRI OLAY: owner planlı molanın parçalı kullanılmasını istedi (15 + 30 + 45 + 30).
// Günlük bir toplam saklamak "hangi molayı ne zaman kullandı" sorusunu sonsuza kadar cevapsız
// bırakırdı — ve plan dışı mola tartışması tam olarak o soruyla çözülür.
//
// PII yok (#6): opak kimlikler ve dakika.
export const STAFF_BREAK_STARTED = 'staff.break_started'
export const STAFF_BREAK_ENDED = 'staff.break_ended'
// Düzeltme SESSİZ DEĞİL (#9): öncesi, sonrası, kim, neden. Personel kendi geçmiş molasını
// değiştiremez; bu olayı yalnızca masa yazar.
export const STAFF_BREAK_CORRECTED = 'staff.break_corrected'

/**
 * Molanın nasıl kaydedildiği. #11'İN GEREĞİ ve pazarlık konusu değil: sonradan girilen bir mola,
 * o an düğmeye basılmış bir mola DEĞİLDİR, ve ikisi sonsuza kadar ayırt edilebilir kalmalı.
 *
 *   `live`        — personel o anda "molaya başla"ya bastı. GÖZLEM.
 *   `retro_entry` — eksik kalan molayı sonradan kendisi beyan etti (cumartesi 23:59'a kadar,
 *                   yalnızca o hafta, yalnızca kendisi). BEYAN — gözlem değil.
 *   `auto_closed` — 23:00'te vardiya kapanırken açık kalan mola kapatıldı. Gözlenmiş bir bitiş yok;
 *                   `system` gözlemediğini gözlemiş gibi yazamaz.
 *
 * Bir kez karıştıktan sonra "bu mola gerçekten o saatte mi tutuldu" sorusu hiç cevaplanamaz.
 */
export type BreakSource = 'live' | 'retro_entry' | 'auto_closed'

export type StaffBreakStartedPayload = {
  readonly staffUserId: string
  readonly shiftId: string
  readonly breakId: string
}

export type StaffBreakEndedPayload = {
  readonly staffUserId: string
  readonly shiftId: string
  readonly breakId: string
  /** Dakika, aşağı yuvarlanmış — 59 saniye bir mola değildir. */
  readonly minutes: number
  readonly source: BreakSource
}

export type StaffBreakCorrectedPayload = {
  readonly breakId: string
  readonly staffUserId: string
  readonly changedFields: readonly string[]
  readonly changes: Readonly<Record<string, { readonly from: unknown; readonly to: unknown }>>
  readonly reason: string
}

// ── HAFTALIK ÇİZELGE VE ISLAK İMZA (owner, 2026-10-07) ──────────────────────────────────────
//
// Owner: *"pazar günü raporunu oluşturuyor çizelgeyi oluşturuyor pazartesi yeni haftaya bunu
// imzalaması bekleniyor yazılı olarak kağıt basılıp ıslak imzalatılacak."*
//
// Çizelge DONMUŞ bir snapshot taşır, çünkü imzalanan şey kâğıttır: yeniden hesaplanan bir çizelge,
// sonradan yapılan bir düzeltmeyle imzalanmış kâğıdın söylediğini sessizce değiştirirdi. Düzeltme
// `version`'ı artırır ve yeni bir kâğıt üretir; eskisi durur.
//
// İmza olayı kâğıdın KENDİSİNİ taşımaz — yalnızca alındığını. Kâğıt sistemin dışındadır.
export const STAFF_TIMESHEET_GENERATED = 'staff.timesheet_generated'
export const STAFF_TIMESHEET_SIGNED = 'staff.timesheet_signed'

export type StaffTimesheetGeneratedPayload = {
  readonly weekStart: string
  readonly staffUserId: string
  readonly version: number
  readonly plannedNetMinutes: number
  readonly actualNetMinutes: number
  readonly actualBreakMinutes: number
  readonly excessBreakMinutes: number
  /** Kaç mola sonradan girildi — kâğıdın güvenilirliği hakkında bir bilgi (#11). */
  readonly retroEntryCount: number
}

export type StaffTimesheetSignedPayload = {
  readonly weekStart: string
  readonly staffUserId: string
  readonly version: number
}