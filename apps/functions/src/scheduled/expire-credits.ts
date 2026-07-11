import * as logger from 'firebase-functions/logger'

import {
  FirestoreEntitlementRepository,
  sweepExpireCredits,
  systemClock,
  type SystemJobId,
} from '@studio/core'

import { listStudioIds, systemTenantContext } from '../shared/context'
import { db } from '../shared/firebase'

// The nightly credit-expiry sweep (actor: `system`, AD-26). For every studio, every
// active entitlement whose validity has passed expires its unused credits — the
// churn signal (I-4). Runs AFTER auto-resolution (I-19): a reservation's held credit
// must settle first, and `decideExpire` refuses a package still holding one.
const JOB_ID = 'credit_expiry_sweep' as SystemJobId

export async function runExpirySweep(): Promise<void> {
  const database = db()
  const deps = { repo: new FirestoreEntitlementRepository(database), clock: systemClock }

  for (const sid of await listStudioIds(database)) {
    const summary = await sweepExpireCredits(deps, systemTenantContext(sid, JOB_ID))
    logger.info('expire sweep', { studioId: sid, ...summary })
    if (summary.failed > 0) {
      logger.error('expire sweep had failures', { studioId: sid, failed: summary.failed })
    }
  }
}
