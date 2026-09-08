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
export type EntryRefusalReason = 'no_active_membership'
export type MemberEntryRefusedPayload = {
  readonly branchId: BranchId
  readonly deviceId: string
  readonly reason: EntryRefusalReason
}
export type BranchClosedPayload = {
  readonly occupancyAtClose: number
}
