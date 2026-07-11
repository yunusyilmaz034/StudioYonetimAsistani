import { Timestamp } from 'firebase-admin/firestore'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import * as logger from 'firebase-functions/logger'

import {
  ATTENDANCE_MARK,
  FirestoreReservationRepository,
  instant,
  markAttendance,
  systemClock,
  type ActorRef,
  type AttendanceMarkPayload,
  type CommandId,
  type StudioId,
} from '@studio/core'

import { commandTenantContext } from '../shared/context'
import { db } from '../shared/firebase'

// The offline write path (AD-35, Doc 3 §5). A client drops a whitelisted command in
// `/commands`; this applies it, emitting the permanent event(s) and moving the
// command's `status`. The command is applied AS the principal that wrote it — never
// `system` (non-negotiable #5). The whitelist is enforced twice: the security rules
// gate the create, and this dispatch table gates the apply.
//
// Idempotency (Firestore delivers at-least-once): the resolve transaction refuses a
// reservation that is no longer `booked`, so a redelivery can never consume a credit
// twice. A refusal of `reservation_not_open` therefore reads as "already resolved" —
// an idempotent success — not a failure; only a genuine domain refusal is `failed`.
export const onCommandCreated = onDocumentCreated(
  'studios/{sid}/commands/{cmdId}',
  async (event) => {
    const snap = event.data
    if (!snap) return
    const data = snap.data()
    if (!data || data.status !== 'pending') return

    const sid = event.params.sid as StudioId
    const commandId = snap.id as CommandId
    const actor = data.actor as ActorRef
    const occurredAt = instant((data.occurredAt as Timestamp).toMillis())
    const ctx = commandTenantContext(sid, actor)
    const deps = { repo: new FirestoreReservationRepository(db()), clock: systemClock }

    if (data.type === ATTENDANCE_MARK) {
      const payload = data.payload as AttendanceMarkPayload
      const res = await markAttendance(deps, ctx, {
        reservationId: payload.reservationId,
        outcome: payload.outcome,
        occurredAt,
        commandId,
      })
      if (res.ok || res.error.code === 'reservation_not_open') {
        await snap.ref.update({ status: 'applied' })
      } else {
        logger.warn('attendance.mark refused', { commandId, code: res.error.code })
        await snap.ref.update({ status: 'failed', failedReason: res.error.code })
      }
      return
    }

    logger.error('unknown command type', { commandId, type: data.type })
    await snap.ref.update({ status: 'failed', failedReason: 'unknown_command_type' })
  },
)
