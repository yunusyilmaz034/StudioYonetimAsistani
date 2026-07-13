import * as logger from 'firebase-functions/logger'

import {
  FirestoreReservationRepository,
  FirestoreStudioHours,
  sweepAutoResolve,
  systemClock,
  type SystemJobId,
} from '@studio/core'

import { listStudioIds, systemTenantContext } from '../shared/context'
import { db } from '../shared/firebase'

// The nightly attendance auto-resolution sweep (actor: `system`, AD-38). For every
// studio, every still-`booked` reservation whose class has ended and passed its
// grace window is resolved to the policy default — as `reservation.auto_resolved`,
// NEVER `reservation.attended`. Runs BEFORE the expiry sweep (I-19); see index.ts.
const JOB_ID = 'attendance_auto_resolver' as SystemJobId

export async function runAutoResolveSweep(): Promise<void> {
  const database = db()
  const deps = {
    repo: new FirestoreReservationRepository(database),
    clock: systemClock,
    // AG-1. The sweep never books, so it never asks — but the dependency is required rather than
    // optional, and that is the point: nobody can wire a booking path without it.
    hours: new FirestoreStudioHours(database),
  }

  for (const sid of await listStudioIds(database)) {
    const summary = await sweepAutoResolve(deps, systemTenantContext(sid, JOB_ID))
    logger.info('auto-resolve sweep', { studioId: sid, ...summary })
    if (summary.failed > 0) {
      logger.error('auto-resolve sweep had failures', { studioId: sid, failed: summary.failed })
    }
  }
}
