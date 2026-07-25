'use server'

import { createHash, randomBytes } from 'node:crypto'

import {
  FirestoreMemberRepository,
  intentIdFor,
  issueMemberInvite,
  newCorrelationId,
  notify,
  render,
  systemClock,
  TEMPLATES,
  type MemberId,
  type MembersDeps,
  type NotificationTemplate,
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

// What KIND of package she holds — the axis the studio actually rolls out along ("önce fitness
// üyeleri, sonra pilates"). `hibrit` is not a category of its own in the catalogue: a bundle grants
// one entitlement PER COMPONENT, so a hybrid member shows up holding two categories at once. Both
// signals are honoured — the bundle's name and the two-category shape — because a member who bought
// pilates and fitness separately is, for the purpose of this screen, the same audience.
export type PackageKind = 'pilates' | 'fitness' | 'pt' | 'hibrit'

export interface InviteRow {
  readonly memberId: string
  readonly fullName: string
  readonly phone: string
  readonly state: InviteState
  readonly lastInvitedAt: number | null
  readonly hasActivePackage: boolean
  readonly packageKinds: readonly PackageKind[]
}

// Today's movement, in the studio's own timezone. The cumulative totals answer "where are we";
// these answer "did today go anywhere" — which is the question you actually have while a rollout is
// running, and the one a total can hide.
export interface InviteSummary {
  readonly rows: readonly InviteRow[]
  readonly todayInvited: number
  readonly todayActivated: number
  // Yesterday travels with today because the screen is read at all hours. At 00:44 "bugün 0" is
  // accurate and useless — the 51 invites sent four hours ago have simply become yesterday's, and a
  // panel that shows two zeroes looks broken rather than empty.
  readonly yesterdayInvited: number
  readonly yesterdayActivated: number
}

const TRT_OFFSET_MS = 3 * 60 * 60 * 1000
const startOfTodayTRT = (now: number): number => {
  const shifted = now + TRT_OFFSET_MS
  return shifted - (shifted % 86_400_000) - TRT_OFFSET_MS
}

// The desk's picture of the rollout: who has an account, who was invited and has not opened it,
// who was never asked. Derived from the INVITES, not from the member document — a member row says
// nothing about her portal account, and inventing a denormalised flag for it would be a field that
// can drift (Doc 3 §6). One studio-wide read of a tiny collection instead.
export async function listInviteStatusAction(): Promise<InviteSummary> {
  const ctx = await requireTenantContext(OPS)
  const repo = new FirestoreMemberRepository(adminDb())
  const now = systemClock.now()

  const [members, invites, entitlementsSnap] = await Promise.all([
    repo.list(ctx),
    repo.listInvites(ctx),
    adminDb().collection(`studios/${ctx.studioId}/entitlements`).where('status', '==', 'active').get(),
  ])

  const withPackage = new Set(entitlementsSnap.docs.map((d) => d.get('memberId') as string))

  // Category per member, from the entitlement's own snapshot — never from the live product, which
  // may have been renamed or recategorised since she bought it.
  const kindsByMember = new Map<string, Set<PackageKind>>()
  for (const d of entitlementsSnap.docs) {
    const memberId = d.get('memberId') as string
    const snap = (d.get('productSnapshot') ?? {}) as { category?: string; name?: string }
    const set = kindsByMember.get(memberId) ?? new Set<PackageKind>()
    if (snap.category === 'fitness') set.add('fitness')
    else if (snap.category === 'pilates_group') set.add('pilates')
    else if (snap.category === 'private') set.add('pt')
    if ((snap.name ?? '').toLocaleLowerCase('tr').includes('hibrit')) set.add('hibrit')
    kindsByMember.set(memberId, set)
  }
  // Two categories at once IS the hybrid shape, whatever the product was called.
  for (const set of kindsByMember.values()) {
    if (set.has('fitness') && set.has('pilates')) set.add('hibrit')
  }

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

  // Counted over the invites themselves, not the per-member roll-up: a member invited twice today is
  // one member but two sends, and "how many did we send today" is the send count.
  const todayStart = startOfTodayTRT(now)
  const yStart = todayStart - 86_400_000
  const todayInvited = invites.filter((i) => i.issuedAt >= todayStart).length
  const todayActivated = invites.filter((i) => i.status === 'consumed' && (i.consumedAt ?? 0) >= todayStart).length
  const yesterdayInvited = invites.filter((i) => i.issuedAt >= yStart && i.issuedAt < todayStart).length
  const yesterdayActivated = invites.filter(
    (i) => i.status === 'consumed' && (i.consumedAt ?? 0) >= yStart && (i.consumedAt ?? 0) < todayStart,
  ).length

  const rows = members
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
        packageKinds: [...(kindsByMember.get(m.id as string) ?? [])],
      }
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'tr'))

  return { rows, todayInvited, todayActivated, yesterdayInvited, yesterdayActivated }
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
          // Where she goes on every visit AFTER the invite is spent — the invite link is single-use.
          loginLink: `${base}/portal/login?s=${encodeURIComponent(ctx.studioId)}`,
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

