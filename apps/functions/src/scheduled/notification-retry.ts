import * as logger from 'firebase-functions/logger'

import { sweepRetries, type StudioId, type TenantContext } from '@studio/core'

import { db } from '../shared/firebase'
import { notificationDeps } from '../triggers/on-event-notify'

// The retry sweep, and the quiet-hour queue — which is the same mechanism seen from another angle.
// A queued LOW/NORMAL message waits for 08:00; a transient failure waits for its backoff. Both are
// `status: 'queued'` with a `nextRetryAt`, and both are released here.
//
// A PERMANENT failure is never picked up: an invalid address will still be invalid in an hour, and
// retrying it is a cost with no upside.
export async function runNotificationRetrySweep(): Promise<void> {
  const studios = await db().collection('studios').get()

  for (const studio of studios.docs) {
    const studioId = studio.id as StudioId
    const ctx: TenantContext = {
      studioId,
      branchIds: [],
      role: 'owner',
      actor: { type: 'system', id: 'notification_retry' as never },
    }
    try {
      const { retried } = await sweepRetries(notificationDeps(), ctx)
      if (retried > 0) logger.info('notification retries', { studioId, retried })
    } catch (err) {
      logger.error('notification retry sweep failed', { studioId, err })
    }
  }
}
