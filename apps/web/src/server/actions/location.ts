'use server'

import { z } from 'zod'

import { requireMemberContext } from '../auth'
import { adminDb } from '../firebase-admin'

// Check-in location — the owner wants a coarse "where was the member" signal around QR, for reports
// later. This file is where that lives, and it is built under three hard constraints:
//
//   1. It is NEVER an event. (Non-negotiable #6 + the immutability of the log.) A precise location
//      tied to a member is personal data; an event can never be edited or deleted, so location in an
//      event would make KVKK erasure impossible AND leak PII into the log. It goes to a SEPARATE,
//      MUTABLE, ERASABLE collection — `studios/{sid}/checkinLocations` — that a deletion request can
//      wipe with the rest of the member's identity.
//   2. It is consented. KVKK requires explicit consent for location; `locationConsent.granted` on the
//      member doc gates every write, checked here on the server, not only in the UI.
//   3. It is coarse. Coordinates are rounded to 2 decimals (~1.1 km) — enough for "which district",
//      never enough to point at a home. The browser permission prompt is a second, OS-level gate.
//
// Owner decision (2026-07): captured ONLY from the member's OWN phone (the portal QR screen). The
// reception tablet and the wall kiosk are the studio's fixed location — constant, so pointless.

const memberDoc = (studioId: string, memberId: string) =>
  adminDb().collection('studios').doc(studioId).collection('members').doc(memberId)

const locationCol = (studioId: string) =>
  adminDb().collection('studios').doc(studioId).collection('checkinLocations')

// KVKK consent — the member turns this on herself, in the portal. Off by default; nothing is captured
// until she opts in, and turning it off stops future capture (past pings are removed by an erasure).
export async function setLocationConsentAction(input: unknown): Promise<{ granted: boolean }> {
  const p = z.object({ granted: z.boolean() }).parse(input)
  const { ctx, memberId } = await requireMemberContext()
  await memberDoc(ctx.studioId, memberId).set(
    { locationConsent: { granted: p.granted, at: Date.now() } },
    { merge: true },
  )
  return { granted: p.granted }
}

export async function getLocationConsentAction(): Promise<{ granted: boolean }> {
  const { ctx, memberId } = await requireMemberContext()
  const snap = await memberDoc(ctx.studioId, memberId).get()
  const granted = Boolean(snap.get('locationConsent.granted'))
  return { granted }
}

const coarse = (n: number) => Math.round(n * 100) / 100

// A single coarse location ping, keyed to the member and the day. Best-effort: it refuses silently
// (returns `recorded: false`) if consent was withdrawn between the UI check and the call, so a stale
// client can never write past a "no". Never throws into the caller's flow.
export async function recordCheckinLocationAction(input: unknown): Promise<{ recorded: boolean }> {
  const p = z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracy: z.number().nonnegative().optional(),
    })
    .parse(input)
  const { ctx, memberId } = await requireMemberContext()

  const snap = await memberDoc(ctx.studioId, memberId).get()
  if (!snap.get('locationConsent.granted')) return { recorded: false }

  await locationCol(ctx.studioId)
    .doc()
    .set({
      memberId,
      lat: coarse(p.lat),
      lng: coarse(p.lng),
      ...(p.accuracy !== undefined ? { accuracyMeters: Math.round(p.accuracy) } : {}),
      source: 'member_qr',
      occurredAt: Date.now(),
    })
  return { recorded: true }
}
