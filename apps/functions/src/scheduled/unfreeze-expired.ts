import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreEntitlementRepository,
  runFreezeBudgetSweep,
  systemClock,
  type SystemJobId,
} from '@studio/core'
import * as logger from 'firebase-functions/logger'

import { listStudioIds, systemTenantContext } from '../shared/context'
import { db } from '../shared/firebase'

// The nightly freeze-budget sweep (actor: `system` · v1.27 S3).
//
// **An unlimited freeze is an unlimited membership, sold at the price of a three-month one.** A
// member who never asks to be unfrozen is unfrozen on the day her budget runs out, and her
// membership is extended by exactly the days she paid for — no more.
//
// ── It runs FIRST, before auto-resolution and expiry, and that order is load-bearing ─────────
// A membership that was extended by seven days must not be expired by a sweep that ran an hour
// earlier and did not know about it. `decideExpire` reads `validUntil`; this is what moves it.
const JOB_ID = 'freeze_budget_sweep' as SystemJobId

export async function runUnfreezeSweep(): Promise<void> {
  const database = db()
  const deps = { repo: new FirestoreEntitlementRepository(database), clock: systemClock }

  for (const sid of await listStudioIds(database)) {
    const summary = await runFreezeBudgetSweep(
      deps,
      systemTenantContext(sid, JOB_ID),
      systemClock.now(),
      DEFAULT_STUDIO_CONFIG.utcOffsetMinutes,
    )
    if (summary.unfrozen > 0) {
      // Loud, because a member's membership just moved without her asking. It is correct, it is what
      // she bought — and the owner should be able to see it happen.
      logger.info('freeze budget sweep', { studioId: sid, ...summary })
    }
  }
}
