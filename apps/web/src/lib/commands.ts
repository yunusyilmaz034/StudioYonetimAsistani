import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { ulid } from 'ulid'

import type {
  ActorRef,
  AttendanceMarkPayload,
  AttendanceOutcome,
  ReservationId,
  StaffUserId,
} from '@studio/core'

import { clientAuth, clientDb } from './firebase-client'

// THE offline-safe write path (AD-35, Doc 3 §5). The client mints a prefixed-ULID
// command id — an offline-mintable idempotency key (AD-16) — and drops one `/commands`
// doc as itself. A trigger applies it within a second or two. The client NEVER writes
// state (non-negotiable #8): it writes an intent and reads the resolved reservation
// back. Attendance marking is the whole reservation command surface in Phase 1.
//
// `attendance.mark` is duplicated here as a literal on purpose — it is the contract
// string shared with the security-rule whitelist and core's `ATTENDANCE_MARK`. This
// module must NOT import the @studio/core barrel, which would pull firebase-admin into
// the browser bundle; only `import type` (fully erased at build) crosses that line.
const ATTENDANCE_MARK = 'attendance.mark'

export interface MarkAttendanceCommandInput {
  readonly reservationId: ReservationId
  readonly outcome: AttendanceOutcome
  // Domain time the mark happened; defaults to now. Offline callers may pass the
  // instant they recorded it — the trigger clamps it (never ahead of the server clock).
  readonly occurredAt?: number
}

// Write the command. Resolves when the doc is queued (offline: when the SDK accepts
// it locally); it does NOT wait for the trigger to apply it. The caller observes the
// outcome by reading the reservation, not this promise.
export async function markAttendanceCommand(input: MarkAttendanceCommandInput): Promise<void> {
  const user = clientAuth().currentUser
  if (!user) throw new Error('Not authenticated')

  const { studioId, role, platformAdmin } = (await user.getIdTokenResult()).claims as {
    studioId?: string
    role?: string
    platformAdmin?: boolean
  }
  if (!studioId) throw new Error('No studio claim on token')

  const actor = toActor(user.uid, role, platformAdmin)
  const id = `cmd_${ulid()}`
  const payload: AttendanceMarkPayload = { reservationId: input.reservationId, outcome: input.outcome }

  await setDoc(doc(clientDb(), 'studios', studioId, 'commands', id), {
    id,
    studioId,
    type: ATTENDANCE_MARK,
    actor,
    payload,
    status: 'pending',
    occurredAt: Timestamp.fromMillis(input.occurredAt ?? Date.now()),
    createdAt: serverTimestamp(),
  })
}

// The marking principal — never `system` (non-negotiable #5). Mirrors the server's
// claims → actor mapping (server/claims.ts).
function toActor(uid: string, role: string | undefined, platformAdmin: boolean | undefined): ActorRef {
  const id = uid as StaffUserId
  if (platformAdmin === true) return { type: 'platform_admin', id }
  if (role === 'owner' || role === 'receptionist' || role === 'trainer') {
    return { type: role, id }
  }
  throw new Error(`Unexpected role claim: ${role}`)
}
