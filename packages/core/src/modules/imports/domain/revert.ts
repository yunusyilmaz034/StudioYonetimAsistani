import type { MemberId } from '../../../shared'
import type { ImportBatch } from './types'

// UNDOING AN IMPORT (owner, 2026-07-30).
//
// *"Bir yanlışlık olmuş olabilir… en son importu iptal et, sistemi önceki haline getir."*
//
// ── What "önceki hale getir" can and cannot mean here ───────────────────────────────────────
//
// It cannot mean deleting the events. An event is never deleted; the ledger's whole credibility
// rests on that, and an exception carved for imports is an exception that gets cited later.
//
// It also cannot mean restoring a Firestore backup. That rolls the WHOLE database back to a moment
// — every reservation booked, every member checked in, every payment taken since the import would
// go with it. Fixing a bad import by erasing three hours of a live studio's real work is a bigger
// accident than the one being fixed.
//
// So a reversal is what every other correction in this system is: **compensating events, scoped to
// the batch** (#9). Members it created are deactivated, packages it created are cancelled, both with
// `reason: 'migration'`, and the batch is marked `reverted`. The log grows. Six months later "where
// did this member come from and what happened to her?" still has an answer, which is exactly what a
// deletion would have destroyed.
//
// ── The line that makes it safe ─────────────────────────────────────────────────────────────
//
// A batch may be reverted only while it is still INERT — nothing has happened to anything it
// created. Once a member it imported has booked, walked through the door, or paid, the record is no
// longer "a bad import": it is a record with real events on top of it, and quietly cancelling it
// would strand those events against a member who officially never joined.
//
// So the check refuses and NAMES what blocks it. The operator can still fix things one by one, with
// intent, seeing each case — which is the right amount of friction for undoing something that has
// already had consequences.

/** What happened to one imported member since the import. Every field is "since `appliedAt`". */
export interface MemberActivity {
  readonly memberId: MemberId
  readonly fullName: string
  readonly reservations: number
  readonly checkIns: number
  readonly payments: number
  /** Packages this member holds that the batch did NOT create — sold at the desk afterwards. */
  readonly otherEntitlements: number
}

/** What happened to one imported package since the import. */
export interface EntitlementActivity {
  readonly entitlementId: string
  readonly memberName: string
  /** Credits held or consumed. A package that has paid for a class is a package that was used. */
  readonly creditsUsed: number
  readonly frozen: boolean
}

export type RevertBlocker = {
  readonly subject: string
  readonly because: string
}

export type RevertVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'already_reverted' }
  | { readonly ok: false; readonly code: 'batch_touched'; readonly blockers: readonly RevertBlocker[] }

/**
 * May this batch be undone?
 *
 * Pure: the caller gathers the activity, this decides. Every blocker is reported, not just the first
 * — an operator who fixes one and is then told about the next has been made to discover the problem
 * in instalments.
 */
export function decideRevert(
  batch: ImportBatch,
  members: readonly MemberActivity[],
  entitlements: readonly EntitlementActivity[],
): RevertVerdict {
  if (batch.status === 'reverted') return { ok: false, code: 'already_reverted' }

  const blockers: RevertBlocker[] = []

  for (const m of members) {
    const why: string[] = []
    if (m.reservations > 0) why.push(`${m.reservations} rezervasyon`)
    if (m.checkIns > 0) why.push(`${m.checkIns} giriş`)
    if (m.payments > 0) why.push(`${m.payments} ödeme`)
    if (m.otherEntitlements > 0) why.push(`${m.otherEntitlements} sonradan satılan paket`)
    if (why.length > 0) blockers.push({ subject: m.fullName, because: why.join(' · ') })
  }

  for (const e of entitlements) {
    const why: string[] = []
    if (e.creditsUsed > 0) why.push(`${e.creditsUsed} ders kullanılmış`)
    if (e.frozen) why.push('paket dondurulmuş')
    if (why.length > 0) blockers.push({ subject: e.memberName, because: why.join(' · ') })
  }

  return blockers.length === 0 ? { ok: true } : { ok: false, code: 'batch_touched', blockers }
}
