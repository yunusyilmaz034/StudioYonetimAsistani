import { Timestamp, type Firestore } from 'firebase-admin/firestore'

import { DEFAULT_STUDIO_CONFIG, instant, localDateAt, type StudioId } from '../../../shared'

// THE FIVE SIGNALS (Doc 6 §9) — moved out of the scheduled function in v1.27 S7, so that the
// nightly job and the owner's screen run **the same checks**.
//
// They were written for a pager. That was right and it is not enough: a signal that only ever
// reaches Cloud Logging is a signal the studio owner cannot see, and she is the person who has to
// decide whether to trust today's numbers. Two implementations of "is this studio healthy?" are two
// answers, and the day they drift is the day the screen says all-clear about a studio the alarm is
// already shouting about.
//
// ── The rule that governs every check below ──────────────────────────────────────────────────
//   THE DRIFT CHECK REPORTS. IT NEVER REPAIRS.
// A self-healing system hides its bugs, and the bug is the thing you need to know about. If
// `credits.available` disagrees with its six counters, a write path bypassed a transaction — and
// quietly rewriting the field would destroy the only evidence that it did.
//
// `alert` is the alarm's contract: the log-based alert matches on it, the runbook has an entry for
// every value it can take, and the screen looks its Turkish sentence up by it. One vocabulary.

const MS_PER_MIN = 60_000

export type HealthAlert =
  | 'commands_stuck'
  | 'projection_lag'
  | 'booked_count_drift'
  | 'credit_ledger_drift'
  | 'expiring_with_held'

export interface HealthFinding {
  readonly alert: HealthAlert
  /**
   * How bad it is *right now*.
   *
   * `critical` — the studio is losing data or judging capacity on a wrong number.
   * `warning`  — something is behind, and a decision made on it would be made on stale facts.
   */
  readonly severity: 'critical' | 'warning'
  readonly count: number
  /** Ids, never payloads. A finding is not a place to reconstruct a member's day. */
  readonly ids: readonly string[]
  /** The one extra number the runbook entry asks for (lag in minutes, drift amounts, …). */
  readonly detail: string | null
}

export interface HealthReport {
  readonly studioId: StudioId
  readonly checkedAt: number
  readonly findings: readonly HealthFinding[]
}

const col = (db: Firestore, studioId: StudioId, name: string) =>
  db.collection('studios').doc(studioId).collection(name)

/**
 * SIGNAL 1 — a command stuck in `pending`.
 *
 * The trigger died. Check-ins vanish. Reception notices NOTHING: the UI is optimistic, so the screen
 * said "girdi" and the write never landed. This is the single most dangerous silence in the system.
 */
async function stuckCommands(db: Firestore, studioId: StudioId, now: number): Promise<HealthFinding | null> {
  const stuck = await col(db, studioId, 'commands')
    .where('status', '==', 'pending')
    .where('occurredAt', '<', Timestamp.fromMillis(now - 5 * MS_PER_MIN))
    .limit(50)
    .get()

  if (stuck.empty) return null
  return {
    alert: 'commands_stuck',
    severity: 'critical',
    count: stuck.size,
    ids: stuck.docs.slice(0, 10).map((d) => d.id),
    detail: null,
  }
}

/**
 * SIGNAL 2 — the projection is behind.
 *
 * The dashboard is stale and renders it with total confidence. There is no error state for "these
 * numbers are from an hour ago"; the owner simply reads yesterday's studio and makes today's
 * decision with it.
 */
async function projectionLag(db: Firestore, studioId: StudioId): Promise<HealthFinding | null> {
  const events = await col(db, studioId, 'events').orderBy('recordedAt', 'desc').limit(1).get()
  const doc = events.docs[0]?.data()
  const recorded = doc?.recordedAt
  const occurred = doc?.occurredAt
  if (!(recorded instanceof Timestamp) || !(occurred instanceof Timestamp)) return null // no events yet

  // Read the watermark off the newest event's OWN day — not "today". The projector folds each event
  // into `days/${localDate(occurredAt)}` (never a global doc), so that is the day whose watermark this
  // event advanced. Reading "today" instead was wrong twice: for eight hours after every midnight, a
  // quiet studio has no document for the new day yet, so the watermark read as 0 and the lag as ~56
  // years — a false alarm every 15 minutes until the day's first booking. And "today" was computed in
  // UTC while the projector keys by STUDIO-LOCAL day, so the two disagreed either side of local
  // midnight. Both vanish when we ask the same question the projector answered: which day did THIS
  // event land on, and did its watermark catch up? (Found in production, 2026-07-15.)
  const eventDay = localDateAt(instant(occurred.toMillis()), DEFAULT_STUDIO_CONFIG.utcOffsetMinutes)
  const daily = await db.doc(`studios/${studioId}/readModels/daily/days/${eventDay}`).get()
  const watermark = (daily.data()?.lastEventAt as number | undefined) ?? 0
  const lagMs = recorded.toMillis() - watermark
  if (lagMs <= 60 * MS_PER_MIN) return null

  return {
    alert: 'projection_lag',
    severity: 'warning',
    count: 1,
    ids: [],
    // The remedy is never a hand-edit: `pnpm projections:rebuild` replays the log. The projection is
    // disposable precisely so that this is a boring incident.
    detail: `${Math.round(lagMs / MS_PER_MIN)} dakika geride`,
  }
}

