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
