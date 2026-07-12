'use server'

import { createHash, randomBytes } from 'node:crypto'

import {
  completeActivation,
  FirestoreMemberRepository,
  issueMemberInvite,
  normalizePhone,
  recordPortalLogin,
  resolveInvite,
  systemClock,
  type MemberId,
  type MembersDeps,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { z } from 'zod'

import { requireMemberContext, requireTenantContext } from '../auth'
import { adminAuth, adminDb } from '../firebase-admin'

// v1.21 Batch 5 — invite, activation, member login.
//
// The rules that shape this file:
//   • The RAW token exists in exactly one place: the link reception copies into WhatsApp. We
//     store only its SHA-256, and it never enters an event (a secret in an append-only log is
//     unrecoverable).
//   • Every invite failure — unknown, expired, spent, wrong studio — collapses to ONE error.
//     A prober must not learn which.
//   • Reception NEVER sets a password. The member does, through the link.
//   • A member's Firebase uid is NOT her memberId (see member-claims.ts), so she can never
//     satisfy the /commands rule (`actor.id == request.auth.uid`).

const deps = (): MembersDeps => ({
  repo: new FirestoreMemberRepository(adminDb()),
  clock: systemClock,
})

const OPS = ['owner', 'receptionist', 'platform_admin'] as const

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

// A member logs in with her PHONE. Firebase Auth needs an email-shaped username, so we derive a
// synthetic one from the normalised phone (AD-40 makes it total and unique). She never sees it.
const loginIdentifier = (phoneNormalized: string, studioId: string): string =>
  `${phoneNormalized}@${studioId}.members.local`

// Her Firebase uid is DERIVED from her memberId, so the account can be found again without a
// lookup table — but it is not the memberId itself.
const firebaseUidForMember = (studioId: StudioId, memberId: MemberId): string =>
  `mbr_${createHash('sha256').update(`${studioId}:${memberId}`).digest('hex').slice(0, 24)}`

// The invite flow runs BEFORE the member has an identity, so it cannot use a member context.
// This context grants no staff powers: repositories use `studioId` only, to build paths.
const inviteCtx = (studioId: StudioId): TenantContext => ({
  studioId,
  branchIds: [],
  role: 'member',
  actor: { type: 'system', id: 'sys_portal_invite' as never },
})

// ── Staff: issue an invite ────────────────────────────────────────────────────────────────
// Returns the raw token ONCE; it is not retrievable afterwards. Losing it means issuing a new
// one — which supersedes this one. That is also the password-reset path (D17).
export async function issueMemberInviteAction(input: unknown) {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OPS)

  const token = randomBytes(32).toString('base64url') // a bearer credential: CSPRNG, not a ULID
  const res = await issueMemberInvite(deps(), ctx, {
    memberId: p.memberId as MemberId,
    tokenHash: hashToken(token),
  })
  if (!res.ok) return res

  // Revoking her existing sessions is what turns "issue a new invite" into a real RESET (D17):
  // a 5-day session cookie would otherwise outlive the password change.
  try {
    await adminAuth().revokeRefreshTokens(firebaseUidForMember(ctx.studioId, p.memberId as MemberId))
  } catch {
    // No account yet — the common case on a first invite. Nothing to revoke.
  }

  return { ok: true as const, value: { token, expiresAt: res.value.expiresAt } }
}

// ── Public: open an invite link ───────────────────────────────────────────────────────────
// Not authenticated — the account does not exist yet. Returns only the first name, so the
// screen can greet her; never her phone, never anything else.
export async function openInviteAction(input: unknown) {
  const p = z.object({ studioId: z.string().min(1), token: z.string().min(1) }).parse(input)
  const ctx = inviteCtx(p.studioId as StudioId)

  const res = await resolveInvite(deps(), ctx, hashToken(p.token))
  if (!res.ok) return { ok: false as const, error: res.error }

  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, res.value.memberId)
  if (!member || member.status !== 'active') {
    return { ok: false as const, error: { code: 'invite_invalid' as const } }
  }
  return { ok: true as const, value: { displayName: member.fullName.split(' ')[0] ?? '' } }
}

// ── Public: set the password and activate ─────────────────────────────────────────────────
export async function activateMemberAction(input: unknown) {
  const p = z
    .object({ studioId: z.string().min(1), token: z.string().min(1), password: z.string() })
    .parse(input)

  if (p.password.length < 8) return { ok: false as const, error: { code: 'weak_password' as const } }

  const ctx = inviteCtx(p.studioId as StudioId)
  const resolved = await resolveInvite(deps(), ctx, hashToken(p.token))
  if (!resolved.ok) return { ok: false as const, error: resolved.error }

  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, resolved.value.memberId)
  if (!member || member.status !== 'active') {
    return { ok: false as const, error: { code: 'invite_invalid' as const } }
  }

  const uid = firebaseUidForMember(ctx.studioId, member.id)
  const email = loginIdentifier(member.phoneNormalized, ctx.studioId)

  // Create the account, or set a new password on an existing one — the reset path (D17) lands
  // here too. One code path, fewer ways to be wrong.
  try {
    await adminAuth().updateUser(uid, { email, password: p.password })
  } catch {
    await adminAuth().createUser({ uid, email, password: p.password })
  }
  await adminAuth().setCustomUserClaims(uid, {
    studioId: ctx.studioId,
    role: 'member',
    memberId: member.id,
  })

  // Consume the invite + append `member.portal_activated` atomically, as HER (actor: member).
  const memberCtx: TenantContext = {
    studioId: ctx.studioId,
    branchIds: [],
    role: 'member',
    actor: { type: 'member', id: member.id },
  }
  const done = await completeActivation(deps(), memberCtx, resolved.value)
  if (!done.ok) return done

  return { ok: true as const, value: { email } }
}

// ── Public: phone → login identifier, for the member login form ───────────────────────────
// The phone is normalised HERE (AD-40: total, or the input is rejected) — the client must not
// import the core barrel, which would drag firebase-admin into the browser bundle.
// It reveals nothing: the identifier is derived from the phone the caller already typed.
export async function memberLoginIdentifierAction(input: unknown) {
  const p = z.object({ studioId: z.string().min(1), phone: z.string().min(1) }).parse(input)
  const normalized = normalizePhone(p.phone)
  if (!normalized.ok) return { ok: false as const, error: { code: 'invalid_phone' as const } }
  return {
    ok: true as const,
    value: { email: loginIdentifier(normalized.value.normalized, p.studioId) },
  }
}

// ── Member: record the login ──────────────────────────────────────────────────────────────
export async function recordPortalLoginAction() {
  const { ctx, memberId } = await requireMemberContext()
  await recordPortalLogin(deps(), ctx, memberId)
}
