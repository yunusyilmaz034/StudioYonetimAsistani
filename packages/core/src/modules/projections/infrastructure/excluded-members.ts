import type { Firestore } from 'firebase-admin/firestore'

import type { StudioId } from '../../../shared'

// WHICH ACCOUNTS THE READ MODEL IGNORES (owner, 2026-07-29).
//
// The studio's own people tried the system out on live accounts. Their sales, payments, reversals
// and attendance are real events and stay in the log for ever; they simply stop being COUNTED.
//
// This lives in Firestore rather than in source for two reasons. Member ids belong to one tenant
// and have no place in shared code. And the live projector and `pnpm projections:rebuild` must
// reach the same answer — one list, one document, read by both. `pnpm projections:verify` recomputes
// the log and diffs it against the stored model, so a drift between the two shows up as a failure
// rather than as a number nobody can explain.
//
// Absent document ⇒ empty set ⇒ everything counts. A studio that never needed this pays nothing,
// and a read failure must never silently start hiding revenue.
export async function loadExcludedMemberIds(db: Firestore, studioId: StudioId): Promise<ReadonlySet<string>> {
  const snap = await db.doc(`studios/${studioId}/settings/projection`).get()
  const raw = snap.exists ? (snap.data()?.excludedMemberIds as unknown) : null
  return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.length > 0) : [])
}

// WHEN AN OLD VOID'S PAYMENT HAD BEEN RECEIVED (owner, 2026-10-08 · OR-120).
//
// `payment.voided` carries `receivedAt` from that date on. Voids written earlier do not, and an event
// is never rewritten — so their day is kept here, in the same document and for the same two reasons
// as the list above: it is one tenant's data, and the rebuild and the verifier must read one answer.
//
// The live trigger does NOT read this: every void it will ever see carries the field itself.
export async function loadVoidReceivedAt(db: Firestore, studioId: StudioId): Promise<ReadonlyMap<string, number>> {
  const snap = await db.doc(`studios/${studioId}/settings/projection`).get()
  const raw = snap.exists ? (snap.data()?.voidReceivedAt as unknown) : null
  if (!raw || typeof raw !== 'object') return new Map()
  return new Map(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'))
}

// WHEN AN OLD CANCELLED SALE HAD BEEN SOLD (owner, 2026-10-12 · OR-122). The same table, for the same
// reasons, as the one above: `sale.cancelled` carries `soldAt` from that date on, earlier ones do not,
// and an event is never rewritten. Sale id → the sale's own `soldAt`.
//
// The live trigger does NOT read this: every cancellation it will ever see carries the field itself.
export async function loadSaleSoldAt(db: Firestore, studioId: StudioId): Promise<ReadonlyMap<string, number>> {
  const snap = await db.doc(`studios/${studioId}/settings/projection`).get()
  const raw = snap.exists ? (snap.data()?.saleSoldAt as unknown) : null
  if (!raw || typeof raw !== 'object') return new Map()
  return new Map(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'))
}

// WHEN AN OLD PAYMENT'S MONEY ARRIVED (owner, 2026-10-14). The same table again: `payment.received`
// carries `receivedAt` from that date on, earlier ones do not. Payment id → the payment's `receivedAt`.
// Only payments ENTERED on a later day than they arrived need a row; a same-day one reads the same.
//
// The live trigger does NOT read this: every payment it will ever see carries the field itself.
export async function loadPaymentReceivedAt(db: Firestore, studioId: StudioId): Promise<ReadonlyMap<string, number>> {
  const snap = await db.doc(`studios/${studioId}/settings/projection`).get()
  const raw = snap.exists ? (snap.data()?.paymentReceivedAt as unknown) : null
  if (!raw || typeof raw !== 'object') return new Map()
  return new Map(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'))
}
