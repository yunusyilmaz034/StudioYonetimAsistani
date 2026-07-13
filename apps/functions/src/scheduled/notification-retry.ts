import * as logger from 'firebase-functions/logger'

import { sweepRetries, type StudioId, type TenantContext } from '@studio/core'

import { db } from '../shared/firebase'
import { notificationDeps, studioNotificationSettings } from '../triggers/on-event-notify'

// The retry sweep, and the quiet-hour queue — which is the same mechanism seen from another angle.
// A queued LOW/NORMAL message waits for 08:00; a transient failure waits for its backoff. Both are
// `status: 'queued'` with a `nextRetryAt`, and both are released here.
//
// A PERMANENT failure is never picked up: an invalid address will still be invalid in an hour, and
// retrying it is a cost with no upside.
export async function runNotificationRetrySweep(): Promise<void> {
  // `listDocuments()`, not `get()`. A studio document that holds only sub-collections is a *missing*
  // document in Firestore — it has children but no fields, and `get()` does not return it. This sweep
  // would then skip that studio's queued messages entirely, and silently (the same defect fixed in
  // `health.ts`, v1.26 B3).
  const studios = await db().collection('studios').listDocuments()

  for (const studio of studios) {
    const studioId = studio.id as StudioId
    const ctx: TenantContext = {
      studioId,
      branchIds: [],
      role: 'owner',
      actor: { type: 'system', id: 'notification_retry' as never },
    }
    try {
      const { retried } = await sweepRetries(notificationDeps(await studioNotificationSettings(studioId)), ctx)
      if (retried > 0) logger.info('notification retries', { studioId, retried })
    } catch (err) {
      logger.error('notification retry sweep failed', { studioId, err })
    }
  }
}
