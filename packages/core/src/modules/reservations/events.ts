import type { EntitlementId, Instant } from '../../shared'
import type { EntitlementStatus } from '../entitlements'
import type { CreditEffect, ReservationStatus } from './domain/types'

// Reservation events (Doc 4 §"Reservation"). No PII (I-13) — the roster's
// memberSnapshot lives on the state document, never here. `hoursBeforeStart` and
// `minutesAfterStart` are frozen because they are the numbers the policy was
// evaluated against; reconstructing them later from a since-rescheduled session is
// exactly the dispute this avoids (Doc 4 §"Reservation").
//
// The `system` actor emits `reservation.auto_resolved`, NEVER `reservation.attended`
// or `.no_show` (I-18, AD-38). That separation is unrecoverable if collapsed.

export const RESERVATION_BOOKED = 'reservation.booked'
export const RESERVATION_CANCELLED = 'reservation.cancelled'
export const RESERVATION_LATE_CANCELLED = 'reservation.late_cancelled'
// ── KREDİYE İNSAN KARAR VERDİ (owner, 2026-09-10) ───────────────────────────────────────────
//
// *"Admin rezervasyon iptal edeceği zaman her zaman sistem sorsun: kredi iade edelim mi yoksa
// etmeyelim mi. Loglara da eklensin."*
//
// Bugüne kadar bu kararı POLİTİKA veriyordu ve sessizce veriyordu: 6 saatten yakın bir iptalde
// `lateCancellationConsumesCredit` true olduğu için kredi yanıyor, kimseye sorulmuyor, hiçbir yerde
// "buna resepsiyon karar verdi" yazmıyordu. Üye ertesi gün "kredim niye eksildi" diye sorduğunda
// cevap verebilecek bir kayıt yoktu.
//
// YENİ BİR OLAY TÜRÜ, alan eklemesi değil: `reservation.late_cancelled` olduğu gibi duruyor, sürüm
// artmıyor, upcaster gerekmiyor. Aynı desen `sale.discount_corrected`ta da kullanıldı.
//
// YALNIZCA politikanın diyeceğinden FARKLI karar verildiğinde yazılıyor. Politikayla aynı karar bir
// müdahale değildir; her iptalde bu olayı yazmak, gerçek müdahaleleri gürültüde kaybederdi.
//
// PII yok (#6): üye kimliği zarfta, sebep serbest metin ama isim yazmak resepsiyonun tercihidir.
export const RESERVATION_CREDIT_DECIDED = 'reservation.credit_decided'
// ── ENGELE RAĞMEN REZERVE ETTİK (owner, 2026-10-02) ─────────────────────────────────────────
//
// *"Üyenin paketinin tarihi bitiyor, biz bitse de inisiyatif kullanıp süre dışındaki bir yere
// rezervasyon yapmak istiyoruz. Paketi yok ya da başka engeli varsa uyarı olarak çıkarsın, yine de
// 'kabul et rezervasyon yap' derse yapsın."*
//
// Bu olayın varlık sebebi, rezervasyonun kendisinin bunu SÖYLEYEMEMESİ. `reservation.booked`
// kurallara uygun bir rezervasyonla, kural esnetilerek yapılmış bir rezervasyonu birbirinden
// ayırt etmez; ikisi de aynı satırdır. Ayırt edilemezse "kendi kuralımızı ayda kaç kez esnetiyoruz,
// ve neden" sorusu sonradan hiç cevaplanamaz — oysa bu sorunun cevabı, kuralın kendisinin doğru
// kurulup kurulmadığını söyleyen tek şey.
//
// `steppedPast` olmadan bu olay "istisna yapıldı" der ve bu tek başına işe yaramaz: asıl bilgi
// HANGİ korumanın aşıldığı. Süresi dolmuş paket ile haftalık hakkın dolması aynı şey değildir.
//
// YENİ BİR OLAY TÜRÜ, alan eklemesi değil — `reservation.credit_decided`teki desen. `booked`
// olduğu gibi duruyor, sürümü artmıyor, upcaster gerekmiyor.
//
// YALNIZCA gerçekten bir koruma aşıldığında yazılıyor. İzin açıkken rezervasyon zaten kurallara
// uygunsa müdahale yok, olay da yok.
//
// PII yok (#6): üye kimliği zarfta; `reason` serbest metin ve oraya ne yazıldığı masanın tercihi.
export const RESERVATION_CREDIT_EXEMPTED = 'reservation.credit_exempted'
export const RESERVATION_ATTENDED = 'reservation.attended'
export const RESERVATION_NO_SHOW = 'reservation.no_show'
export const RESERVATION_AUTO_RESOLVED = 'reservation.auto_resolved'
export const RESERVATION_CORRECTED = 'reservation.corrected'
export const RESERVATION_MOVED = 'reservation.moved'
export const RESERVATION_NOTE_SET = 'reservation.note_set'

export type ReservationBookedPayload = {
  readonly entitlementId: EntitlementId
  readonly creditEffect: CreditEffect
  readonly creditsAvailableAfter: number | null // null ⇔ period entitlement (no hold)
  readonly sessionStartsAt: Instant
  readonly bookedCountAfter: number
}

export type ReservationCancelledPayload = {
  readonly hoursBeforeStart: number
  readonly withinWindow: false | true
  readonly creditEffect: CreditEffect
}

export type ReservationAttendedPayload = {
  readonly source: 'trainer'
  readonly minutesAfterStart: number
  readonly creditEffect: CreditEffect
}

export type ReservationNoShowPayload = {
  readonly source: 'trainer'
  readonly creditEffect: CreditEffect
}

