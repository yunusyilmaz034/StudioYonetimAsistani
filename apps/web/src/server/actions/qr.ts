'use server'

import {
  decideConsumeEntry,
  entriesUsed,
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  instant,
  localDateAt,
  newCorrelationId,
  recordCheckIn,
  resolveOnCheckIn,
  systemClock,
  type BranchId,
  type MemberId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { z } from 'zod'

import { requireMemberContext, requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { newJti, signQrToken, verifyQrToken } from '../qr-token'
import { reservationPolicyPort } from '../reservation-policy'
import { qrSigningSecret, qrVerificationSecrets } from '../secrets'

const reservationsDeps = () => ({
  repo: new FirestoreReservationRepository(adminDb()),
  clock: systemClock,
  hours: new FirestoreStudioHours(adminDb()),
  policy: reservationPolicyPort(),
})

// D10/D15/D16 — the check-in QR.
//
// **What this replaces, and why.** Until v1.21 the QR encoded the raw `memberId` (Doc 15 · D1):
// a bearer credential with no expiry. That was defensible while only reception could scan — the
// human at the desk was the authentication. The moment a member can see her own QR on her own
// phone, she can screenshot it and send it to a friend, who then walks in as her, forever. This
// milestone creates that threat, so this milestone closes it.
//
// The replacement:
//   • a SHORT-LIVED (60 s), server-SIGNED token — HMAC-SHA256 over `memberId|branchId|exp|jti`
//   • verified server-side: signature, expiry, member, branch, and **not already used**
//   • single-use: the jti is burned in a transaction, so a screenshot is worthless a second time
//   • ONLINE-ONLY (D16). No offline validation, no "verify later with a long TTL" — a token
//     whose expiry is checked ten minutes after the scan is not a short-lived token; it is a
//     long-lived one wearing a costume. Without internet, reception falls back to MANUAL member
//     search, which still runs on the offline /commands path, untouched.
//
// The `memberId` in a scanned string is never trusted. It comes out of a verified signature.

// The token's life, and how early she may check in. DATA, from the settings screen (v1.27 S2) —
// never a literal. The fallbacks are what a studio gets before its owner has opened the settings,
// and they are the values the studio ran on until today.
const DEFAULT_TTL_SECONDS = 60

async function qrTtlSeconds(ctx: TenantContext): Promise<number> {
  const settings = await new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx)
  return settings?.qr?.tokenTtlSeconds ?? DEFAULT_TTL_SECONDS
}

// ── Member: mint her own QR ───────────────────────────────────────────────────────────────
// She gets a token for HERSELF — the memberId comes from the cookie, not from a parameter. The
// portal refreshes it while the screen is open.
export async function mintCheckInTokenAction(input: unknown) {
  const p = z.object({ branchId: z.string().min(1) }).parse(input)
  const { ctx, memberId } = await requireMemberContext()
  return mintCheckInToken(ctx, memberId, p.branchId)
}

// ctx-taking core, shared by the cookie Server Action and the Bearer member API (mobile app).
export async function mintCheckInToken(ctx: TenantContext, memberId: MemberId, branchId: string) {
  const ttlSeconds = await qrTtlSeconds(ctx)
  const exp = Date.now() + ttlSeconds * 1000
  return {
    token: signQrToken({ memberId, branchId, exp, jti: newJti() }, qrSigningSecret()),
    expiresAt: exp,
    ttlSeconds,
  }
}

// ── Reception: scan and check in ──────────────────────────────────────────────────────────
// ONLINE-ONLY by design (D16). This is a Server Action, not a /commands write: a signature must
// be verified, and that cannot happen on a client or later in a trigger.
// EC3 (v1.27) — fitness serbest-giriş. On a door ENTRY (never an exit), if the member has a LIMITED
// fitness membership (and no unlimited fitness access), spend one entry — SOFT: never blocks the door,
// just records it so the toast/panel can show "3/4 kaldı". Returns the state to show, or null.
export interface FitnessEntryInfo {
  readonly used: number
  readonly allowance: number
}
async function consumeFitnessEntry(
  ctx: TenantContext,
  memberId: MemberId,
  checkInId: string,
  direction: 'in' | 'out',
): Promise<FitnessEntryInfo | null> {
  if (direction !== 'in') return null
  const entRepo = new FirestoreEntitlementRepository(adminDb())
  const fitness = (await entRepo.listActiveByMember(ctx, memberId)).filter((e) => e.productSnapshot.category === 'fitness')
  // No fitness membership, or ANY unlimited fitness access ⇒ nothing to spend.
  if (fitness.length === 0 || fitness.some((e) => (e.productSnapshot.entryAllowance ?? null) === null)) return null
  const target = [...fitness].sort((a, b) => a.validUntil - b.validUntil || a.purchasedAt - b.purchasedAt || (a.id < b.id ? -1 : 1))[0]
  if (!target) return null
  const decided = decideConsumeEntry(
    { studioId: ctx.studioId, actor: ctx.actor, now: systemClock.now(), correlationId: newCorrelationId(), source: 'reception_web', commandId: null },
    target,
    checkInId,
  )
  if (!decided.ok) return null
  await entRepo.saveEntitlement(ctx, decided.value.next, decided.value.events)
  return { used: entriesUsed(decided.value.next.entryLedger), allowance: target.productSnapshot.entryAllowance ?? 0 }
}

export async function checkInByQrAction(input: unknown) {
  const p = z.object({ token: z.string().min(1), branchId: z.string().min(1) }).parse(input)
  // `kiosk` is the wall tablet: this — verifying a signed QR and recording a check-in — is the ONE
  // write it may make. The check-in it records is stamped with a `device` actor, not a human's.
  const ctx = await requireTenantContext(['owner', 'receptionist', 'kiosk', 'platform_admin'])

  const claims = verifyQrToken(p.token, qrVerificationSecrets())
  if (!claims) return { ok: false as const, error: { code: 'qr_invalid' as const } }
  if (Date.now() > claims.exp) return { ok: false as const, error: { code: 'qr_expired' as const } }
  if (claims.branchId !== p.branchId) return { ok: false as const, error: { code: 'qr_invalid' as const } }

  const db = adminDb()

  // The member must exist. (The old path never checked: a scanned string that was not a real
  // member id was written as a check-in for a member who did not exist.)
  const member = await new FirestoreMemberRepository(db).findById(ctx, claims.memberId as MemberId)
  if (!member || member.status !== 'active') return { ok: false as const, error: { code: 'qr_invalid' as const } }

  // Single use: burn the jti, transactionally. A screenshot re-scanned inside the 60 s window
  // finds it spent.
  const jtiRef = db.collection('studios').doc(ctx.studioId).collection('qrTokens').doc(claims.jti)
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(jtiRef)
      if (snap.exists) throw new Error('qr_used')
      tx.set(jtiRef, { usedAt: new Date(claims.exp), memberId: claims.memberId })
    })
  } catch {
    return { ok: false as const, error: { code: 'qr_used' as const } }
  }

  const res = await recordCheckIn(
    { repo: new FirestoreCheckinRepository(db), clock: systemClock },
    ctx,
    {
      memberId: claims.memberId as MemberId,
      branchId: claims.branchId as BranchId,
      method: 'qr',
      occurredAt: systemClock.now(), // online-only: domain time IS now
      commandId: null, // no command caused this — it is a synchronous, verified write
    },
  )
  if (!res.ok) return res
  const entry = await consumeFitnessEntry(ctx, claims.memberId as MemberId, res.value.checkInId, res.value.direction)
  // Every ENTRY through this door is the same evidence, whoever held the scanner (see
  // `resolveAttendanceForCheckIn`). Reception scanning her phone says no less about where she is
  // than her scanning the wall.
  const attendance =
    res.value.direction === 'in' ? await resolveAttendanceForCheckIn(ctx, claims.memberId as MemberId) : null
  return { ok: true as const, value: { memberId: claims.memberId, memberName: member.fullName, direction: res.value.direction, entry, attendance } }
}

