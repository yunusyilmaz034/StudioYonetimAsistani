import type { BranchId } from '../../shared'
import type { CheckInMethod } from './domain/types'

// Check-in / occupancy events (Doc 4 §"Check-in"). The producer never appears in the
// type (AD-18): a reception tap, a QR scan, and a 2027 turnstile all emit
// `member.checked_in` — `method` is metadata, `actor` is who is responsible. No PII
// (I-13). All five types already exist in the Doc 4 catalogue; v1.15 produces them.

export const MEMBER_CHECKED_IN = 'member.checked_in'
export const MEMBER_CHECKED_OUT = 'member.checked_out'
export const MEMBER_AUTO_CHECKED_OUT = 'member.auto_checked_out'
export const BRANCH_OPENED = 'branch.opened'
export const BRANCH_CLOSED = 'branch.closed'
// v1.33 — reception opened the arm by hand: a guest, a Multisport visitor, a dead phone. Deliberately
// NOT a check-in (nobody is identified, so nobody enters occupancy), but never silent either — an
// arm that opens with no record is an arm anybody can open.
export const TURNSTILE_OPENED_MANUALLY = 'turnstile.opened_manually'
// OR-79 (owner, 2026-09-14): kol dönmedi, üye 45 sn içinde aynı kapıyı tekrar okuttu — kol BİR KEZ daha açıldı. Yeni
// bir giriş/çıkış değil: doluluk, yoklama ve paket hakkı etkilenmez. Kayıt, arkadaşını ikinci açılışla sokma riskinin
// görünür kalması için. Üretici adda yok: bu kapının kendisi hakkında bir olgu, kolu kimin döndürdüğü değil.
export const TURNSTILE_REOPENED = 'turnstile.reopened'
// ── KAPIDA KALDI (owner, 2026-09-08) ────────────────────────────────────────────────────────
//
// Paketi bitmiş üye turnikede okuttu, kol dönmedi. Bugüne kadar bu OLAY DEĞİLDİ: `crossTurnstile`
// hiçbir şey yazmadan `err` dönüyordu, ekrana gidecek geçici bir kayıt bırakılıyor ve o kayıt
// ekran okur okumaz siliniyordu. Yani ret ~600 ms yaşıyor, sonra yok oluyordu.
//
// Kaydedilmemesi geri alınamaz bir kayıp: bugün yazılmayan ret, yarın rapor yazılsa da yok.
// Ve kapıda kalan üye stüdyodaki en sıcak müşteri adayı — paketi bitmiş ama ÇALIŞMAYA GELMİŞ.
//
// Üretici adda yok (#2): kapı reddetti, kimin kapısı olduğu zarftaki aktörde. PII yok (#6):
// üye kimliği `subject`te, isim hiçbir yerde. Ve bu bir GÖZLEM, varsayım değil (#11) — üye
// gerçekten okuttu ve kol gerçekten dönmedi.
export const MEMBER_ENTRY_REFUSED = 'member.entry_refused'
// ── KAYDI OLMAYAN ÇIKIŞ, ve KAPANMAMIŞ ZİYARET (owner, 2026-09-14 · OR-75) ─────────────────────
//
// *"qr ile giriş yapmayan biri yandan geçmiş olabilir, o an enerji kesik olabilir ama çıkış yapmak
// istediğinde çıkış yapamıyor."* Çıkış ekranı "içeride görünmüyor" diye kolu çevirmiyordu: bir kayıt
// uyuşmazlığı yüzünden birini içeride tutmak. Çıkış asla engellenmez (OR-53) — kol artık dönüyor.
//
// Ama görülmemiş bir girişi YAZMAK yok (#11): kimse onun girdiğini görmedi. Bu yüzden iki ayrı olay:
//   · `member.exited_without_entry` — çıkışı GÖRÜLDÜ, girişi hiç kaydedilmemişti. Doluluk oynamaz,
//     çünkü onu hiç saymamıştık.
//   · `member.exit_unobserved` — açık bir ziyareti varken giriş ekranını okuttu; demek ki bir ara
//     çıkmış ve görülmemiş. Eski ziyaret kapanır, SÜRE YAZILMAZ (çıkış anı bilinmiyor), ardından
//     olağan `member.checked_in` gelir.
// İkisi de kapıdaki bir kaçağın izi: owner kaç kez yandan geçildiğini buradan görür.
export const MEMBER_EXITED_WITHOUT_ENTRY = 'member.exited_without_entry'
export const MEMBER_EXIT_UNOBSERVED = 'member.exit_unobserved'
// ── KAPI CİHAZLARI (owner onayı, 2026-09-11 — ikinci stüdyo hazırlığı) ──────────────────────
//
// İlk iki cihaz ELLE oluşturulmuştu: panelde cihaz ekleme ekranı yoktu, sır `secrets.h`e yazılıp
// flash'lanıyordu. Yani her yeni kapı bir Mac, bir yazılımcı ve bir gece demekti — ve ikinci
// stüdyoya bu şekilde gidilmez.
//
// Cihazın kaydı bir DURUM DEĞİŞİKLİĞİDİR ve olay yazar (#1). Sebebi teorik değil: bir kapı
// anahtarı üretmek, iptal etmek ya da döndürmek, sonradan "bunu kim ne zaman yaptı" diye
// sorulacak şeylerdir. Sır olayda YOK — yalnızca özeti veritabanında, o da hash olarak.
//
// Üretici adda yok (#2): kapıyı panelden owner da kaydetse bir kurulum betiği de kaydetse olan şey
// aynı — bir cihaz kaydedildi. Kimin kaydettiği zarftaki aktörde.
export const DEVICE_REGISTERED = 'device.registered'
export const DEVICE_SECRET_ROTATED = 'device.secret_rotated'
export const DEVICE_DEACTIVATED = 'device.deactivated'
export const DEVICE_REACTIVATED = 'device.reactivated'
// Uzaktan yeniden başlatma (2026-09-14, firmware v1.4): kutu takıldığında elektrik kesmeden. Kim, neden — kayıtta.
export const DEVICE_RESTART_REQUESTED = 'device.restart_requested'

