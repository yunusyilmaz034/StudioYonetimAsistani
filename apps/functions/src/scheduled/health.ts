import {
  FirestoreProjectionRepository,
  type StudioId,
  type SystemJobId,
  type TenantContext,
} from '@studio/core'
import { Timestamp } from 'firebase-admin/firestore'
import * as logger from 'firebase-functions/logger'

import { systemTenantContext } from '../shared/context'
import { db } from '../shared/firebase'

// The five signals (Doc 6 §9), and the reason they are worth a scheduled function at all:
// **each of them fails SILENTLY.** Nothing crashes, nobody is told, and the product carries on
// looking exactly as correct as it did yesterday. A studio would discover the first of them when a
// member says "I checked in and it never counted", weeks later — which is to say, never usefully.
//
// ── The rule that governs every check below ──────────────────────────────────────────────────
//   THE DRIFT CHECK REPORTS. IT NEVER REPAIRS.
// A self-healing system hides its bugs, and the bug is the thing you need to know about. If
// `credits.available` disagrees with its six counters, a write path bypassed a transaction — and
// quietly rewriting the field would destroy the only evidence that it did.
//
// Each finding is logged at ERROR with a stable `alert` field. That field is the alarm's contract:
// a Cloud Logging log-based alert matches on it, and the runbook has an entry for every value it
// can take. An alert with no runbook entry is a pager that teaches nobody anything.

const MS_PER_MIN = 60_000

/**
 * Every studio in the database. One today; the checks must not assume it.
 *
 * `listDocuments()`, not `get()`. In Firestore a document that holds only sub-collections is a
 * *missing* document: it has children but no fields, and `get()` does not return it. A health check
 * that quietly skipped such a studio would be the exact failure mode this file exists to abolish —
 * a monitor reporting all-clear on a studio it never looked at.
 */
async function studioIds(): Promise<StudioId[]> {
  const refs = await db().collection('studios').listDocuments()
  return refs.map((ref) => ref.id as StudioId)
}

// The `system` actor, like every other sweep in this folder — never a borrowed human identity (#5).
const systemCtx = (studioId: StudioId): TenantContext =>
  systemTenantContext(studioId, 'health_check' as SystemJobId)

// ── FAST (every 15 minutes) ─────────────────────────────────────────────────────────────────

/**
 * SIGNAL 1 — a command stuck in `pending`.
 *
 * The trigger died. Check-ins vanish. Reception notices NOTHING: the UI is optimistic, so the
 * screen said "girdi" and the write never landed. This is the single most dangerous silence in
 * the system, and it is why the offline path gets a five-minute alarm rather than a nightly one.
 */
async function checkStuckCommands(studioId: StudioId, now: number): Promise<number> {
  const cutoff = Timestamp.fromMillis(now - 5 * MS_PER_MIN)
  const stuck = await db()
    .collection('studios')
    .doc(studioId)
    .collection('commands')
    .where('status', '==', 'pending')
    .where('occurredAt', '<', cutoff)
    .limit(50)
    .get()

  if (!stuck.empty) {
    logger.error('health: commands stuck in pending', {
      alert: 'commands_stuck',
      studioId,
      count: stuck.size,
      // Ids, never payloads. A log line is not a place to reconstruct a member's day.
      commandIds: stuck.docs.slice(0, 10).map((d) => d.id),
    })
  }
  return stuck.size
}

/**
 * SIGNAL 2 — the projection is behind.
 *
 * The dashboard is stale and renders it with total confidence. There is no error state for "these
 * numbers are from an hour ago"; the owner simply reads yesterday's studio and makes today's
 * decision with it.
 */
async function checkProjectionLag(studioId: StudioId, now: number): Promise<number> {
  const ctx = systemCtx(studioId)
  const events = await db()
    .collection('studios')
    .doc(studioId)
    .collection('events')
    .orderBy('recordedAt', 'desc')
    .limit(1)
    .get()

  const newest = events.docs[0]?.data()?.recordedAt
  if (!(newest instanceof Timestamp)) return 0 // no events yet — nothing to be behind

  const today = new Date(now).toISOString().slice(0, 10)
  const daily = await new FirestoreProjectionRepository(db()).getDaily(ctx, today)
  const watermark = daily?.lastEventAt ?? 0
  const lagMs = newest.toMillis() - watermark

  if (lagMs > 60 * MS_PER_MIN) {
    logger.error('health: projection watermark is behind the log', {
      alert: 'projection_lag',
      studioId,
      lagMinutes: Math.round(lagMs / MS_PER_MIN),
      // The remedy is never a hand-edit: `pnpm projections:rebuild` replays the log. The
      // projection is disposable precisely so that this is a boring incident.
      remedy: 'projections:rebuild',
    })
  }
  return lagMs
}

// The checks RETURN their findings and log them as a side effect — rather than only logging, which
// would leave the alarm testable exclusively by spying on a logger. A monitor whose only observable
// behaviour is a log line is a monitor you cannot prove works, and an alarm nobody proved is an
// assurance, not a control.
export interface FastHealthReport {
  readonly studioId: StudioId
  readonly stuckCommands: number
  readonly projectionLagMs: number
}

