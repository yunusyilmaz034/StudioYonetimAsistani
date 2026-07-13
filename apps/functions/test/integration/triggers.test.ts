import {
  FirestoreProjectionRepository,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { deleteApp, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The dispatch layer, proven for the first time (v1.26 B0).
//
// Everything below the trigger — the deciders, the ledger, the projector — has been tested
// since v1.4. The trigger ITSELF never had a test, and could not have had one: no Cloud
// Function in this repository had ever loaded (DEBT-011). So a trigger bound to the wrong
// path, listening for the wrong event, or simply never deployed would break nothing that
// `pnpm check` runs — while silently costing the studio its dashboard, its notifications,
// and every check-in reception took offline.
//
// These tests write a document and watch for what the trigger did about it. They assert the
// WIRING, not the arithmetic: that a real Firestore write reaches a real function, and that
// the function writes back. Run via `pnpm test:integration` (needs the emulator, and a JVM).

const STUDIO = 'std_trigger_test'

let app: ReturnType<typeof initializeApp>
let db: Firestore

beforeAll(() => {
  app = initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'demo-sos' }, 'triggers')
  db = getFirestore(app)
})

afterAll(async () => {
  await deleteApp(app)
})

/** Poll until `read` returns something truthy, or give up. A trigger is asynchronous: there is
 *  no completion to await, only a consequence to observe. */
async function eventually<T>(read: () => Promise<T | null | undefined>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value) return value
    if (Date.now() > deadline) return null
    await new Promise((r) => setTimeout(r, 250))
  }
}

describe('onEventCreated — the projector (v1.23)', () => {
  it('folds an appended event into the daily read model', async () => {
    // 2026-03-04 12:00 UTC — inside the same Istanbul day (+180) either way, so the date the
    // projector derives is not a function of when this test happens to run.
    const occurredAt = Timestamp.fromMillis(Date.parse('2026-03-04T12:00:00Z'))
    const eventId = `evt_trigger_${Date.now()}`

    await db.doc(`studios/${STUDIO}/events/${eventId}`).set({
      type: 'reservation.booked',
      occurredAt,
      recordedAt: Timestamp.now(),
      payload: {},
    })

    const day = await eventually(async () => {
      const snap = await db.doc(`studios/${STUDIO}/readModels/daily/days/2026-03-04`).get()
      return snap.exists ? snap.data() : null
    })

    expect(day, 'the projector never ran — onEventCreated is not wired').not.toBeNull()
    // The read model is FLAT: counters sit at the document root beside `date` and `lastEventAt`.
    expect(day?.bookings).toBe(1)
  })
})

describe('the projector is IDEMPOTENT — a redelivery must not double-count', () => {
  it('moves the counter once, however many times the same event arrives', async () => {
    // Firestore delivers at-least-once. A trigger that ran twice on one booking would produce a
    // dashboard that is *silently* wrong — no crash, no error, just a number the owner trusts and
    // shouldn't. The marker document and the counter move in ONE transaction; this proves it.
    //
    // Asserted at the repository, not by making the emulator redeliver: we cannot force a
    // redelivery on demand, and a test that cannot force its own precondition is a test that
    // passes for the wrong reason.
    const ctx: TenantContext = {
      studioId: STUDIO as StudioId,
      branchIds: [],
      role: 'platform_admin',
      actor: { type: 'system', id: 'daily_projection' as never },
    }
    const repo = new FirestoreProjectionRepository(db)
    const eventId = `evt_redelivered_${Date.now()}`
    const eventAt = Date.parse('2026-05-05T09:00:00Z')
    const inc = { date: '2026-05-05', counters: { bookings: 1 } } as const

    const first = await repo.applyOnce(ctx, eventId, eventAt, inc)
    const second = await repo.applyOnce(ctx, eventId, eventAt, inc)
    const third = await repo.applyOnce(ctx, eventId, eventAt, inc)

    expect(first, 'the first delivery must be applied').toBe(true)
    expect(second, 'a redelivery was applied a second time').toBe(false)
    expect(third).toBe(false)

    const day = await repo.getDaily(ctx, '2026-05-05')
    expect(day?.bookings, 'the counter moved more than once for one event').toBe(1)
  })
})

describe('onCommandCreated — the offline write path (Doc 3 §5)', () => {
  it('picks up a pending command and resolves it', async () => {
    // A command the domain will REFUSE (there is no such reservation). The refusal is the point:
    // it proves the trigger fired, dispatched into `core`, and wrote the outcome back — without
    // needing a seeded member, session, entitlement and reservation. The happy path belongs to
    // the suite B2 builds on top of this one.
    const commandId = `cmd_trigger_${Date.now()}`

    await db.doc(`studios/${STUDIO}/commands/${commandId}`).set({
      type: 'attendance.mark',
      status: 'pending',
      actor: { type: 'staff', id: 'stf_test', role: 'receptionist' },
      occurredAt: Timestamp.now(),
      payload: { reservationId: 'rsv_does_not_exist', outcome: 'attended' },
    })

    const resolved = await eventually(async () => {
      const snap = await db.doc(`studios/${STUDIO}/commands/${commandId}`).get()
      const status = snap.data()?.status as string | undefined
      return status && status !== 'pending' ? status : null
    })

    // `pending` forever is the failure this test exists for: it is exactly what reception would
    // see today — a check-in that vanishes, with nothing logged and nobody told (Doc 6 §9).
    expect(resolved, 'the command stayed pending — onCommandCreated is not wired').not.toBeNull()
    expect(['applied', 'failed']).toContain(resolved)
  })

  it('resolves a malformed command instead of dying on it', async () => {
    // `/commands` is the ONLY collection a client may write. A document with no `occurredAt`
    // used to crash the handler, which Firestore then redelivered — forever. A poison message
    // in the offline write path is a check-in that disappears with nobody able to see why.
    const commandId = `cmd_malformed_${Date.now()}`

    await db.doc(`studios/${STUDIO}/commands/${commandId}`).set({
      type: 'attendance.mark',
      status: 'pending',
      actor: { type: 'staff', id: 'stf_test', role: 'receptionist' },
      payload: { reservationId: 'rsv_x', outcome: 'attended' },
      // occurredAt: deliberately absent
    })

    const resolved = await eventually(async () => {
      const snap = await db.doc(`studios/${STUDIO}/commands/${commandId}`).get()
      const status = snap.data()?.status as string | undefined
      return status && status !== 'pending' ? status : null
    })

    expect(resolved, 'a malformed command poisoned the trigger').toBe('failed')
  })
})
