import * as logger from 'firebase-functions/logger'

import { FirestoreCheckinRepository, sweepAutoCheckOut, systemClock, type SystemJobId } from '@studio/core'

import { listStudioIds, systemTenantContext } from '../shared/context'
import { db } from '../shared/firebase'

// The nightly auto-check-out sweep (D4, actor: `system`, OQ-9). Anyone still inside
// past the threshold is checked out — otherwise occupancy never returns to zero. The
// threshold is the owner's number; today a constant, a `StudioConfig` field later.
const JOB_ID = 'occupancy_auto_checkout' as SystemJobId
const THRESHOLD_HOURS = 4

export async function runAutoCheckOutSweep(): Promise<void> {
  const database = db()
  const deps = { repo: new FirestoreCheckinRepository(database), clock: systemClock }

  for (const sid of await listStudioIds(database)) {
    const res = await sweepAutoCheckOut(deps, systemTenantContext(sid, JOB_ID), THRESHOLD_HOURS)
    if (res.ok) logger.info('auto-check-out sweep', { studioId: sid, checkedOut: res.value.checkedOut })
  }
}