// The branch her QR is minted for. A member has no branch claim, so it comes from her record.
export async function qrStudioBranchAction(): Promise<{ studioId: StudioId; branchId: string | null }> {
  const { ctx, memberId } = await requireMemberContext()
  return qrStudioBranch(ctx, memberId)
}

export async function qrStudioBranch(ctx: TenantContext, memberId: MemberId): Promise<{ studioId: StudioId; branchId: string | null }> {
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, memberId)
  return { studioId: ctx.studioId, branchId: member?.homeBranchId ?? null }
}

// ── Inverted flow (owner ask): the KIOSK displays a rotating QR, the MEMBER scans it to check in. ──
// The kiosk token carries `memberId: 'kiosk'` (a sentinel, never a real member) so it can never be
// mistaken for a member's own QR. It rotates like the member's, so a screenshot is useless after the TTL.
const KIOSK_SENTINEL = 'kiosk'

export async function mintKioskCheckInTokenAction(input: unknown) {
  const p = z.object({ branchId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(['owner', 'receptionist', 'kiosk', 'platform_admin'])
  const ttlSeconds = await qrTtlSeconds(ctx)
  const exp = Date.now() + ttlSeconds * 1000
  return {
    token: signQrToken({ memberId: KIOSK_SENTINEL, branchId: p.branchId, exp, jti: newJti() }, qrSigningSecret()),
    expiresAt: exp,
    ttlSeconds,
  }
}

// ── The PRINTED daily QR (owner ask, 2026-07-27) ─────────────────────────────────────────────
//
// There is no tablet at the desk yet, and buying one to record attendance is the wrong order of
// spending. So the QR moves off a screen and onto a sheet of A4 taped to the wall: reception prints
// it each morning, the member scans it with her own phone camera, and the check-in lands.
//
// This token is unlike every other one in this file, and the differences are deliberate:
//
//   • it lives for a DAY, not sixty seconds — a printed page cannot rotate every minute
//   • it is NOT single-use — it is meant to be scanned by everyone who walks in
//
// Both of those weaken it, and the owner accepted that trade with the reasoning that matters: the
// thing being protected is an attendance record in a small studio, not a door lock. What remains:
//
//   • it is still SIGNED, so only this server can mint one
//   • it expires at the end of the studio day, so yesterday's photograph is worthless — which is the
//     whole reason the sheet is reprinted daily rather than laminated once
//   • the SCANNER must be a signed-in member: the poster identifies the studio, never the person.
//     A photo of it lets someone check THEMSELVES in from home; it never lets them check in anyone
//     else, and it never reveals who else came.
//
// The studio and the day are inside the signature (via the jti), so a poster cannot be replayed at
// another studio or on another date even by someone holding a valid signature.
const POSTER_SENTINEL = 'poster'
const ISTANBUL_OFFSET_MIN = 180

/** The signed sheet for one branch on one studio-local day. Deterministic: reprinting is free.
 *  NOT exported: every export of a `'use server'` module must be an async Server Action, and this
 *  is a pure codec. `posterTokenAction` below is the door. */
function posterToken(studioId: string, branchId: string, at: number): { token: string; day: string; validUntil: number } {
  const day = localDateAt(instant(at), ISTANBUL_OFFSET_MIN) as string
  // Midnight at the end of that local day. Istanbul has no DST, so fixed-offset arithmetic is exact.
  const validUntil = (Math.floor((at + ISTANBUL_OFFSET_MIN * 60_000) / 86_400_000) + 1) * 86_400_000 - ISTANBUL_OFFSET_MIN * 60_000
  return {
    token: signQrToken(
      { memberId: POSTER_SENTINEL, branchId, exp: validUntil, jti: `poster-${studioId}-${day}` },
      qrSigningSecret(),
    ),
    day,
    validUntil,
  }
}

/** Reception's print screen asks for today's sheet. Read-only — minting a poster changes nothing.
 *  The studio's own name rides along so the printed page can carry it without the page component
 *  reaching for a database (repositories live behind the server layer, never in a route file). */
export async function posterTokenAction() {
  const ctx = await requireTenantContext(['owner', 'receptionist', 'kiosk', 'platform_admin'])
  const branchId = ctx.branchIds[0]
  if (!branchId) return { ok: false as const, error: { code: 'branch_required' as const } }
  const settings = await new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx).catch(() => null)
  const { token, day, validUntil } = posterToken(ctx.studioId, branchId, Date.now())
  return {
    ok: true as const,
    value: {
      token,
      day,
      validUntil,
      studioId: ctx.studioId as string,
      studioName: settings?.company?.displayName || settings?.company?.legalName || 'Stüdyo',
    },
  }
}

// The member scanned the printed sheet. Verified, day-bounded, studio-bounded — and NOT jti-burned,
// because a wall poster is shared by everyone who walks in. Her identity comes from her session, so
// the poster only ever answers "which studio and which day", never "who".
export async function checkInByPosterToken(ctx: TenantContext, memberId: MemberId, token: string) {
  const claims = verifyQrToken(token, qrVerificationSecrets())
  if (!claims || claims.memberId !== POSTER_SENTINEL) return { ok: false as const, error: { code: 'qr_invalid' as const } }
  const day = localDateAt(instant(Date.now()), ISTANBUL_OFFSET_MIN) as string
  // The jti carries the studio and the day. Checking it here is what stops yesterday's sheet and
  // another studio's sheet, independently of the clock check below.
  if (claims.jti !== `poster-${ctx.studioId}-${day}`) return { ok: false as const, error: { code: 'qr_expired' as const } }
  if (Date.now() > claims.exp) return { ok: false as const, error: { code: 'qr_expired' as const } }

  const res = await recordCheckIn(
    { repo: new FirestoreCheckinRepository(adminDb()), clock: systemClock },
    ctx,
    { memberId, branchId: claims.branchId as BranchId, method: 'qr', occurredAt: systemClock.now(), commandId: null },
  )
  if (!res.ok) return res
  const entry = await consumeFitnessEntry(ctx, memberId, res.value.checkInId, res.value.direction)
  const attendance = res.value.direction === 'in' ? await resolveAttendanceForCheckIn(ctx, memberId) : null
  return { ok: true as const, value: { direction: res.value.direction, entry, attendance } }
}

// ── Turning a door scan into an attendance mark (owner ask, 2026-07-27) ───────────────────────
//
// "A member who scanned and has a class is at that class — this is a small studio, nobody wanders
// around inside." True operationally, so the studio should not wait for the nightly sweep to say it.
//
// What is NOT true is that this is an observation. Nobody watched her take the class, so the core
// writes `reservation.auto_resolved` with `source: 'member_checkin'` — the same event the sweep
// writes, distinguishable forever by the evidence behind it (AD-38, #11).
//
// BEST-EFFORT, always. She is through the door whatever happens here; a failure to resolve leaves
// the reservation exactly where the sweep expects to find it tonight.
export interface CheckInAttendance {
  readonly sessionStartsAt: number
  readonly creditConsumed: boolean
}
async function resolveAttendanceForCheckIn(ctx: TenantContext, memberId: MemberId): Promise<CheckInAttendance | null> {
  try {
    const settings = await new FirestoreSchedulingRepository(adminDb()).getStudioSettings(ctx)
    const done = await resolveOnCheckIn(reservationsDeps(), ctx, {
      memberId,
      at: systemClock.now(),
      // Studio data (v1.27 S2), never a literal here. The fallback is the arrival habit this studio
      // already runs on — members turn up a few minutes before, not an hour.
      arriveWithinMinutes: settings?.qr?.checkInWindowMinutes ?? DEFAULT_ARRIVE_WITHIN_MINUTES,
    })
    return done ? { sessionStartsAt: done.sessionStartsAt, creditConsumed: done.creditConsumed } : null
  } catch {
    // The door is not held open by the attendance ledger. The sweep is the safety net it always was.
    return null
  }
}

const DEFAULT_ARRIVE_WITHIN_MINUTES = 45

/**
 * A scanned string → the token inside it.
 *
 * The kiosk shows a bare token; the printed daily sheet shows a URL — `…/g/<token>` — because a
 * member without the app opens it in her phone's browser. Her camera hands the app whatever the code
 * actually contains, so the app sends a URL and the server used to reject it.
 */
function tokenFromScan(raw: string): string {
  const s = raw.trim()
  const m = /\/g\/([A-Za-z0-9._~-]+)/.exec(s)
  return m?.[1] ?? s
}

// The member scanned one of the studio's QRs — check HER (from her session) in at that branch.
//
// ── One scanner, both codes (owner, 2026-07-31) ──────────────────────────────────────────────
//
// This studio has two: the kiosk's rotating single-use token, and the daily sheet printed for
// reception. They are different by design — one is burned after a single use, the other is valid all
// day for everyone — but a member does not know that. She opens the app, points it at the QR in
// front of her, and expects to be let in.
//
// Pointing it at the printed sheet answered "Geçersiz ya da kullanılmış kod", which is both useless
// and, from where she is standing, untrue: the code is neither invalid nor used. So the kiosk token
// is tried first and the poster second, and only if BOTH refuse does she see an error.
export async function memberCheckInByToken(ctx: TenantContext, memberId: MemberId, scanned: string) {
  const token = tokenFromScan(scanned)
  const claims = verifyQrToken(token, qrVerificationSecrets())
  // Not a kiosk code — try the printed sheet before giving up on her.
  if (!claims || claims.memberId !== KIOSK_SENTINEL) return checkInByPosterToken(ctx, memberId, token)
  if (Date.now() > claims.exp) return { ok: false as const, error: { code: 'qr_expired' as const } }
  const db = adminDb()
  const jtiRef = db.collection('studios').doc(ctx.studioId).collection('qrTokens').doc(claims.jti)
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(jtiRef)
      if (snap.exists) throw new Error('qr_used')
      tx.set(jtiRef, { usedAt: new Date(claims.exp), memberId })
    })
  } catch {
    return { ok: false as const, error: { code: 'qr_used' as const } }
  }
  const res = await recordCheckIn(
    { repo: new FirestoreCheckinRepository(db), clock: systemClock },
    ctx,
    { memberId, branchId: claims.branchId as BranchId, method: 'qr', occurredAt: systemClock.now(), commandId: null },
  )
  if (!res.ok) return res
  const entry = await consumeFitnessEntry(ctx, memberId, res.value.checkInId, res.value.direction)
  const attendance = res.value.direction === 'in' ? await resolveAttendanceForCheckIn(ctx, memberId) : null
  return { ok: true as const, value: { branchId: claims.branchId, direction: res.value.direction, entry, attendance } }
}
