import { Timestamp } from 'firebase-admin/firestore'
import * as logger from 'firebase-functions/logger'

import {
  FirestoreReservationRepository,
  instant,
  newEventId,
  newOperationId,
  type StudioId,
  type TenantContext,
} from '@studio/core'

import { db } from '../shared/firebase'

// ── DERS HATIRLATMALARI (Ders Hatırlatmaları milestone). ────────────────────────────────────
//
// A pilates class has a FIXED time, so "dersine 1 saat kala" is a reminder a scanner can time — unlike
// fitness (serbest-giriş, no time), which the desk sends by hand. Like every other reminder in this
// system (`reminders.ts`), it is a **domain event**, not a cron that reaches for a gateway: the sweep
// emits `class_reminder.due`, and the ONE downstream notifier (`on-event-notify`) turns it into a
// WhatsApp + in-app message via the rules table. Writing the event means it obeys quiet hours, per-member
// prefs, the Notification Center audit, and retries — none of which a direct send would.
//
// Idempotent by construction: a `classReminderSentAt` marker on the reservation records that we already
// announced it, so the every-15-minutes sweep tells each member exactly once. OFF by default — the owner
// turns it on from the panel (and only once her Meta template is approved does WhatsApp actually leave).

const REMINDER_CATEGORY = 'pilates_group'
const DEFAULT_OFFSET_MIN = 60

interface ClassReminderConfig {
  readonly enabled?: boolean
  readonly offsetMinutes?: number
}

export async function runClassReminderSweep(nowMs = Date.now()): Promise<void> {
  // `listDocuments()`, not `get()` — a studio with only sub-collections is invisible to `get()`.
  const studios = await db().collection('studios').listDocuments()

  for (const studio of studios) {
    const studioId = studio.id as StudioId
    const ctx: TenantContext = {
      studioId,
      branchIds: [],
      role: 'owner',
      // #5 — the sweep is `system`; it never borrows a human's identity.
      actor: { type: 'system', id: 'class_reminder_sweep' as never },
    }

    try {
      const settings = await db().doc(`studios/${studioId}/settings/studio`).get()
      const cfg = settings.get('classReminder') as ClassReminderConfig | undefined
      if (!cfg?.enabled) continue
      const offset = cfg.offsetMinutes && cfg.offsetMinutes > 0 ? cfg.offsetMinutes : DEFAULT_OFFSET_MIN

      // Every booked pilates class starting within the next `offset` minutes. The marker makes it
      // once-only, so a wide "from now" window is safe and also catches a late booking made inside the
      // hour — she still gets told.
      const reservations = await new FirestoreReservationRepository(db()).listBySessionStartRange(
        ctx,
        instant(nowMs),
        instant(nowMs + offset * 60_000),
      )

      let emitted = 0
      for (const r of reservations) {
        if (r.status !== 'booked') continue
        if (r.sessionCategory !== REMINDER_CATEGORY) continue
        const doc = db().doc(`studios/${studioId}/reservations/${r.id}`)
        const snap = await doc.get()
        if (snap.get('classReminderSentAt')) continue

        await emit(studioId, ctx, r.memberId as string, r.classSessionId as string, r.id as string)
        await doc.set({ classReminderSentAt: Timestamp.now() }, { merge: true })
        emitted++
      }

      if (emitted > 0) logger.info('class reminders emitted', { studioId, emitted })
    } catch (err) {
      logger.error('class reminder sweep failed', { studioId, err })
    }
  }
}

// Two timestamps, a system actor, no PII (#6): the member's name and the class time are resolved
// downstream from `related.classSessionId`. This file does not know that notifications exist.
async function emit(
  studioId: StudioId,
  ctx: TenantContext,
  memberId: string,
  classSessionId: string,
  reservationId: string,
): Promise<void> {
  await db()
    .collection(`studios/${studioId}/events`)
    .doc(newEventId())
    .set({
      studioId,
      branchId: null,
      type: 'class_reminder.due',
      version: 1,
      payload: {},
      occurredAt: Timestamp.now(),
      recordedAt: Timestamp.now(),
      actor: ctx.actor,
      source: 'system_sweep',
      subject: { kind: 'reservation', id: reservationId },
      related: { memberId, classSessionId },
      policyRef: null,
      commandId: null,
      causationId: null,
      correlationId: newOperationId(),
    })
}
