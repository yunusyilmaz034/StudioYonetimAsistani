import * as logger from 'firebase-functions/logger'

import { FirestoreCheckinRepository, sweepAutoCheckOut, systemClock, type SystemJobId } from '@studio/core'

import { listStudioIds, systemTenantContext } from '../shared/context'
import { db } from '../shared/firebase'

// The auto-check-out sweep (D4, actor: `system`, OQ-9). Anyone still inside past the threshold is
// checked out — otherwise occupancy never returns to zero. The threshold is the owner's number;
// today a constant, a `StudioConfig` field later.
//
// ── Why 2.5 hours, and why hourly (2026-07-31) ──────────────────────────────────────────────
//
// There is no turnstile here. Nobody scans on the way out, and reception has a customer in front of
// her, so the exit is the one event this studio will never record reliably. The sweep is not a
// tidy-up job; it is the ONLY thing that ends a visit.
//
// It used to run once, at 03:00, inside `nightlySweep`. So a member who left at 17:40 stayed
// "inside" on the occupancy board until the small hours, and the board reception looks at all
// evening was simply wrong. Hourly, at four hours, still leaves half an evening of wrong numbers.
//
// 2.5 h is the longest a real visit runs: a 50-minute class, changing, a coffee, a chat. Hourly
// means the correction lands within ~1 h of that. Owner: *"süpürge çok sık çalışmasın o kadar,
// sadece bunun için"* — often enough to keep the board honest, not a minute-by-minute poller.
//
// Cost of getting it wrong in each direction is asymmetric, which is why the number can be this
// tight: sweeping too early ends a visit that was still running (occupancy reads one low for a
// while, and the check-OUT consumes nothing — credit lives on the reservation, not the door);
// sweeping too late leaves a phantom in the room for hours. The second is the one reception sees.
const JOB_ID = 'occupancy_auto_checkout' as SystemJobId
const THRESHOLD_HOURS = 2.5

export async function runAutoCheckOutSweep(): Promise<void> {
  const database = db()
  const deps = { repo: new FirestoreCheckinRepository(database), clock: systemClock }

  for (const sid of await listStudioIds(database)) {
    const res = await sweepAutoCheckOut(deps, systemTenantContext(sid, JOB_ID), THRESHOLD_HOURS)
    if (res.ok) logger.info('auto-check-out sweep', { studioId: sid, checkedOut: res.value.checkedOut })
  }
}