export async function runFastHealthChecks(now: number): Promise<readonly FastHealthReport[]> {
  const reports: FastHealthReport[] = []
  for (const studioId of await studioIds()) {
    reports.push({
      studioId,
      stuckCommands: await checkStuckCommands(studioId, now),
      projectionLagMs: await checkProjectionLag(studioId, now),
    })
  }
  return reports
}

// ── NIGHTLY (report only, never repair) ─────────────────────────────────────────────────────

/**
 * SIGNAL 3 — `bookedCount` disagrees with the reservations that exist.
 *
 * The denormalised counter is what capacity is judged against. If it drifts high, a class silently
 * refuses members it has room for; if it drifts low, it oversells. Neither shows up as an error.
 */
async function checkBookedCountDrift(studioId: StudioId, now: number): Promise<number> {
  // Only sessions that can still be booked: a past session's counter is history, and history that
  // drifted cannot be fixed by knowing about it now.
  const sessions = await db()
    .collection('studios')
    .doc(studioId)
    .collection('classSessions')
    .where('startsAt', '>=', Timestamp.fromMillis(now))
    .limit(200)
    .get()

  let drifted = 0
  for (const session of sessions.docs) {
    const booked = await db()
      .collection('studios')
      .doc(studioId)
      .collection('reservations')
      .where('classSessionId', '==', session.id)
      .where('status', '==', 'booked')
      .count()
      .get()

    const recorded = (session.data().bookedCount as number | undefined) ?? 0
    const actual = booked.data().count
    if (recorded !== actual) {
      drifted++
      logger.error('health: bookedCount drift', {
        alert: 'booked_count_drift',
        studioId,
        classSessionId: session.id,
        recorded,
        actual,
      })
    }
  }
  return drifted
}

/**
 * SIGNAL 4 — `credits.available` disagrees with its six counters (DEBT-004).
 *
 * `available` is stored beside the counters it derives from, so that "packages expiring with
 * unused sessions" can be an index rather than a scan. It can therefore drift — and a drift is not
 * a data problem to be corrected. **It means a write path bypassed the transaction, and that is a
 * bug.** Repairing the number would erase the only evidence of it.
 */
async function checkCreditLedgerDrift(studioId: StudioId): Promise<number> {
  const entitlements = await db()
    .collection('studios')
    .doc(studioId)
    .collection('entitlements')
    .where('status', '==', 'active')
    .limit(500)
    .get()

  let drifted = 0
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

    if ((c.available ?? 0) !== derived) {
      drifted++
      logger.error('health: credit ledger drift — a write path bypassed the transaction', {
        alert: 'credit_ledger_drift',
        studioId,
        entitlementId: doc.id,
        stored: c.available ?? 0,
        derived,
      })
    }
  }
  return drifted
}

/**
 * SIGNAL 5 — an entitlement at its `validUntil` still holding a credit (I-19).
 *
 * The expiry sweep would burn a credit that a class is about to consume. The domain already
 * refuses this (`decideExpire` will not touch a row while `held > 0`), so this check exists to
 * make the refusal VISIBLE: a row that reaches its expiry still holding a credit means the
 * auto-resolution sweep did not settle it, and that is the thing to look at.
 */
async function checkExpiringWithHeld(studioId: StudioId, now: number): Promise<number> {
  const expiring = await db()
    .collection('studios')
    .doc(studioId)
    .collection('entitlements')
    .where('status', '==', 'active')
    .where('validUntil', '<=', Timestamp.fromMillis(now + 24 * 60 * MS_PER_MIN))
    .limit(200)
    .get()

  const held = expiring.docs.filter((d) => {
    const c = d.data().credits as Record<string, number> | null | undefined
    return (c?.held ?? 0) > 0
  })

  if (held.length > 0) {
    logger.error('health: entitlement expiring while still holding a credit', {
      alert: 'expiring_with_held',
      studioId,
      count: held.length,
      entitlementIds: held.slice(0, 10).map((d) => d.id),
    })
  }
  return held.length
}

export interface NightlyHealthReport {
  readonly studioId: StudioId
  readonly bookedCountDrift: number
  readonly creditLedgerDrift: number
  readonly expiringWithHeld: number
}

export async function runNightlyHealthChecks(now: number): Promise<readonly NightlyHealthReport[]> {
  const reports: NightlyHealthReport[] = []
  for (const studioId of await studioIds()) {
    const report: NightlyHealthReport = {
      studioId,
      bookedCountDrift: await checkBookedCountDrift(studioId, now),
      creditLedgerDrift: await checkCreditLedgerDrift(studioId),
      expiringWithHeld: await checkExpiringWithHeld(studioId, now),
    }

    // A summary line even when everything is fine. A monitor only ever heard from when it is angry
    // is a monitor nobody can tell apart from a broken one.
    logger.info('health: nightly checks complete', {
      ...report,
      clean:
        report.bookedCountDrift === 0 &&
        report.creditLedgerDrift === 0 &&
        report.expiringWithHeld === 0,
    })
    reports.push(report)
  }
  return reports
}