export type MemberCheckedInPayload = {
  readonly branchId: BranchId
  readonly method: CheckInMethod
  readonly occupancyAfter: number
}
export type MemberCheckedOutPayload = {
  readonly branchId: BranchId
  readonly method: CheckInMethod
  readonly durationMinutes: number
  readonly occupancyAfter: number
}
export type MemberAutoCheckedOutPayload = {
  readonly branchId: BranchId
  readonly thresholdHours: number
}
export type BranchOpenedPayload = {
  readonly scheduledOpenAt: number
}
export type TurnstileOpenedManuallyPayload = {
  readonly deviceId: string
  readonly reason: string
}
/** `reason` kapalı enum: kapının hayır deme sebepleri sayılabilir olmalı, serbest metin değil. */
// OR-78 (2026-09-14): paketi olsa bile HAK kalmamışsa kapı hayır der — dersler bitti ya da fitness giriş hakkı bitti.
// Genişletme ek bir değer: eski olayların hepsi 'no_active_membership' ve anlamları değişmiyor.
export type EntryRefusalReason = 'no_active_membership' | 'no_credits_left' | 'no_entries_left'
export type MemberEntryRefusedPayload = {
  readonly branchId: BranchId
  readonly deviceId: string
  readonly reason: EntryRefusalReason
}
export type BranchClosedPayload = {
  readonly occupancyAtClose: number
}
/** `occupancyAfter` çıkıştan ÖNCEKİYLE aynı: hiç sayılmamış biri sayımdan düşülmez. */
export type MemberExitedWithoutEntryPayload = {
  readonly branchId: BranchId
  readonly method: CheckInMethod
  readonly occupancyAfter: number
}
/** `checkedInAt` kapanan ziyaretin başladığı an. Çıkış anı bilinmiyor, o yüzden süre YOK. */
export type MemberExitUnobservedPayload = {
  readonly branchId: BranchId
  readonly checkedInAt: number
  readonly occupancyAfter: number
}

/** Sır YOK, hash bile yok: bir olay kaydı, anahtarın kendisini taşımaz. */
export type DeviceRegisteredPayload = {
  readonly deviceId: string
  readonly name: string
  readonly side: 'in' | 'out' | null
}
export type DeviceSecretRotatedPayload = {
  readonly deviceId: string
  /** Neden döndürüldü — kaybolan bir kutu ile rutin bir yenileme aynı şey değildir. */
  readonly reason: string
}
export type DeviceActivationPayload = {
  readonly deviceId: string
  readonly name: string
}

/** OR-79. `secondsSinceCrossing`: ilk (kaydedilmiş) geçişten kaç sn sonra tekrar okutuldu. */
export type TurnstileReopenedPayload = {
  readonly deviceId: string
  readonly direction: 'in' | 'out'
  readonly secondsSinceCrossing: number
}

export type DeviceRestartRequestedPayload = {
  readonly deviceId: string
  /** Neden yeniden başlatıldı — "kol dönmüyor" ile "rutin" aynı şey değil; arızanın izi burada. */
  readonly reason: string
}
