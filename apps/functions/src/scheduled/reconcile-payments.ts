import * as logger from 'firebase-functions/logger'

import { FirestorePaymentIntentRepository, reconcilePayments, systemClock, type SystemJobId } from '@studio/core'

import { listStudioIds, systemTenantContext } from '../shared/context'
import { db } from '../shared/firebase'

// Payment reconciliation (Plus Phase 6, §22, actor: `system`). Times out abandoned checkouts and
// flags anything stuck mid-flight for a human — never edits money silently.
const JOB_ID = 'payment_reconcile_sweep' as SystemJobId

export async function runPaymentReconcileSweep(): Promise<void> {
  const database = db()
  const deps = { repo: new FirestorePaymentIntentRepository(database), clock: systemClock }
  const now = systemClock.now()

  for (const sid of await listStudioIds(database)) {
    const summary = await reconcilePayments(deps, systemTenantContext(sid, JOB_ID), now)
    if (summary.expired > 0 || summary.flagged > 0) logger.info('payment reconcile', { studioId: sid, ...summary })
    if (summary.flagged > 0) logger.warn('payments need manual review', { studioId: sid, flagged: summary.flagged })
  }
}
