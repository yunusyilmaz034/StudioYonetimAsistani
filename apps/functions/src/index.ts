// @studio/functions — Cloud Functions v2: the async work nobody is waiting for.
//
// Phase 1 registers:
//   onCommandCreated — the offline write path (Doc 3 §5): applies a whitelisted
//                      /commands doc as its own principal. Today: attendance.mark.
//   nightlySweep     — the two `system` sweeps, IN ORDER (I-19): auto-resolution
//                      then credit expiry.
//   onEventCreated   — the daily read model (v1.23): the ONLY projector in the system.
//                      It folds events into per-day counters; it reads no state document,
//                      and it can be rebuilt from the log at any time.
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { runAutoCheckOutSweep } from './scheduled/auto-check-out'
import { runAutoResolveSweep } from './scheduled/auto-resolve-attendance'
import { runExpirySweep } from './scheduled/expire-credits'
import { runNotificationRetrySweep } from './scheduled/notification-retry'
import { runReminderSweep } from './scheduled/reminders'
import { onCommandCreated } from './triggers/on-command-created'
import { onEventCreated } from './triggers/on-event-created'

export { onCommandCreated }
// v1.23 — the daily read model behind the owner dashboard. Disposable: if it is ever wrong, it is
// deleted and replayed from the log (`pnpm projections:rebuild`).
export { onEventCreated }

// ONE nightly trigger sequences the two sweeps so I-19 holds BY CONSTRUCTION: a held
// credit is settled by auto-resolution before the expiry sweep can touch its package.
// Two separate cron functions could not guarantee this order; `decideExpire` refusing
// while `held > 0` is the second line of defence. Istanbul time — Phase 1 is one
// Türkiye studio (StudioConfig.utcOffsetMinutes = +180; a per-studio timezone later).
export const nightlySweep = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'Europe/Istanbul' },
  async () => {
    await runAutoResolveSweep()
    await runExpirySweep()
    await runAutoCheckOutSweep() // independent of I-19; occupancy hygiene (D4)
    // v1.25 — reminders are DOMAIN EVENTS ("your package expires in three days" has no event behind
    // it; time merely passed). They run last, so they see the night's expiries.
    await runReminderSweep()
  },
)

// v1.25 — the retry sweep, and the quiet-hour queue (the same mechanism from another angle). Every
// 15 minutes: a queued LOW/NORMAL message waits for 08:00, a transient failure waits for its
// backoff, and a PERMANENT failure is never picked up at all.
export const notificationRetry = onSchedule({ schedule: 'every 15 minutes' }, async () => {
  await runNotificationRetrySweep()
})
