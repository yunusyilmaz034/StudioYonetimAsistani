import { Timestamp } from 'firebase-admin/firestore'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import * as logger from 'firebase-functions/logger'

import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreMemberRepository,
  FirestoreProjectionRepository,
  instant,
  memberActivityFromEvent,
  projectDaily,
  type StudioId,
  type SystemJobId,
} from '@studio/core'

import { systemTenantContext } from '../shared/context'
import { db } from '../shared/firebase'
import { NOTIFICATION_SECRETS, REGION } from '../shared/region'
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
  {
    region: REGION,
    document: 'studios/{studioId}/events/{eventId}',
    // Without this the e-mail provider silently degrades to the console (see `region.ts`).
    secrets: [...NOTIFICATION_SECRETS],
  },
  async (event) => {
    const data = event.data?.data()
    if (!data) return

    const studioId = event.params.studioId as StudioId
    const eventId = event.params.eventId
    const occurredAt = data.occurredAt instanceof Timestamp ? data.occurredAt.toMillis() : 0
    if (occurredAt === 0) return

    // The two timestamps do different jobs here, and swapping them breaks the alarm (see below):
    //   occurredAt  — domain time. WHICH DAY the event belongs to. May be client-supplied.
    //   recordedAt  — log time, `serverTimestamp()`. WHEN THE LOG ACCEPTED IT.
    const recordedAt = data.recordedAt instanceof Timestamp ? data.recordedAt.toMillis() : occurredAt

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
    // Most of the catalogue contributes nothing to the dashboard's NUMBERS — and it is still folded,
    // with an empty increment, so the projector's watermark advances. A projector that skips an event
    // cannot be told apart from a projector that has died, and `projection_lag` is the signal that has
    // to tell them apart (see `projectDaily`).
    try {
      const ctx = systemTenantContext(studioId, 'daily_projection' as SystemJobId)
      const applied = await new FirestoreProjectionRepository(db()).applyOnce(
        ctx,
        eventId,
        // `projection_lag` asks "is the projector keeping up with the LOG?" and compares the newest
        // `recordedAt` against this watermark. Writing domain time here compares two different clocks:
        // an offline check-in that syncs two hours late carries a two-hour-old `occurredAt`, and the
        // signal would report a two-hour lag on a projector that folded it the instant it arrived —
        // on the very day the offline path is used most. Log time in, log time out.
        recordedAt,
        inc,
      )
      if (!applied) logger.debug('projection: redelivery ignored', { eventId })
    } catch (err) {
      // Loud in the log, silent to the caller. The projection can always be rebuilt; the event
      // cannot be un-written.
      logger.error('projection failed — rebuild will heal it', { eventId, err })
    }

    // ── The THIRD consumer: member activity stats (Phase 2 · churn). member.checked_in and
    // reservation.attended move the member's recency (lastCheckInAt / lastAttendanceAt) forward, so the
    // dormancy signal can tell who has stopped coming. A MAX write — idempotent, order-safe, and (like
    // the projection) it NEVER fails the event and is rebuildable via `member-stats:rebuild`.
    try {
      const touch = memberActivityFromEvent({
        type: data.type as string,
        occurredAt: instant(occurredAt),
        related: (data.related ?? null) as { memberId?: string | null } | null,
      })
      if (touch) {
        const ctx = systemTenantContext(studioId, 'member_activity' as SystemJobId)
        await new FirestoreMemberRepository(db()).touchActivity(ctx, touch.memberId, touch.field, touch.at)
      }
    } catch (err) {
      logger.error('member activity update failed — rebuild will heal it', { eventId, err })
    }
  },
)
