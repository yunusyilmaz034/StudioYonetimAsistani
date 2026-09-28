import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { ulid } from 'ulid'

import type {
  ActorRef,
  AttendanceMarkPayload,
  AttendanceOutcome,
  BranchId,
  CheckInRecordPayload,
  MemberId,
  ReservationId,
  StaffUserId,
} from '@studio/core'

import { clientAuth, clientDb } from './firebase-client'

// Contract strings shared with the security-rule whitelist + core (see note below).
const CHECKIN_RECORD = 'checkIn.record'

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
  const user = await signedInUser()

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

// A check-in (QR scan or manual pick). Offline-safe, idempotent (Doc 3 §5). Applied by
// `on-command-created` as the receptionist (D2); a toggle — outside → in, inside → out.
export async function checkInCommand(input: {
  memberId: MemberId
  method: 'qr' | 'reception'
  /** Reception's labelled buttons say which; a QR scan leaves it out and keeps the toggle. */
  direction?: 'in' | 'out'
}): Promise<void> {
  const user = await signedInUser()

  const { studioId, role, branchIds, platformAdmin } = (await user.getIdTokenResult()).claims as {
    studioId?: string
    role?: string
    branchIds?: string[]
    platformAdmin?: boolean
  }
  if (!studioId) throw new Error('No studio claim on token')
  const branchId = branchIds?.[0]
  if (!branchId) throw new Error('No branch claim on token')

  const id = `cmd_${ulid()}`
  const payload: CheckInRecordPayload = {
    memberId: input.memberId,
    branchId: branchId as BranchId,
    method: input.method,
    ...(input.direction ? { direction: input.direction } : {}),
  }
  await setDoc(doc(clientDb(), 'studios', studioId, 'commands', id), {
    id,
    studioId,
    type: CHECKIN_RECORD,
    actor: toActor(user.uid, role, platformAdmin),
    payload,
    status: 'pending',
    occurredAt: Timestamp.fromMillis(Date.now()),
    createdAt: serverTimestamp(),
  })
}

// THE SIGNED-IN USER, AFTER THE SDK HAS FINISHED LOOKING FOR ONE.
//
// ── What happened (2026-09-28, reception could not check anyone out) ─────────────────────────
//
// Both commands used to read `clientAuth().currentUser` the instant they were called, and threw
// "Not authenticated" when it was null — which reception read as *"Oturumunuz düşmüş. Sayfayı
// yenileyip tekrar giriş yapın."* Her session had not dropped at all. `currentUser` is null for the
// first few hundred milliseconds of EVERY page load, while the SDK restores the session from
// IndexedDB; it is a race, not a logout. Press "Çıkış" inside that window and the write is refused;
// press it again a second later and it works. That is exactly the shape of the complaint — "birkaç
// defa yapınca düzeliyor" — and it was reported for two different members on the same morning.
//
// The window opens more often than it sounds: the panel reloads itself after every deployment
// (`version-watch`) and after a stale-tab failure, and reception starts pressing immediately.
//
// `authStateReady()` resolves once restoration has finished, so a null user after it means the
// session really is gone — and only then is the message true.
async function signedInUser() {
  const auth = clientAuth()
  await auth.authStateReady()
  const user = auth.currentUser
  if (!user) throw new Error('Not authenticated')
  return user
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
