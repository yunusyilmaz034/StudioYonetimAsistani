import { Timestamp } from 'firebase-admin/firestore'
import * as logger from 'firebase-functions/logger'

import {
  available,
  FirestoreEntitlementRepository,
  newEventId,
  newOperationId,
  type StudioId,
  type TenantContext,
} from '@studio/core'

import { db } from '../shared/firebase'

// ── REMINDERS (v1.25, Doc 28 §9). ───────────────────────────────────────────────────────────
//
// "Your package expires in three days" has NO event behind it — nothing happened; time merely
// passed. So the reminder is a **domain event of its own**, emitted once, idempotently, by a
// scheduled scanner:
//
//     entitlement.expiring · entitlement.credits_low
//
// **A reminder is a domain fact, not a cron job that sends an SMS.** Writing the event (rather than
// calling the notifier directly) means the reminder appears in the member's timeline, obeys the same
// rules table, collapses with the same OperationId, and can be replayed — none of which is true of a
// job that reaches for a gateway.
//
// Idempotent by construction: a marker on the entitlement records the window we already announced,
// so the sweep can run every hour and the member is told once.

const DAY = 86_400_000
const EXPIRY_WINDOW_DAYS = 7
const LOW_CREDIT_THRESHOLD_FALLBACK = 2

export async function runReminderSweep(nowMs = Date.now()): Promise<void> {
  const studios = await db().collection('studios').get()

  for (const studio of studios.docs) {
    const studioId = studio.id as StudioId
    const ctx: TenantContext = {
      studioId,
      branchIds: [],
      role: 'owner',
      // #5 — the sweep is `system`. It never borrows a human's identity.
      actor: { type: 'system', id: 'reminder_sweep' as never },
    }

    try {
      const settings = await db().doc(`studios/${studioId}/settings/studio`).get()
      const threshold =
        (settings.get('lowCreditThreshold') as number | undefined) ?? LOW_CREDIT_THRESHOLD_FALLBACK

      const entitlements = await new FirestoreEntitlementRepository(db()).listActive(ctx)
      let emitted = 0

      for (const e of entitlements) {
        const doc = db().doc(`studios/${studioId}/entitlements/${e.id}`)
        const snap = await doc.get()
        const daysLeft = Math.ceil((e.validUntil - nowMs) / DAY)

        // ── expiring soon ──
        if (daysLeft > 0 && daysLeft <= EXPIRY_WINDOW_DAYS && !snap.get('expiryReminderAt')) {
          await emit(studioId, ctx, 'entitlement.expiring', e.memberId as string, e.id as string, {
            productName: e.productSnapshot.name,
            daysLeft,
          })
          await doc.set({ expiryReminderAt: Timestamp.now() }, { merge: true })
          emitted++
        }

        // ── credits running low ──
        if (e.credits !== null) {
          const remaining = available(e.credits)
          if (remaining > 0 && remaining <= threshold && !snap.get('lowCreditReminderAt')) {
            await emit(studioId, ctx, 'entitlement.credits_low', e.memberId as string, e.id as string, {
              remaining,
            })
            await doc.set({ lowCreditReminderAt: Timestamp.now() }, { merge: true })
            emitted++
          }
        }
      }

      if (emitted > 0) logger.info('reminders emitted', { studioId, emitted })
    } catch (err) {
      logger.error('reminder sweep failed', { studioId, err })
    }
  }
}

// The event is written exactly like any other: two timestamps, a system actor, an OperationId, and
// no PII. The notifier picks it up downstream — this file does not know that notifications exist.
async function emit(
  studioId: StudioId,
  ctx: TenantContext,
  type: string,
  memberId: string,
  entitlementId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db()
    .collection(`studios/${studioId}/events`)
    .doc(newEventId())
    .set({
      studioId,
      branchId: null,
      type,
      version: 1,
      payload,
      occurredAt: Timestamp.now(),
      recordedAt: Timestamp.now(),
      actor: ctx.actor,
      source: 'system_sweep',
      subject: { kind: 'entitlement', id: entitlementId },
      related: { memberId, entitlementId },
      policyRef: null,
      commandId: null,
      causationId: null,
      correlationId: newOperationId(),
    })
}
