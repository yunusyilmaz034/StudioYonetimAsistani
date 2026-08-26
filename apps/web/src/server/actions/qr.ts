'use server'

import {
  FirestoreCheckinRepository,
  FirestoreEntitlementRepository,
  FirestoreMemberRepository,
  FirestoreReservationRepository,
  FirestoreSchedulingRepository,
  FirestoreStudioHours,
  instant,
  localDateAt,
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
  void p.branchId // accepted for compatibility, resolved server-side
  return mintCheckInToken(ctx, memberId)
}

/**
 * WHICH BRANCH IS THIS TOKEN FOR — decided here, never by the caller.
 *
 * It used to be whatever the client sent, and on 2026-08-20 that broke check-in for everyone: a
 * member with no `homeBranchId` made the app fall back to the invented string `'main'`, the token
 * was signed for a branch that does not exist, reception's scanner sent the real one, and the
 * equality check below refused every scan as "QR kod geçersiz".
 *
 * The client had no business deciding this. It cannot know better than the server, and when it is
 * wrong the failure is silent — a perfectly valid signature over a meaningless claim.
 *
 * Resolution order: the member's own branch; else the studio's branch when it has exactly one. With
 * several branches and no home branch there is no honest answer, so it refuses rather than picking
 * one — a token minted for the wrong branch is the bug we are fixing.
 */
async function resolveMemberBranch(ctx: TenantContext, memberId: MemberId): Promise<string | null> {
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, memberId)
  if (member?.homeBranchId) return member.homeBranchId as string
  const snap = await adminDb().collection('studios').doc(ctx.studioId as string).collection('branches').get()
  const ids = snap.docs.map((d) => d.id)
  return ids.length === 1 ? (ids[0] as string) : null
}

// ctx-taking core, shared by the cookie Server Action and the Bearer member API (mobile app).
// It takes NO branch: the caller used to supply one and that is precisely what broke the door.
export async function mintCheckInToken(ctx: TenantContext, memberId: MemberId) {
  const branchId = await resolveMemberBranch(ctx, memberId)
  if (!branchId) return { ok: false as const, error: { code: 'branch_required' as const } }
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
// FITNESS SERBEST-GİRİŞ artık BURADA DEĞİL (2026-08-26). Tüketim `recordCheckIn`'in içine taşındı,
// çünkü kural bir kapıya değil odaya ait: bu dosyada yaşarken elle check-in ve turnike onu hiç
// çağırmıyordu ve sayaç haftalarca sıfırda kaldı. Ekranın göstereceği bilgi artık sonuçla geliyor.
export interface FitnessEntryInfo {
  readonly used: number
  readonly allowance: number
}

export async function checkInByQrAction(input: unknown) {
  const p = z.object({ token: z.string().min(1), branchId: z.string().min(1) }).parse(input)
  // `kiosk` is the wall tablet: this — verifying a signed QR and recording a check-in — is the ONE
  // write it may make. The check-in it records is stamped with a `device` actor, not a human's.
  const ctx = await requireTenantContext(['owner', 'receptionist', 'trainer', 'kiosk', 'platform_admin'])

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
    { repo: new FirestoreCheckinRepository(db), clock: systemClock, entries: new FirestoreEntitlementRepository(db), classes: new FirestoreReservationRepository(db) },
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
  const entry = res.value.fitnessEntry
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
  // The SAME resolution the token uses, so the screen can never show one branch while the code is
  // signed for another.
  return { studioId: ctx.studioId, branchId: await resolveMemberBranch(ctx, memberId) }
}

// ── Inverted flow (owner ask): the KIOSK displays a rotating QR, the MEMBER scans it to check in. ──
// The kiosk token carries `memberId: 'kiosk'` (a sentinel, never a real member) so it can never be
// mistaken for a member's own QR. It rotates like the member's, so a screenshot is useless after the TTL.
const KIOSK_SENTINEL = 'kiosk'

export async function mintKioskCheckInTokenAction(input: unknown) {
  const p = z.object({ branchId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(['owner', 'receptionist', 'trainer', 'kiosk', 'platform_admin'])
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
  const ctx = await requireTenantContext(['owner', 'receptionist', 'trainer', 'kiosk', 'platform_admin'])
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
    { repo: new FirestoreCheckinRepository(adminDb()), clock: systemClock, entries: new FirestoreEntitlementRepository(adminDb()), classes: new FirestoreReservationRepository(adminDb()) },
    ctx,
    { memberId, branchId: claims.branchId as BranchId, method: 'qr', occurredAt: systemClock.now(), commandId: null },
  )
  if (!res.ok) return res
  const entry = res.value.fitnessEntry
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
  // Everything up to a query, fragment or the next slash — then DECODED.
  //
  // A signed token is `memberId|branchId|exp|jti.signature`, so it contains PIPES, and the printed
  // sheet builds its URL with `encodeURIComponent` — which turns each one into `%7C`. The first
  // version of this matched `[A-Za-z0-9._~-]+`, stopped dead at the `%`, and handed the verifier the
  // word `poster`. It failed as "geçersiz kod" (2026-07-31) — a bug introduced by the fix for the
  // bug before it, and visible only against a real printed sheet.
  const m = /\/g\/([^/?#\s]+)/.exec(s)
  if (!m?.[1]) return s
  try {
    return decodeURIComponent(m[1])
  } catch {
    // A malformed escape is not a token. Hand it on and let the verifier refuse it by name.
    return m[1]
  }
}

// The member scanned one of the studio's QRs from HER OWN browser (the web portal). Same core as
// the mobile app's `/api/member/checkin`; the only difference is where her identity comes from —
// a session cookie here, a Bearer id-token there. Most of this studio's members were invited to the
// web portal and never installed the app, so without this the printed sheet only worked for the few
// who did (owner, 2026-07-31).
export async function memberScanCheckInAction(input: unknown) {
  const p = z.object({ token: z.string().min(1).max(2048) }).parse(input)
  const { ctx, memberId } = await requireMemberContext()
  return memberCheckInByToken(ctx, memberId, p.token)
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
    { repo: new FirestoreCheckinRepository(db), clock: systemClock, entries: new FirestoreEntitlementRepository(db), classes: new FirestoreReservationRepository(db) },
    ctx,
    { memberId, branchId: claims.branchId as BranchId, method: 'qr', occurredAt: systemClock.now(), commandId: null },
  )
  if (!res.ok) return res
  const entry = res.value.fitnessEntry
  const attendance = res.value.direction === 'in' ? await resolveAttendanceForCheckIn(ctx, memberId) : null
  return { ok: true as const, value: { branchId: claims.branchId, direction: res.value.direction, entry, attendance } }
}
