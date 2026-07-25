'use server'

import { createHash, randomBytes } from 'node:crypto'

import {
  FirestoreMemberRepository,
  intentIdFor,
  issueMemberInvite,
  newCorrelationId,
  notify,
  systemClock,
  type MemberId,
  type MembersDeps,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminAuth, adminDb } from '../firebase-admin'
import { notificationDeps } from '../notification-deps'

// ── PORTAL ONBOARDING — inviting the EXISTING member base, in bulk. ─────────────────────────
//
// The studio migrated 119 members in before the portal existed, so every one of them has a package
// and none of them has an account. Inviting them one card at a time is not a workflow, it is a
// week of clicking — this screen is what makes the rollout possible at all.
//
// It reuses the SAME invite primitive as the single-member panel (`issueMemberInvite` + a CSPRNG
// token whose hash is all we store); the only thing that is new is doing it N times and reporting
// what happened to each one. Nothing here can send a message the desk did not ask for: the action
// is only ever called with an explicit list of member ids the operator selected.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

const deps = (): MembersDeps => ({ repo: new FirestoreMemberRepository(adminDb()), clock: systemClock })
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')
const firebaseUidForMember = (studioId: string, memberId: string): string =>
  `mbr_${createHash('sha256').update(`${studioId}:${memberId}`).digest('hex').slice(0, 24)}`

export type InviteState = 'never' | 'pending' | 'expired' | 'activated'

export interface InviteRow {
  readonly memberId: string
  readonly fullName: string
  readonly phone: string
  readonly state: InviteState
  readonly lastInvitedAt: number | null
  readonly hasActivePackage: boolean
}

// The desk's picture of the rollout: who has an account, who was invited and has not opened it,
// who was never asked. Derived from the INVITES, not from the member document — a member row says
// nothing about her portal account, and inventing a denormalised flag for it would be a field that
// can drift (Doc 3 §6). One studio-wide read of a tiny collection instead.
export async function listInviteStatusAction(): Promise<readonly InviteRow[]> {
  const ctx = await requireTenantContext(OPS)
  const repo = new FirestoreMemberRepository(adminDb())
  const now = systemClock.now()

  const [members, invites, entitlementsSnap] = await Promise.all([
    repo.list(ctx),
    repo.listInvites(ctx),
    adminDb().collection(`studios/${ctx.studioId}/entitlements`).where('status', '==', 'active').get(),
  ])

  const withPackage = new Set(entitlementsSnap.docs.map((d) => d.get('memberId') as string))

  // Latest invite per member wins: a resend supersedes the old one, and `consumed` beats everything
  // (once she has set a password the link's own state stops being interesting).
  const byMember = new Map<string, { state: InviteState; at: number }>()
  for (const inv of invites) {
    const state: InviteState =
      inv.status === 'consumed' ? 'activated' : inv.status === 'pending' ? (inv.expiresAt < now ? 'expired' : 'pending') : 'expired'
    const prev = byMember.get(inv.memberId as string)
    if (prev?.state === 'activated') continue
    if (!prev || state === 'activated' || inv.issuedAt > prev.at) byMember.set(inv.memberId as string, { state, at: inv.issuedAt })
  }

  return members
    .filter((m) => m.status === 'active')
    .map((m) => {
      const found = byMember.get(m.id as string)
      return {
        memberId: m.id as string,
        fullName: m.fullName,
        phone: m.phone as string,
        state: found?.state ?? ('never' as const),
        lastInvitedAt: found?.at ?? null,
        hasActivePackage: withPackage.has(m.id as string),
      }
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'tr'))
}

export interface InviteSendResult {
  readonly memberId: string
  readonly fullName: string
  readonly ok: boolean
  readonly reason: string | null
}

const MAX_PER_CALL = 25

// Send the invite to each selected member. Deliberately CHUNKED — the caller sends 25 at a time and
// renders progress, rather than one request that ties up a Server Action for two minutes and tells
// the operator nothing until it finishes (or times out mid-way, leaving her unable to tell who was
// reached).
export async function sendPortalInvitesAction(input: unknown): Promise<readonly InviteSendResult[]> {
  const p = z.object({ memberIds: z.array(z.string().min(1)).min(1).max(MAX_PER_CALL) }).parse(input)
  const ctx = await requireTenantContext(OPS)

  const base = (process.env.PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  if (!base) {
    return p.memberIds.map((id) => ({ memberId: id, fullName: '', ok: false, reason: 'Sunucu adresi tanımlı değil (PUBLIC_APP_URL).' }))
  }

  const repo = new FirestoreMemberRepository(adminDb())
  const results: InviteSendResult[] = []

  // Sequential on purpose: WhatsApp is rate-limited upstream, and a burst of 25 parallel sends is
  // how you get throttled mid-rollout with no idea which ones landed.
  for (const memberId of p.memberIds) {
    const member = await repo.findById(ctx, memberId as MemberId)
    if (!member) {
      results.push({ memberId, fullName: '', ok: false, reason: 'Üye bulunamadı.' })
      continue
    }

    try {
      const token = randomBytes(32).toString('base64url')
      const issued = await issueMemberInvite(deps(), ctx, { memberId: memberId as MemberId, tokenHash: hashToken(token) })
      if (!issued.ok) {
        results.push({ memberId, fullName: member.fullName, ok: false, reason: 'Üye aktif değil.' })
        continue
      }

      // A new invite supersedes her old link, so any session opened with the previous one has to go
      // (D17). Harmless on a first invite — she has no account yet.
      try {
        await adminAuth().revokeRefreshTokens(firebaseUidForMember(ctx.studioId, memberId))
      } catch {
        // No account yet — the common case here.
      }

      const res = await notify(notificationDeps(), ctx, {
        // Derived from the token hash: re-running the same selection after a partial failure
        // re-sends (a NEW token ⇒ a new intent id), but a double-click on the same batch does not.
        intentId: intentIdFor(hashToken(token).slice(0, 26), 'portal_invite', memberId),
        eventId: null,
        eventType: 'member.invited',
        operationId: newCorrelationId(),
        templateId: 'portal_invite',
        recipient: {
          kind: 'member',
          id: member.id as string,
          email: member.email ?? null,
          phone: member.phoneNormalized,
          displayName: member.fullName,
        },
        params: {
          memberName: member.fullName.split(' ')[0] ?? member.fullName,
          inviteLink: `${base}/invite/${encodeURIComponent(ctx.studioId)}/${token}`,
        },
        // The desk deliberately chose to send this, member by member, from a screen only staff can
        // open — the same standing this file's single-member sibling has. It is also the delivery of
        // access to a membership she has already paid for, not marketing.
        forceChannels: ['whatsapp', 'in_app'],
      })

      results.push(
        res.ok
          ? { memberId, fullName: member.fullName, ok: true, reason: null }
          : { memberId, fullName: member.fullName, ok: false, reason: TR_REASON[res.error.code] ?? res.error.code },
      )
    } catch (err) {
      results.push({ memberId, fullName: member.fullName, ok: false, reason: err instanceof Error ? err.message : 'Bilinmeyen hata' })
    }
  }

  return results
}

const TR_REASON: Record<string, string> = {
  template_not_found: 'Şablon bulunamadı.',
  template_inactive: 'Şablon kapalı.',
  daily_limit_reached: 'Günlük gönderim sınırına ulaşıldı.',
  template_params_missing: 'Şablon alanları eksik.',
  member_not_active: 'Üye aktif değil.',
}
