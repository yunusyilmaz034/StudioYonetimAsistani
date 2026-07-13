import { Timestamp } from 'firebase-admin/firestore'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import * as logger from 'firebase-functions/logger'

import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreProjectionRepository,
  instant,
  projectDaily,
  type StudioId,
  type SystemJobId,
} from '@studio/core'

import { systemTenantContext } from '../shared/context'
import { db } from '../shared/firebase'
import { REGION } from '../shared/region'
import { notifyForEvent, toEventLike } from './on-event-notify'

// ── onEventCreated → the daily read model (v1.23, D29). ─────────────────────────────────────
//
// The first projector in the system. It exists because counting cannot be done on read: "bugünkü
// rezervasyon" is a scan that gets slower every day the studio succeeds, while a counter
// incremented once at write time never does.
//
// Three properties, and each is a scar from a way this goes wrong elsewhere:
//
//   • **It reads the EVENT and nothing else.** Never a state document. A projector that reads
//     /members produces a number that cannot be rebuilt from the log — and a projection you cannot
//     rebuild is not a cache, it is a second source of truth you can never reconcile.
//
//   • **It is idempotent.** Firestore delivers at-least-once, so this WILL run twice on some event.
//     A double-counted booking is a *silently* wrong dashboard, which is worse than a broken one:
//     the marker doc and the counter move in the same transaction, so a redelivery is a no-op.
//
//   • **It never fails the write.** The event is already committed and permanent; the projection is
//     disposable. If this throws, we log it and move on — and `pnpm projections:rebuild` fixes it.
//     The reverse (a broken dashboard blocking a booking) would be indefensible.
export const onEventCreated = onDocumentCreated(
  { region: REGION, document: 'studios/{studioId}/events/{eventId}' },
  async (event) => {
    const data = event.data?.data()
    if (!data) return

    const studioId = event.params.studioId as StudioId
    const eventId = event.params.eventId
    const occurredAt = data.occurredAt instanceof Timestamp ? data.occurredAt.toMillis() : 0
    if (occurredAt === 0) return

    // ── v1.25 — the SECOND consumer: notifications. It runs downstream of the event and can never
    // fail it: a booking that fails because an e-mail bounced is an outage nobody signed up for.
    try {
      await notifyForEvent(studioId, toEventLike(eventId, data))
    } catch (err) {
      logger.error('notification dispatch failed', { eventId, err })
    }

    const inc = projectDaily(
      {
        type: data.type as string,
        occurredAt: instant(occurredAt),
        payload: (data.payload ?? {}) as Record<string, unknown>,
      },
      DEFAULT_STUDIO_CONFIG.utcOffsetMinutes,
    )
    // Most of the catalogue contributes nothing to the dashboard's numbers, and that is correct:
    // this is a dashboard, not an archive. The archive is /events.
    if (!inc) return

    try {
      const ctx = systemTenantContext(studioId, 'daily_projection' as SystemJobId)
      const applied = await new FirestoreProjectionRepository(db()).applyOnce(
        ctx,
        eventId,
        occurredAt,
        inc,
      )
      if (!applied) logger.debug('projection: redelivery ignored', { eventId })
    } catch (err) {
      // Loud in the log, silent to the caller. The projection can always be rebuilt; the event
      // cannot be un-written.
      logger.error('projection failed — rebuild will heal it', { eventId, err })
    }
  },
)