// Both values mean "nobody OBSERVED this member in class" — that is why they share one event type
// and never borrow `reservation.attended` (I-18, AD-38). What separates them is the strength of the
// evidence behind the presumption, and the log has to keep them apart because they are not equally
// good:
//
//   `system_default`  — nothing happened. Nobody cancelled, the grace window passed, and the policy
//                       said what to assume. The weakest inference the system makes.
//   `member_checkin`  — she scanned the studio's QR at the door around her class time. Still an
//                       inference (a door is not a studio floor), but one resting on a recorded,
//                       time-stamped act by the member herself.
//
// Collapse them and the day someone asks "how do we actually know she came?" the answer is gone for
// every reservation ever resolved. Additive: existing events keep `system_default`, no upcaster.
export type ReservationAutoResolvedPayload = {
  readonly outcome: 'attended' | 'no_show'
  readonly source: 'system_default' | 'member_checkin'
  readonly creditEffect: CreditEffect
  readonly creditsAvailableAfter: number | null
}

// D19 (v1.22) — a MOVE is not a cancellation followed by a booking. Saying it that way in the
// log would inflate the cancellation rate, invent a second booking, and make the credit look
// like it moved twice when it never moved at all: the SAME hold, pointed at a different class.
// `overrideReason` is non-null exactly when staff moved a reservation past the free-move window.
export type ReservationMovedPayload = {
  readonly fromSessionId: string
  readonly toSessionId: string
  readonly fromStartsAt: Instant
  readonly toStartsAt: Instant
  readonly hoursBeforeStart: number
  readonly withinWindow: boolean
  readonly overrideReason: string | null
  readonly creditEffect: CreditEffect // always the hold it already had — a move never moves credit
}

export type ReservationCorrectedPayload = {
  readonly from: ReservationStatus
  readonly to: ReservationStatus
  readonly reason: string
  readonly source: 'correction'
}
// The staff quick note (Hızlı Not). Staff-only — never surfaced to the member. Free
// text preserved intact (AI reads it later). EXTENSIBLE: future optional fields are
// additive and won't break v1.
export type ReservationNoteSetPayload = {
  readonly text: string
}

/**
 * Resepsiyon/owner, politikanın vereceği karardan başka bir karar verdi.
 *
 * `policyWouldHave` olmadan bu olay "kredi iade edildi" der ve bu bilgi tek başına işe yaramaz —
 * asıl soru **politikadan sapıldı mı**, ve sapıldıysa neden.
 */
export type ReservationCreditDecidedPayload = {
  readonly decision: 'refund' | 'consume'
  readonly policyWouldHave: 'refund' | 'consume'
  readonly hoursBeforeStart: number
  readonly reason: string
}

/**
 * Hangi korumalar inisiyatifle aşılabilir.
 *
 * ── GENİŞLETİLDİ (owner, 2026-10-04) ──────────────────────────────────────────────────────
 *
 * *"Bu tür şeylerde adminin dediğini her türlü yap, logla sadece — bu esnekliğimizi azaltıyor."*
 *
 * İlk hâlinde liste yalnızca "stüdyonun kendi koyduğu kurallar"ı kapsıyordu; kontenjan, kategori
 * duvarı ve hizmet kapsamı "kural değil fizik" diye dışarıda bırakılmıştı. Owner bunu geri aldı ve
 * gerekçesi doğru: odadaki aleti, odayı ve paketi bilen kişi masadaki insan, ve her reddin bedeli
 * onun telefonla çözmek zorunda kaldığı bir iş. Sistem bu kararın YERİNE geçmiyor; KAYDINI tutuyor.
 *
 * Listede hâlâ OLMAYAN iki şey var ve ikisi de "esneklik" değil kayıt hatası olurdu:
 *   · `already_booked` — aynı kişiyi aynı derse iki kez yazmak. Yoklamada iki satır, iki kredi
 *     tutması; esnetilen bir kural değil, çift kayıt.
 *   · geçmiş ders (`session_not_bookable` / `session_too_old`) — onun KENDİ kapısı var
 *     (backdating, 30 gün, OR-24) ve o kapı krediyi doğru tarihten harcıyor.
 * `session_not_assigned_to_member` de dışarıda: o, adı yazılı başka bir üyenin özel dersi.
 */
export type ExemptableGuard =
  | 'entitlement_not_active'
  | 'entitlement_expires_before_session'
  | 'insufficient_credits'
  | 'class_full'
  | 'category_mismatch'
  | 'service_not_covered'
  | 'day_not_allowed'
  | 'time_not_allowed'
  | 'trainer_not_allowed'
  | 'daily_reservation_limit_reached'
  | 'active_reservation_limit_reached'
  | 'weekly_quota_reached'

/**
 * Masa bir korumayı bilerek aştı ve rezervasyonu yine yaptı (owner, 2026-10-02).
 *
 * `creditEffect` burada kritik ve iki değer alır, ikisi de owner'ın kuralı:
 *   `'held'` — alınacak bir hak vardı, alındı (*"kredisi varsa düşsün her zaman"*).
 *   `'none'` — alınacak hak yoktu, deftere DOKUNULMADI (*"kredisi 0 ise eksiye gitmesin"*).
 */
export type ReservationCreditExemptedPayload = {
  readonly steppedPast: ExemptableGuard
  readonly creditEffect: CreditEffect
  readonly creditsAvailable: number | null // istisna ANINDAKİ bakiye; null ⇔ süreli paket
  readonly entitlementStatus: EntitlementStatus
  readonly reason: string
}
