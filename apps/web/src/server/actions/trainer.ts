'use server'

import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  setSessionNote,
  systemClock,
  type ClassSessionId,
  type SchedulingDeps,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { domainErrorMessage } from '@/lib/domain-error'
import { loadSchedule, type CalendarSession } from '../schedule-query'

// The trainer's data, and ONLY the trainer's data (v1.27 S1 · owner's permission matrix).
//
// ── The rule every function here obeys ──────────────────────────────────────────────────────
//   She sees her own classes and the NAMES of the women in them. Nothing else.
//   Not a phone number. Not a package. Not a balance. Not another trainer's roster.
//
// The ownership check is done HERE, on the server, on every call — because it is the only place it
// can be done. A Firestore rule cannot join a reservation to the trainer of its session, so any rule
// permissive enough to give her HER roster would give her EVERY roster. That is why she reads
// nothing directly (see `firestore.rules`: a trainer matches no read rule at all) and why these
// actions never take a trainer id from the caller: it comes from her verified session.

const TRAINER = ['owner', 'trainer', 'platform_admin'] as const

/** Her own — never a parameter. A trainer id arriving from a client is a trainer id somebody chose. */
const isMine = (session: CalendarSession, actorId: string): boolean => session.trainerId === actorId

export interface MyClass {
  readonly sessionId: string
  readonly serviceName: string
  readonly roomName: string | null
  readonly startsAt: number
  readonly endsAt: number
  readonly capacity: number
  readonly bookedCount: number
  readonly status: string
  /** How many of the register are still unmarked — the number that tells her what is left to do. */
  readonly pending: number
  /** The session's operational note (Phase 2 §4). The trainer reads AND writes her own here. */
  readonly note: string | null
}

/**
 * Her week. The owner may call this too (she may see every screen), and when she does she sees the
 * classes of whoever she is — which for an owner who teaches is exactly right, and for one who does
 * not is an empty week, honestly.
 */
export async function listMyClassesAction(input: unknown): Promise<readonly MyClass[]> {
  const p = z.object({ date: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)

  const schedule = await loadSchedule(ctx, p.date)
  const mine = schedule.sessions.filter((s) => isMine(s, ctx.actor.id as string))

  const reservations = new FirestoreReservationRepository(adminDb())
  return Promise.all(
    mine
      .sort((a, b) => a.startsAt - b.startsAt)
      .map(async (s) => {
        const roster = await reservations.listBySession(ctx, s.sessionId as ClassSessionId)
        return {
          sessionId: s.sessionId,
          serviceName: s.serviceName,
          roomName: s.roomName,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          capacity: s.capacity,
          bookedCount: s.bookedCount,
          status: s.status,
          // `booked` = nobody has said whether she came. That is the trainer's job, and this is the
          // count of it left undone.
          pending: roster.filter((r) => r.status === 'booked').length,
          note: s.note?.text ?? null,
        }
      }),
  )
}

function schedDeps(): SchedulingDeps {
  const db = adminDb()
  return {
    repo: new FirestoreSchedulingRepository(db),
    clock: systemClock,
    studioConfig: DEFAULT_STUDIO_CONFIG,
    hours: new FirestoreStudioHours(db),
  }
}

// The trainer writes the operational note for HER OWN class (Phase 2 §4). The session note is
// event-sourced (`class_session.note_set`, actor = the trainer, recordedAt = the time), so who wrote
// it and when are in the log — a past note is never silently overwritten, it is a new event. The
// visibility is 'staff': her note is for the studio's people (reception, owner, the trainer), never
// for members. Ownership is checked HERE — a trainer can only note a class that is hers.
export async function setMyClassNoteAction(input: unknown) {
  const p = z.object({ sessionId: z.string().min(1), date: z.string().min(1), text: z.string() }).parse(input)
  const ctx = await requireTenantContext(TRAINER)

  const schedule = await loadSchedule(ctx, p.date)
  const session = schedule.sessions.find((s) => s.sessionId === p.sessionId)
  if (!session || !isMine(session, ctx.actor.id as string)) {
    return { ok: false as const, error: 'Bu ders sizin değil.' }
  }

  const res = await setSessionNote(schedDeps(), ctx, {
    sessionId: p.sessionId as ClassSessionId,
    text: p.text,
    visibility: 'staff',
  })
  return res.ok ? { ok: true as const } : { ok: false as const, error: domainErrorMessage(res.error) }
}

export interface MyRosterEntry {
  readonly reservationId: string
  readonly memberId: string
  readonly memberName: string
  readonly status: string
}

/**
 * The register for ONE of her classes.
 *
 * It refuses a session that is not hers — not by hiding the button, but by refusing the read. The
 * session id is a guessable string, and a screen that only *hides* another trainer's roster is a
 * screen that hands it to anybody who types a different id into the URL.
 */
export async function getMyRosterAction(input: unknown): Promise<readonly MyRosterEntry[]> {
  const p = z.object({ sessionId: z.string().min(1), date: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(TRAINER)

  const schedule = await loadSchedule(ctx, p.date)
  const session = schedule.sessions.find((s) => s.sessionId === p.sessionId)

  // Not found, or not hers. The two are answered identically on purpose: telling her that a session
  // exists but belongs to somebody else is itself a small leak.
  if (!session || !isMine(session, ctx.actor.id as string)) return []

  const roster = await new FirestoreReservationRepository(adminDb()).listBySession(
    ctx,
    p.sessionId as ClassSessionId,
  )

  return roster
    .filter((r) => r.status !== 'cancelled' && r.status !== 'late_cancelled')
    .map((r) => ({
      reservationId: r.id,
      memberId: r.memberId,
      // The NAME, and nothing else. `memberSnapshot` also carries `phoneLast4`; she does not get it
      // (owner: "dersteki üyelerin ad soyad bilgisi" — a phone may come later, deliberately).
      memberName: r.memberSnapshot.displayName,
      status: r.status,
    }))
    .sort((a, b) => a.memberName.localeCompare(b.memberName, 'tr'))
}
