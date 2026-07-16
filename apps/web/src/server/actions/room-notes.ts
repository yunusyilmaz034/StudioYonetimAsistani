'use server'

import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// ── Salon Notları (Room Notes) — a LIGHTWEIGHT operational annotation ─────────────────────────
//
// A room note is reception's whiteboard: "Reformer 3 arızalı, kullanmayın", "Salon B bugün
// 14:00–16:00 bakımda". It is NOT a credit/money/attendance event — it changes no domain state and
// affects no decision the ledger records — so it deliberately lives OUTSIDE the event-sourced core
// (owner-approved, 2026-07-15). It is a plain studio-scoped state collection written directly by a
// trusted Server Action; open (active=true) and resolve (active=false) are its only transitions.
//
// Reception writes and resolves; it is desk-readable and never client-writable (the rules catch-all
// already denies client writes — every write here goes through the Admin SDK).

const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const nonEmpty = z.string().trim().min(1)

export interface RoomNote {
  readonly id: string
  readonly roomId: string
  readonly roomName: string
  readonly branchId: string
  readonly text: string
  /** Optional maintenance window (epoch-ms). null → an open-ended note. */
  readonly startsAt: number | null
  readonly endsAt: number | null
  readonly active: boolean
  readonly createdAt: number
  readonly authorId: string
  readonly resolvedAt: number | null
}

function notesCol(studioId: string) {
  return adminDb().collection('studios').doc(studioId).collection('roomNotes')
}

function toNote(id: string, d: FirebaseFirestore.DocumentData): RoomNote {
  return {
    id,
    roomId: String(d.roomId ?? ''),
    roomName: String(d.roomName ?? ''),
    branchId: String(d.branchId ?? ''),
    text: String(d.text ?? ''),
    startsAt: typeof d.startsAt === 'number' ? d.startsAt : null,
    endsAt: typeof d.endsAt === 'number' ? d.endsAt : null,
    active: d.active === true,
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : 0,
    authorId: String(d.authorId ?? ''),
    resolvedAt: typeof d.resolvedAt === 'number' ? d.resolvedAt : null,
  }
}

// A note "shows" today if it is active and its window has not already passed.
function isShowing(n: RoomNote, now: number): boolean {
  return n.active && (n.endsAt === null || n.endsAt >= now)
}

export async function createRoomNoteAction(input: unknown) {
  const p = z
    .object({
      roomId: nonEmpty,
      text: nonEmpty,
      startsAt: z.number().int().nullable().optional(),
      endsAt: z.number().int().nullable().optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OPS)

  // Denormalise room name + branch from the room itself — the note must be attributable to a real
  // room, and the banner needs the name without a second read.
  const roomSnap = await adminDb().collection('studios').doc(ctx.studioId).collection('rooms').doc(p.roomId).get()
  if (!roomSnap.exists) return { ok: false as const, error: { code: 'room_not_found' } }
  const room = roomSnap.data()!

  const ref = notesCol(ctx.studioId).doc()
  await ref.set({
    roomId: p.roomId,
    roomName: String(room.name ?? ''),
    branchId: String(room.branchId ?? ''),
    text: p.text,
    startsAt: p.startsAt ?? null,
    endsAt: p.endsAt ?? null,
    active: true,
    createdAt: Date.now(),
    authorId: ctx.actor.id,
    resolvedAt: null,
  })
  return { ok: true as const, value: ref.id }
}

export async function resolveRoomNoteAction(input: unknown) {
  const p = z.object({ noteId: nonEmpty }).parse(input)
  const ctx = await requireTenantContext(OPS)
  await notesCol(ctx.studioId).doc(p.noteId).set({ active: false, resolvedAt: Date.now() }, { merge: true })
  return { ok: true as const }
}

/** Management list — recent notes (active + resolved), newest first. */
export async function listRoomNotesAction(): Promise<readonly RoomNote[]> {
  const ctx = await requireTenantContext(OPS)
  const snap = await notesCol(ctx.studioId).orderBy('createdAt', 'desc').limit(50).get()
  return snap.docs.map((d) => toNote(d.id, d.data()))
}

/** Banner list — active, not-yet-expired notes for a branch (or all branches if omitted). */
export async function listActiveRoomNotesAction(input?: unknown): Promise<readonly RoomNote[]> {
  const p = z.object({ branchId: z.string().optional() }).parse(input ?? {})
  const ctx = await requireTenantContext(OPS)
  const now = Date.now()
  const snap = await notesCol(ctx.studioId).where('active', '==', true).get()
  return snap.docs
    .map((d) => toNote(d.id, d.data()))
    .filter((n) => isShowing(n, now))
    .filter((n) => (p.branchId ? n.branchId === p.branchId : true))
    .sort((a, b) => b.createdAt - a.createdAt)
}
