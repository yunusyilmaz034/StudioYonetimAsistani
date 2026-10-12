import { Timestamp } from 'firebase-admin/firestore'
import * as logger from 'firebase-functions/logger'

import {
  DEFAULT_STUDIO_CONFIG,
  ENERGY_DAY_SUMMARY_DUE,
  FirestoreEnergyRepository,
  FirestoreTrainingRepository,
  TrainingWorkoutSource,
  energyDays,
  energyToday,
  newEventId,
  newOperationId,
  summaryIsDue,
  systemClock,
  type EnergyDeps,
  type StudioId,
  type TenantContext,
} from '@studio/core'

import { db } from '../shared/firebase'

// ── KALORİ TAKİBİ — GÜNÜN ÖZETİ, 21:30 (owner, 2026-10-13) ──────────────────────────────────
//
// *"Hem ekranda hem bildirim olarak gelsin gün sonunda"* — and, asked whether a member who entered
// nothing should hear from us: *"aynen, gitmesin."*
//
// Like every reminder in this system, this is a DOMAIN EVENT, not a cron that reaches for a gateway:
// the sweep emits `energy_day.summary_due`, and the one downstream notifier turns it into a push and
// an inbox entry — so it obeys her preferences, the quiet hours and the Notification Centre's audit.
//
// The event carries the date and nothing else. The figure she reads is computed by the notifier from
// her own documents at send time; a calorie total is derived from her weight and has no business in
// the log (#6).
//
// Once per member per day: `summarySentFor` on her profile records the date we announced. A profile
// is erased when she stops tracking, and the marker goes with it — there is nothing left to remind.

export async function runEnergySummarySweep(): Promise<void> {
  // `listDocuments()`, not `get()` — a studio with only sub-collections is invisible to `get()`.
  const studios = await db().collection('studios').listDocuments()

  for (const studio of studios) {
    const studioId = studio.id as StudioId
    const ctx: TenantContext = {
      studioId,
      branchIds: [],
      role: 'owner',
      // #5 — the sweep is `system`; it never borrows a human's identity.
      actor: { type: 'system', id: 'energy_summary_sweep' as never },
    }
    const deps: EnergyDeps = {
      repo: new FirestoreEnergyRepository(db()),
      workouts: new TrainingWorkoutSource(new FirestoreTrainingRepository(db())),
      clock: systemClock,
      utcOffsetMinutes: DEFAULT_STUDIO_CONFIG.utcOffsetMinutes,
    }

    try {
      const today = energyToday(deps)
      const profiles = await deps.repo.listProfiles(ctx)
      let emitted = 0
      for (const profile of profiles) {
        const ref = db().doc(`studios/${studioId}/energyProfiles/${profile.memberId}`)
        const snap = await ref.get()
        if (snap.get('summarySentFor') === today) continue

        const r = await energyDays(deps, ctx, profile.memberId, today, today)
        const view = r.ok ? r.value.days[0] : undefined
        if (!view || !summaryIsDue(view)) continue

        // The marker and the event in one batch: an event without its marker would be announced
        // twice on a retry, a marker without its event never at all.
        const batch = db().batch()
        batch.set(ref, { summarySentFor: today }, { merge: true })
        batch.set(db().collection(`studios/${studioId}/events`).doc(newEventId()), {
          studioId,
          branchId: null,
          type: ENERGY_DAY_SUMMARY_DUE,
          version: 1,
          payload: { date: today },
          occurredAt: Timestamp.now(),
          recordedAt: Timestamp.now(),
          actor: ctx.actor,
          source: 'system_sweep',
          subject: { kind: 'energy_day', id: `${profile.memberId}_${today}` },
          related: { memberId: profile.memberId },
          policyRef: null,
          commandId: null,
          causationId: null,
          correlationId: newOperationId(),
        })
        await batch.commit()
        emitted++
      }
      if (emitted > 0) logger.info('energy summaries emitted', { studioId, emitted, tracking: profiles.length })
    } catch (err) {
      logger.error('energy summary sweep failed', { studioId, err })
    }
  }
}
