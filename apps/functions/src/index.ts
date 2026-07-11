// @studio/functions — Cloud Functions v2: the async work nobody is waiting for.
//
// Phase 1 registers:
//   onCommandCreated — the offline write path (Doc 3 §5): applies a whitelisted
//                      /commands doc as its own principal. Today: attendance.mark.
//   nightlySweep     — the two `system` sweeps, IN ORDER (I-19): auto-resolution
//                      then credit expiry.
//
// on-event-created (member.stats + memberSnapshot backfill) is the next automation
// milestone; nothing reads a projection yet, so it is not built here.
import { onSchedule } from 'firebase-functions/v2/scheduler'

import { runAutoCheckOutSweep } from './scheduled/auto-check-out'
import { runAutoResolveSweep } from './scheduled/auto-resolve-attendance'
import { runExpirySweep } from './scheduled/expire-credits'
import { onCommandCreated } from './triggers/on-command-created'

export { onCommandCreated }

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
  },
)
