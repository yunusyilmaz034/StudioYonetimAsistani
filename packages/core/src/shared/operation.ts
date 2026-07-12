import { newCorrelationId, type CorrelationId } from './ids'

// ⭐ THE OPERATION ID (OP-2, owner, 2026-07-13).
//
// Every operation — a single booking or a studio-wide closure — carries ONE id, and every event
// it produces is stamped with it. The Activity Center (v1.25) reads that id to answer the only
// question that matters when something looks wrong: *what else did this act do?*
//
// **It is the `correlationId`.** Deliberately not a second field on the envelope:
//   • the envelope already binds an act to all of its events — that IS an operation id;
//   • a second id is a permanent, unrecoverable schema change (Doc 4, AD-42);
//   • two ids that mean the same thing drift, and then neither can be trusted.
// So the type below is an alias, not a new concept. `OperationId` is what we CALL it in the
// product; `correlationId` is where it LIVES in the log.
export type OperationId = CorrelationId

export const newOperationId = (): OperationId => newCorrelationId()

// ── OP-4 — undo, marked in the model before it is built ─────────────────────────────────────
//
// Undo ships in v1.28. The model must already know which events can be undone, and HOW, because
// the answer is a property of the event — not of the screen that will eventually offer a button.
//
//   'compensating'  — undone by appending an inverse event (#9: corrections are never
//                     overwrites). Released credits can be re-held, an extension can be
//                     shortened, a cancelled session can be re-opened.
//   'irreversible'  — the world moved and cannot be moved back by us: a member walked through
//                     the door, a class was actually taught, money left the till. The record
//                     stands; only a CORRECTION event can restate it.
//   'informational' — the event records a fact about our own records (a day was marked, a plan
//                     was written). Undo = remove the mark; nothing in the world reverses.
export type UndoPolicy = 'compensating' | 'irreversible' | 'informational'

// The registry is CODE, not data: nothing is written to historical events, so it can be
// corrected at any time without a migration — and being exhaustive over the event catalogue,
// a new event type that forgets to declare its policy is a build failure, not a silent 'undefined'.
export const UNDO_POLICY: Readonly<Record<string, UndoPolicy>> = {
  // reservations
  'reservation.booked': 'compensating',
  'reservation.cancelled': 'compensating',
  'reservation.moved': 'compensating',
  'reservation.attended': 'compensating', // → reservation.corrected
  'reservation.no_show': 'compensating',
  'reservation.corrected': 'compensating',
  'reservation.auto_resolved': 'compensating',
  'waitlist.joined': 'compensating',
  'waitlist.left': 'compensating',
  'waitlist.promoted': 'compensating',

  // entitlements — the credit ledger is append-only arithmetic; every move has an inverse
  'entitlement.granted': 'compensating',
  'entitlement.credit_held': 'compensating',
  'entitlement.credit_released': 'compensating',
  'entitlement.credit_consumed': 'compensating',
  'entitlement.adjusted': 'compensating',
  'entitlement.extended': 'compensating',
  'entitlement.frozen': 'compensating',
  'entitlement.unfrozen': 'compensating',
  'entitlement.expired': 'compensating',

  // scheduling
  'class_session.scheduled': 'compensating',
  'class_session.updated': 'compensating',
  'class_session.cancelled': 'compensating',

  // operations (v1.22)
  'studio_closure.planned': 'informational',
  'studio_closure.applied': 'compensating', // the inverse is a real operation, not a delete
  'studio_closure.cancelled': 'informational',
  'bulk_operation.planned': 'informational',
  'bulk_operation.applied': 'compensating',
  'studio_calendar.day_marked': 'informational',
  'studio_calendar.day_updated': 'informational',
  'studio_calendar.day_removed': 'informational',
  'studio_calendar.imported': 'informational',

  // the world moved — we cannot move it back
  'member.checked_in': 'irreversible',
  'payment.received': 'irreversible',
}

// Unknown → irreversible. The safe default: an event nobody classified must not offer a button
// that claims to undo it.
export const undoPolicyOf = (eventType: string): UndoPolicy =>
  UNDO_POLICY[eventType] ?? 'irreversible'

export const isUndoable = (eventType: string): boolean => undoPolicyOf(eventType) !== 'irreversible'