/**
 * SIGNAL 3 — `bookedCount` disagrees with the reservations that exist.
 *
 * The denormalised counter is what capacity is judged against. If it drifts high, a class silently
 * refuses members it has room for; if it drifts low, it oversells. Neither shows up as an error.
 */
async function bookedCountDrift(db: Firestore, studioId: StudioId, now: number): Promise<HealthFinding | null> {
  // Only sessions that can still be booked: a past session's counter is history, and history that
  // drifted cannot be fixed by knowing about it now.
  const sessions = await col(db, studioId, 'classSessions')
    .where('startsAt', '>=', Timestamp.fromMillis(now))
    .limit(200)
    .get()

  const drifted: string[] = []
  for (const session of sessions.docs) {
    const booked = await col(db, studioId, 'reservations')
      .where('classSessionId', '==', session.id)
      .where('status', '==', 'booked')
      .count()
      .get()
    const recorded = (session.data().bookedCount as number | undefined) ?? 0
    if (recorded !== booked.data().count) drifted.push(session.id)
  }

  if (drifted.length === 0) return null
  return {
    alert: 'booked_count_drift',
    severity: 'critical',
    count: drifted.length,
    ids: drifted.slice(0, 10),
    detail: null,
  }
}

/**
 * SIGNAL 4 — `credits.available` disagrees with its six counters (DEBT-004).
 *
 * A drift is not a data problem to be corrected. **It means a write path bypassed the transaction,
 * and that is a bug.** Repairing the number would erase the only evidence of it.
 */
async function creditLedgerDrift(db: Firestore, studioId: StudioId): Promise<HealthFinding | null> {
  const entitlements = await col(db, studioId, 'entitlements')
    .where('status', '==', 'active')
    .limit(500)
    .get()

  const drifted: string[] = []
  for (const doc of entitlements.docs) {
    const c = doc.data().credits as Record<string, number> | null | undefined
    if (!c) continue // a period package holds no credit ledger

    const derived =
      (c.granted ?? 0) +
      (c.restored ?? 0) -
      (c.consumed ?? 0) -
      (c.held ?? 0) -
      (c.revoked ?? 0) -
      (c.expired ?? 0)
    if ((c.available ?? 0) !== derived) drifted.push(doc.id)
  }

  if (drifted.length === 0) return null
  return {
    alert: 'credit_ledger_drift',
    severity: 'critical',
    count: drifted.length,
    ids: drifted.slice(0, 10),
    detail: null,
  }
}

/**
 * SIGNAL 5 — an entitlement at its `validUntil` still holding a credit (I-19).
 *
 * The domain already refuses to expire such a row; this check exists to make the refusal VISIBLE. A
 * row that reaches its expiry still holding a credit means the auto-resolution sweep did not settle
 * it, and that is the thing to look at.
 */
async function expiringWithHeld(db: Firestore, studioId: StudioId, now: number): Promise<HealthFinding | null> {
  const expiring = await col(db, studioId, 'entitlements')
    .where('status', '==', 'active')
    .where('validUntil', '<=', Timestamp.fromMillis(now + 24 * 60 * MS_PER_MIN))
    .limit(200)
    .get()

  const held = expiring.docs.filter((d) => {
    const c = d.data().credits as Record<string, number> | null | undefined
    return (c?.held ?? 0) > 0
  })

  if (held.length === 0) return null
  return {
    alert: 'expiring_with_held',
    severity: 'warning',
    count: held.length,
    ids: held.slice(0, 10).map((d) => d.id),
    detail: null,
  }
}

/** The two cheap checks. Run every fifteen minutes by the alarm; run on every load of the screen. */
export async function runFastChecks(
  db: Firestore,
  studioId: StudioId,
  now: number,
): Promise<readonly HealthFinding[]> {
  const found = await Promise.all([stuckCommands(db, studioId, now), projectionLag(db, studioId)])
  return found.filter((f): f is HealthFinding => f !== null)
}

/** The three expensive ones — they scan. Nightly for the alarm; on demand from the screen. */
export async function runDeepChecks(
  db: Firestore,
  studioId: StudioId,
  now: number,
): Promise<readonly HealthFinding[]> {
  const found = [
    await bookedCountDrift(db, studioId, now),
    await creditLedgerDrift(db, studioId),
    await expiringWithHeld(db, studioId, now),
  ]
  return found.filter((f): f is HealthFinding => f !== null)
}

/**
 * Every studio in the database. One today; the checks must not assume it.
 *
 * `listDocuments()`, not `get()`. In Firestore a document that holds only sub-collections is a
 * *missing* document — it has children but no fields — and a health check that quietly skipped such
 * a studio would be the exact failure this file exists to abolish: a monitor reporting all-clear on
 * a studio it never looked at.
 */
export async function allStudioIds(db: Firestore): Promise<StudioId[]> {
  const refs = await db.collection('studios').listDocuments()
  return refs.map((ref) => ref.id as StudioId)
}
