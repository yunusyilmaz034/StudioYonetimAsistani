import { Timestamp } from 'firebase-admin/firestore'
import { describe, expect, it } from 'vitest'

import type { HealthAlert } from '@studio/core'

import { runFastHealthChecks, runNightlyHealthChecks, type HealthRun } from '../../src/scheduled/health'
import { db } from '../../src/shared/firebase'

// An untested alarm is not an alarm — it is a file that makes everyone feel safer.
//
// Every signal here is a failure that produces NO error, NO crash and NO complaint until it is far
// too late (Doc 6 §9). So each test plants the exact corruption the check exists to find, and
// asserts the check SAW it. A monitor that stays quiet through a real drift is worse than none: it
// converts an unknown risk into a false assurance.

const STUDIO = 'std_health_test'

const of = (runs: readonly HealthRun[]): HealthRun => {
  const r = runs.find((x) => x.studioId === STUDIO)
  if (!r) throw new Error(`no health report for ${STUDIO}`)
  return r
}

/** How many rows did this signal find? Zero means the alarm stayed quiet — which is itself a claim. */
const count = (run: HealthRun, alert: HealthAlert): number =>
  run.findings.find((f) => f.alert === alert)?.count ?? 0

const fast = async (now: number): Promise<HealthRun> => of(await runFastHealthChecks(now))
const nightly = async (now: number): Promise<HealthRun> => of(await runNightlyHealthChecks(now))

describe('SIGNAL — a command stuck in pending', () => {
  it('sees a command the trigger never processed', async () => {
    const now = Date.now()
    const ref = db().doc(`studios/${STUDIO}/commands/cmd_stuck_${now}`)

    // Created NOT-pending, then moved to pending. `onDocumentCreated` does not fire on an update,
    // so the live trigger never touches this document — which is precisely the state we are
    // simulating: a command whose trigger never ran. (Creating it as `pending` would be pointless:
    // the emulator's real trigger would pick it up and resolve it, and the test would prove that
    // the system WORKS while claiming to prove that the alarm does.)
    await ref.set({
      type: 'checkIn.record',
      status: 'unprocessed',
      actor: { type: 'receptionist', id: 'usr_x' },
      occurredAt: Timestamp.fromMillis(now - 6 * 60_000), // six minutes ago
      payload: {},
    })
    await ref.update({ status: 'pending' })

    const run = await fast(now)
    // Reception's UI is optimistic: it already told her the member walked in. If this alarm does
    // not fire, nothing in the system ever mentions that check-in again.
    expect(count(run, 'commands_stuck'), 'a stuck command did not raise the alarm').toBeGreaterThan(0)

    await ref.delete()
  })

  it('stays quiet for a command that is merely young', async () => {
    const now = Date.now()
    const ref = db().doc(`studios/${STUDIO}/commands/cmd_fresh_${now}`)
    await ref.set({
      type: 'checkIn.record',
      status: 'unprocessed',
      actor: { type: 'receptionist', id: 'usr_x' },
      occurredAt: Timestamp.fromMillis(now), // just written; the trigger is entitled to a moment
      payload: {},
    })
    await ref.update({ status: 'pending' })

    // A monitor that cries at every healthy write gets muted — and a muted monitor is
    // indistinguishable from one that was never built.
    expect(count(await fast(now), 'commands_stuck')).toBe(0)

    await ref.delete()
  })
})

describe('SIGNAL — the credit ledger drifted (DEBT-004)', () => {
  it('sees `available` disagreeing with its six counters — and does NOT repair it', async () => {
    const now = Date.now()
    const ref = db().doc(`studios/${STUDIO}/entitlements/ent_drift_${now}`)
    await ref.set({
      status: 'active',
      validUntil: Timestamp.fromMillis(now + 30 * 24 * 3600_000),
      credits: {
        granted: 10,
        restored: 0,
        consumed: 2,
        held: 1,
        revoked: 0,
        expired: 0,
        available: 9, // the truth is 7. A write path bypassed the transaction.
      },
    })

    const run = await nightly(now)
    expect(
      count(run, 'credit_ledger_drift'),
      'a drifted credit ledger went unreported',
    ).toBeGreaterThan(0)

    // And note what does NOT happen. Correcting the number would destroy the only evidence that a
    // write path bypassed a transaction — which is the actual bug, and the only thing worth knowing.
    const after = (await ref.get()).data()
    expect(
      (after?.credits as Record<string, number>).available,
      'the check REPAIRED the drift — a self-healing system hides its bugs',
    ).toBe(9)

    await ref.delete()
  })
})

describe('SIGNAL — an entitlement expiring while still holding a credit (I-19)', () => {
  it('sees the row the expiry sweep must not burn', async () => {
    const now = Date.now()
    const ref = db().doc(`studios/${STUDIO}/entitlements/ent_held_${now}`)
    await ref.set({
      status: 'active',
      validUntil: Timestamp.fromMillis(now + 3600_000), // expires within the hour
      credits: {
        granted: 10,
        restored: 0,
        consumed: 0,
        held: 1, // a class this package will no longer be alive to pay for
        revoked: 0,
        expired: 0,
        available: 9,
      },
    })

    expect(count(await nightly(now), 'expiring_with_held')).toBeGreaterThan(0)

    await ref.delete()
  })
})
