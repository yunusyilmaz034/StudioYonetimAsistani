import { Timestamp } from 'firebase-admin/firestore'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import * as logger from 'firebase-functions/logger'

import {
  ATTENDANCE_MARK,
  CHECKIN_RECORD,
  FirestoreCheckinRepository,
  FirestoreReservationRepository,
  instant,
  markAttendance,
  recordCheckIn,
  systemClock,
  type ActorRef,
  type AttendanceMarkPayload,
  type CheckInRecordPayload,
  type CommandId,
  type StudioId,
} from '@studio/core'

import { commandTenantContext } from '../shared/context'
import { db } from '../shared/firebase'
import { REGION } from '../shared/region'

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
//
// ── v1.26: this handler MUST NOT THROW. ─────────────────────────────────────────────
// The repositories raise a plain Error when a referenced document is missing
// ("Reservation not found: …"), which is survivable on the synchronous path — the user
// sees a failure — and fatal on this one. An unhandled throw kills the function; Firestore
// redelivers at-least-once; it throws again. The command is then stuck in `pending`
// FOREVER, and the write it carried simply vanishes — which is exactly the check-in that
// reception never sees again (Doc 8, R6). A bad QR scan is enough to reach it.
//
// So every dispatch below runs inside `settle()`: a throw becomes `failed` with a reason,
// loudly logged, and the command is RESOLVED rather than retried into eternity. The
// trade-off is stated, not hidden: a genuinely transient infrastructure error would also
// land as `failed` instead of being retried. We accept it because the admin SDK already
// retries transient gRPC failures internally — an exception that escapes to here has
// almost certainly escaped its own retries, and is permanent. A poison message that never
// resolves is the worse failure, because nobody can even see it.
export const onCommandCreated = onDocumentCreated(
  { region: REGION, document: 'studios/{sid}/commands/{cmdId}' },
  async (event) => {
    const snap = event.data
    if (!snap) return
    const data = snap.data()
    if (!data || data.status !== 'pending') return

    const sid = event.params.sid as StudioId
    const commandId = snap.id as CommandId

    // Even WRITING THE OUTCOME must not be able to kill the handler: the command document may
    // be gone by the time we resolve it, and an `update()` on a missing document throws. A
    // handler that dies while recording a failure is the same poison message wearing a hat.
    const settle = async (status: 'applied' | 'failed', failedReason?: string) => {
      try {
        await snap.ref.update(failedReason ? { status, failedReason } : { status })
      } catch (err) {
        logger.error('could not settle command', { commandId, status, failedReason, err })
      }
    }
    const fail = (failedReason: string) => settle('failed', failedReason)

    // `/commands` is the ONLY client-writable collection, so a malformed document is not a
    // hypothetical: a missing `occurredAt` used to crash the handler on the line below and
    // poison the command forever. Malformed is REFUSED, and refusal is a resolution.
    const rawOccurredAt = data.occurredAt
    if (!(rawOccurredAt instanceof Timestamp)) {
      logger.error('malformed command: occurredAt is not a timestamp', { commandId, type: data.type })
      await fail('malformed_command')
      return
    }

    try {
      // Inside the guard, not above it: `actor` comes off a client-written document too, and
      // building the tenant context from a malformed one must refuse, never crash.
      const actor = data.actor as ActorRef
      const occurredAt = instant(rawOccurredAt.toMillis())
      const ctx = commandTenantContext(sid, actor)

      if (data.type === ATTENDANCE_MARK) {
        const payload = data.payload as AttendanceMarkPayload
        const res = await markAttendance(
          { repo: new FirestoreReservationRepository(db()), clock: systemClock },
          ctx,
          { reservationId: payload.reservationId, outcome: payload.outcome, occurredAt, commandId },
        )
        if (res.ok || res.error.code === 'reservation_not_open') {
          await settle('applied')
        } else {
          logger.warn('attendance.mark refused', { commandId, code: res.error.code })
          await fail(res.error.code)
        }
        return
      }

      if (data.type === CHECKIN_RECORD) {
        const payload = data.payload as CheckInRecordPayload
        const res = await recordCheckIn(
          { repo: new FirestoreCheckinRepository(db()), clock: systemClock },
          ctx,
          { memberId: payload.memberId, branchId: payload.branchId, method: payload.method, occurredAt, commandId },
        )
        if (res.ok) {
          await settle('applied')
        } else {
          logger.warn('checkIn.record refused', { commandId, code: res.error.code })
          await fail(res.error.code)
        }
        return
      }

      logger.error('unknown command type', { commandId, type: data.type })
      await fail('unknown_command_type')
    } catch (err) {
      // The repositories throw a plain Error for a missing document. Left unhandled it would
      // kill the function, be redelivered, and kill it again — the command stuck `pending`
      // forever and the write lost in silence. Resolve it instead, and be loud about it.
      logger.error('command handler threw — resolved as failed', {
        commandId,
        type: data.type,
        err,
      })
      await fail('handler_error')
    }
  },
)
