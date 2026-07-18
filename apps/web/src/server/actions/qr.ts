'use server'

import {
  FirestoreCheckinRepository,
  FirestoreMemberRepository,
  FirestoreSchedulingRepository,
  recordCheckIn,
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
import { qrSigningSecret, qrVerificationSecrets } from '../secrets'

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
  return { ok: true as const, value: { memberId: claims.memberId, memberName: member.fullName } }
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