// ── The MANUAL path: mint the invite, hand back the finished message. ───────────────────────
//
// This is how the rollout actually starts. The automated send above needs a Meta-approved template;
// this one needs nothing — the studio's own WhatsApp opens with the text already written and Işıl
// presses send. Same invite primitive, same wording (it renders the SAME `portal_invite` template,
// so editing the copy in Ayarlar changes both paths), but it is a person sending a person a message.
//
// It returns the text rather than a `wa.me` URL: composing the link is the browser's job, and the
// raw token must not sit in a server-built URL that could end up logged.
export async function prepareInviteMessageAction(
  input: unknown,
): Promise<{ ok: true; phone: string; text: string } | { ok: false; reason: string }> {
  const p = z.object({ memberId: z.string().min(1), reminder: z.boolean().optional() }).parse(input)
  const ctx = await requireTenantContext(OPS)

  const base = (process.env.PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  if (!base) return { ok: false as const, reason: 'Sunucu adresi tanımlı değil (PUBLIC_APP_URL).' }

  const repo = new FirestoreMemberRepository(adminDb())
  const member = await repo.findById(ctx, p.memberId as MemberId)
  if (!member) return { ok: false as const, reason: 'Üye bulunamadı.' }

  const token = randomBytes(32).toString('base64url')
  const issued = await issueMemberInvite(deps(), ctx, { memberId: p.memberId as MemberId, tokenHash: hashToken(token) })
  if (!issued.ok) return { ok: false as const, reason: 'Üye aktif değil.' }

  // A fresh invite supersedes her previous link, so any session opened with the old one must go (D17).
  try {
    await adminAuth().revokeRefreshTokens(firebaseUidForMember(ctx.studioId, p.memberId))
  } catch {
    // No account yet — the common case.
  }

  // The studio's own edit of the template wins over the code seed, exactly as the automated path does.
  const override = await adminDb().doc(`studios/${ctx.studioId}/notificationTemplates/portal_invite`).get()
  const template = (override.exists ? (override.data() as NotificationTemplate) : undefined) ?? TEMPLATES.portal_invite
  if (!template) return { ok: false as const, reason: 'Davet şablonu bulunamadı.' }

  const rendered = render(template, {
    memberName: member.fullName.split(' ')[0] ?? member.fullName,
    inviteLink: `${base}/invite/${encodeURIComponent(ctx.studioId)}/${token}`,
    // Where she goes on every visit AFTER the invite is spent — the invite link is single-use.
    loginLink: `${base}/portal/login?s=${encodeURIComponent(ctx.studioId)}`,
  })
  if (!rendered.ok) return { ok: false as const, reason: 'Şablon alanları eksik.' }

  // A reminder carries a FRESH link, not a "look at the message we sent you" nudge. She did not open
  // the first one — most likely she cannot find it — and pointing her at a message she has lost is
  // not a reminder. The new link supersedes the old one, which is fine: the old one was unused.
  const text = p.reminder
    ? `${member.fullName.split(' ')[0] ?? member.fullName}, üyelik bağlantını hatırlatmak istedik 🌸 Aşağıdaki güncel bağlantıdan devam edebilirsin:\n\n${rendered.value.body}`
    : rendered.value.body

  return { ok: true as const, phone: member.phone as string, text }
}

const TR_REASON: Record<string, string> = {
  template_not_found: 'Şablon bulunamadı.',
  template_inactive: 'Şablon kapalı.',
  daily_limit_reached: 'Günlük gönderim sınırına ulaşıldı.',
  template_params_missing: 'Şablon alanları eksik.',
  member_not_active: 'Üye aktif değil.',
}
