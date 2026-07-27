'use server'

import {
  DEFAULT_STUDIO_CONFIG,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  holdSeat,
  listHolds,
  releaseSeat,
  systemClock,
  type ClassSessionId,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// Holding a seat for a non-member (owner, 2026-07-27).
//
// Multisport day-visitors ask on WhatsApp whether there is room; reception puts a name against a
// seat. They are not members and must not be registered as such, so this deliberately does NOT go
// near the member list, the credit ledger, or a payment.
//
// A Server Action, not a `/commands` write, and not negotiable: this ALLOCATES A SCARCE RESOURCE.
// The whitelist rule is explicit that anything competing for a seat is decided synchronously by the
// server, or two people are told the same seat is theirs.
//
// Reception and the owner. Not the kiosk (it may only record check-ins) and not a member.
const DESK = ['owner', 'receptionist', 'platform_admin'] as const

const deps = () => ({
  repo: new FirestoreSchedulingRepository(adminDb()),
  clock: systemClock,
  studioConfig: DEFAULT_STUDIO_CONFIG,
  hours: new FirestoreStudioHours(adminDb()),
})

export async function holdSeatAction(input: unknown) {
  const p = z
    .object({
      sessionId: z.string().min(1),
      note: z.string().min(1).max(200),
      // Optional by the owner's instruction: some guests give a card number, most do not, and a
      // required field would be filled with junk by a receptionist who just needs the seat held.
      cardNumber: z.string().max(60).nullable().optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(DESK)
  return holdSeat(deps(), ctx, {
    classSessionId: p.sessionId as ClassSessionId,
    note: p.note,
    cardNumber: p.cardNumber ?? null,
  })
}

export async function releaseSeatAction(input: unknown) {
  const p = z.object({ holdId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(DESK)
  return releaseSeat(deps(), ctx, p.holdId)
}

export interface SeatHoldView {
  readonly id: string
  readonly note: string
  readonly cardNumber: string | null
  readonly heldAt: number
}

/** The seats currently held for one session — who each one is for. Staff-only, by the role gate. */
export async function listSeatHoldsAction(input: unknown): Promise<readonly SeatHoldView[]> {
  const p = z.object({ sessionId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(DESK)
  const holds = await listHolds(deps(), ctx, p.sessionId as ClassSessionId)
  return holds
    .map((h) => ({ id: h.id, note: h.note, cardNumber: h.cardNumber, heldAt: h.heldAt as number }))
    .sort((a, b) => a.heldAt - b.heldAt)
}
