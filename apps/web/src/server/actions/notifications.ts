'use server'

import {
  DEFAULT_PREFS,
  deliver,
  FirestoreMemberRepository,
  instant,
  FirestoreNotificationRepository,
  META_TEMPLATE,
  newOperationId,
  notify,
  render,
  selectChannels,
  TEMPLATES,
  type MemberId,
  type NotificationPrefs,
  type NotificationTemplate,
  type RecipientRef,
} from '@studio/core'
import { z } from 'zod'

import { maskName } from '@/lib/demo-mask'

import { requireMemberContext, requireTenantContext } from '../auth'
import { isDemoMode } from '../demo-mode'
import { adminDb } from '../firebase-admin'
import { notificationDeps, notificationDepsFor } from '../notification-deps'
import { SEGMENT_KEYS } from '@/lib/segments'

import { resolveAudience } from './engagement'

// The Notification Center is never a "send an SMS" screen (owner). It is the centre of Intent ·
// Queue · Attempt · Delivery · Retry · Audit — the record of who we tried to reach, how it went, and
// what we chose not to send.
// `/notifications` is DESK (owner + receptionist) in the permission matrix. A trainer must NOT read
// notification history / templates or send member messages — the action guard has to match the matrix,
// not just the hidden nav. platform_admin is the developer superuser.
const OPS = ['owner', 'receptionist', 'platform_admin'] as const
const OWNER = ['owner', 'platform_admin'] as const

// The provider registry moved to `server/notification-deps.ts` — a plain module, so the PAYTR
// callback (which can never be a Server Action) sends over the same real providers this screen does.
const deps = notificationDeps

// ── Template management (Plus Phase 5) — a per-studio OVERRIDE store over the code seed. Not
//    event-sourced (like room notes): a template edit is config, and each SEND already keeps its
//    rendered snapshot, so a past message is never rewritten (I-38, §15). The edit stamps who/when
//    and bumps the version. Owner + platform_admin only; reception may READ, never edit copy. ──
export interface TemplateRow {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly channelLabel: string
  readonly subject: string
  readonly body: string
  readonly requiredParams: readonly string[]
  readonly active: boolean
  readonly version: number
  readonly overridden: boolean
  readonly updatedAt: number | null
  // Mapped to a Meta-approved WhatsApp template (META_TEMPLATE), so it CAN be sent over WhatsApp as a
  // business-initiated message. The WhatsApp-send screen lists only these.
  readonly whatsappCapable: boolean
  /** Channels the studio switched OFF for this template (owner, 2026-08-31). `in_app` never here. */
  readonly mutedChannels: readonly string[]
}

export async function listNotificationTemplatesAction(): Promise<readonly TemplateRow[]> {
  const ctx = await requireTenantContext(OPS)
  const db = adminDb()
  const overrides = await db.collection(`studios/${ctx.studioId}/notificationTemplates`).get()
  const overrideById = new Map(overrides.docs.map((d) => [d.id, d.data() as NotificationTemplate]))
  return Object.values(TEMPLATES)
    .map((seed) => {
      const o = overrideById.get(seed.id)
      const t = o ?? seed
      return {
        id: seed.id,
        name: t.name,
        category: t.category,
        channelLabel: t.category === 'marketing' ? 'Pazarlama' : 'Operasyonel',
        subject: t.subject,
        body: t.body,
        requiredParams: seed.requiredParams,
        active: t.active ?? true,
        version: t.version,
        overridden: Boolean(o),
        updatedAt: (o?.updatedAt as number | undefined) ?? null,
        whatsappCapable: seed.id in META_TEMPLATE,
        mutedChannels: [...(t.mutedChannels ?? [])],
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
}

export async function updateNotificationTemplateAction(input: unknown) {
  const p = z
    .object({
      id: z.string().min(1),
      subject: z.string().min(1),
      body: z.string().min(1),
      active: z.boolean(),
      // Per-template channel mute. `in_app` is REFUSED rather than filtered: the member's record of
      // her own account is not a setting, and a caller asking to remove it has misunderstood
      // something that should be corrected loudly rather than absorbed.
      mutedChannels: z.array(z.enum(['email', 'sms', 'whatsapp', 'push'])).optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  const seed = TEMPLATES[p.id]
  if (!seed) return { ok: false as const, error: { code: 'template_not_found' as const } }

  // The body must still declare every required param, or a live send would be refused at render.
  const missing = seed.requiredParams.filter((param) => !p.body.includes(`{{${param}}}`))
  if (missing.length > 0) return { ok: false as const, error: { code: 'template_params_missing' as const, missing } }

  const ref = adminDb().doc(`studios/${ctx.studioId}/notificationTemplates/${p.id}`)
  const existing = (await ref.get()).data() as NotificationTemplate | undefined
  const next: NotificationTemplate = {
    ...seed,
    subject: p.subject,
    body: p.body,
    active: p.active,
    mutedChannels: p.mutedChannels ?? [],
    version: (existing?.version ?? seed.version) + 1,
    updatedBy: ctx.actor.id,
    updatedAt: instant(Date.now()),
  }
  await ref.set(next)
  return { ok: true as const }
}

export async function resetNotificationTemplateAction(input: unknown) {
  const p = z.object({ id: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  await adminDb().doc(`studios/${ctx.studioId}/notificationTemplates/${p.id}`).delete()
  return { ok: true as const }
}

// ── Manual & bulk send (Plus Phase 5, §12/§13) ───────────────────────────────────────────────
//
// Staff sends a template to a member (from the member card / reservation) or to a set of members.
// It goes through the SAME notify() pipeline — same channel selection, consent, quiet hours, retry,
// audit — never a side channel. Params are supplied by the caller (pre-filled + editable in the UI),
// so any template works; render REFUSES a missing param, so a blank message can never be sent.

async function resolvedTemplate(studioId: string, id: string): Promise<NotificationTemplate | undefined> {
  const snap = await adminDb().doc(`studios/${studioId}/notificationTemplates/${id}`).get()
  return snap.exists ? (snap.data() as NotificationTemplate) : TEMPLATES[id]
}

/** Render preview for the manual-send dialog. Returns the missing params rather than a blank message. */
export async function previewNotificationAction(input: unknown) {
  const p = z.object({ templateId: z.string().min(1), params: z.record(z.string(), z.string()) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const template = await resolvedTemplate(ctx.studioId, p.templateId)
  if (!template) return { ok: false as const, error: { code: 'template_not_found' as const } }
  const r = render(template, p.params)
  return r.ok ? { ok: true as const, value: r.value } : r
}

export async function sendManualNotificationAction(input: unknown) {
  const p = z.object({ memberId: z.string().min(1), templateId: z.string().min(1), params: z.record(z.string(), z.string()) }).parse(input)
  const ctx = await requireTenantContext(OPS)
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, p.memberId as MemberId)
  if (!member) return { ok: false as const, error: { code: 'member_not_found' as const } }

  const recipient: RecipientRef = {
    kind: 'member',
    id: member.id as string,
    email: (member.email as string | null) ?? null,
    phone: (member.phone as string | null) ?? null,
    displayName: member.fullName,
  }
  const opId = newOperationId()
  return notify(deps(), ctx, {
    intentId: `manual:${p.templateId}:${member.id}:${opId}`,
    eventId: null,
    eventType: 'manual_send',
    operationId: opId,
    templateId: p.templateId,
    recipient,
    params: { memberName: member.fullName, ...p.params },
  })
}

// Desk-initiated WhatsApp template send (Task, owner). Unlike the multi-channel manual send above, this
// goes out over WhatsApp ONLY, using a Meta-approved template (META_TEMPLATE) — a business-initiated
// message the staff deliberately chose, so it bypasses the member's channel preference. Owner-only, and
// only templates that are actually mapped to an approved Meta template may be sent.
export async function sendWhatsAppTemplateAction(input: unknown) {
  const p = z.object({ memberId: z.string().min(1), templateId: z.string().min(1), params: z.record(z.string(), z.string()) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  if (!(p.templateId in META_TEMPLATE)) return { ok: false as const, error: { code: 'template_not_approved' as const } }
  const member = await new FirestoreMemberRepository(adminDb()).findById(ctx, p.memberId as MemberId)
  if (!member) return { ok: false as const, error: { code: 'member_not_found' as const } }
  if (!member.phone) return { ok: false as const, error: { code: 'missing_contact' as const } }

  const recipient: RecipientRef = {
    kind: 'member',
    id: member.id as string,
    email: (member.email as string | null) ?? null,
    phone: member.phone as string,
    displayName: member.fullName,
  }
  const opId = newOperationId()
  return notify(deps(), ctx, {
    intentId: `wa:${p.templateId}:${member.id}:${opId}`,
    eventId: null,
    eventType: 'manual_whatsapp',
    operationId: opId,
    templateId: p.templateId,
    recipient,
    params: { memberName: member.fullName, ...p.params },
    forceChannels: ['whatsapp'],
  })
}

export async function sendBulkNotificationAction(input: unknown) {
  const p = z.object({ memberIds: z.array(z.string().min(1)).min(1).max(500), templateId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const memberRepo = new FirestoreMemberRepository(adminDb())
  const opId = newOperationId()
  let sent = 0
  let failed = 0
  // Why each failure happened, aggregated by code — so the owner sees "1 başarısız (şablon parametreleri
  // eksik)" instead of a mute count. A refused-at-creation send records NO attempt, so this is the only
  // place its reason survives.
  const reasons: Record<string, number> = {}
  const bump = (code: string) => {
    reasons[code] = (reasons[code] ?? 0) + 1
  }
  for (const memberId of p.memberIds) {
    const member = await memberRepo.findById(ctx, memberId as MemberId)
    if (!member) {
      failed++
      bump('member_not_found')
      continue
    }
    const recipient: RecipientRef = {
      kind: 'member',
      id: member.id as string,
      email: (member.email as string | null) ?? null,
      phone: (member.phone as string | null) ?? null,
      displayName: member.fullName,
    }
    const res = await notify(deps(), ctx, {
      intentId: `bulk:${p.templateId}:${member.id}:${opId}`,
      eventId: null,
      eventType: 'bulk_send',
      operationId: opId,
      templateId: p.templateId,
      recipient,
      params: { memberName: member.fullName },
    })
    if (res.ok) sent++
    else {
      failed++
      bump(res.error.code)
    }
  }
  return { ok: true as const, value: { sent, failed, reasons, operationId: opId } }
}

// ── "STÜDYODAN" engagement send (v1.27) — owner-approved, never automatic. Resolve an audience segment
//    (or explicit ids) → send the owner-written subject/body through the SAME notify() pipeline via the
//    engagement_broadcast passthrough. In-app always lands; push/WhatsApp respect marketing consent. ──
export async function sendEngagementAction(input: unknown) {
  const p = z
    .object({
      subject: z.string().trim().min(1).max(120),
      body: z.string().trim().min(1).max(600),
      segment: z.enum(SEGMENT_KEYS).optional(),
      groupId: z.string().min(1).optional(),
      memberIds: z.array(z.string().min(1)).max(2000).optional(),
      // Which channels THIS send may use. Omitted ⇒ the studio's own configuration.
      //
      // A per-send override rather than editing the studio settings: switching the studio to
      // "WhatsApp only" for one announcement and forgetting to switch it back would silently change
      // every notification after it, and nobody would connect the two.
      channels: z.array(z.enum(['in_app', 'email', 'sms', 'whatsapp', 'push'])).optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  // Loaded ONCE, not per member: it is the same studio for all 158 of them, and a document read in
  // the loop is 158 reads to answer one question. This is also the line that makes the settings
  // screen mean something — WhatsApp on, push off, as the owner actually configured it.
  const studioDeps = await notificationDepsFor(ctx.studioId)
  // `in_app` is added back whatever was chosen: it is the member's record of her own account, not a
  // message somebody may decide she should not have.
  const sendDeps = p.channels?.length
    ? { ...studioDeps, settings: { ...studioDeps.settings, enabledChannels: [...new Set(['in_app', ...p.channels])] as typeof studioDeps.settings.enabledChannels } }
    : studioDeps
  // The SAME resolver the preview calls. If these two ever answered differently, the preview would be
  // a preview of some other send — and the owner would have approved a list that was never used.
  const ids = await resolveAudience(ctx.studioId, p)
  if (ids.length === 0) return { ok: false as const, error: { code: 'no_recipients' as const } }

  const memberRepo = new FirestoreMemberRepository(adminDb())
  const opId = newOperationId()

  // ── THE RUN (owner, 2026-08-31) ───────────────────────────────────────────────────────────
  //
  // Today reception sent the Monday message to the whole roster, waited, decided it was taking too
  // long and "cancelled" it — by which she meant she closed the screen. It had already finished:
  // 154 WhatsApps in three and a half minutes. There was nothing to cancel, and no way to find out
  // that there was nothing to cancel.
  //
  // Both halves of that are fixed by writing the run down. The document is the control surface AND
  // the record: the loop reports its progress into it and asks it, as it goes, whether it has been
  // stopped. A closed tab no longer loses the send, because the send was never in the tab.
  const runRef = adminDb().doc(`studios/${ctx.studioId}/engagementRuns/${opId}`)
  await runRef.set({
    status: 'running',
    total: ids.length,
    sent: 0,
    failed: 0,
    subject: p.subject,
    startedAt: Date.now(),
    startedBy: ctx.actor.id,
  })

  let sent = 0
  let failed = 0
  let stopped = false
  // Checked every FIVE members, not every one. Per-member it would be one extra read for each
  // message — the same cost again, to answer a question whose answer is almost always no. At roughly
  // a second per member this bounds the delay after pressing Durdur at about five seconds, which is
  // the difference between a button that works and a button that feels broken.
  const CHECK_EVERY = 5
  for (const [i, memberId] of ids.entries()) {
    if (i > 0 && i % CHECK_EVERY === 0) {
      const run = await runRef.get()
      if (run.get('status') === 'cancelling') {
        stopped = true
        break
      }
      await runRef.update({ sent, failed })
    }
    const member = await memberRepo.findById(ctx, memberId as MemberId)
    if (!member) {
      failed++
      continue
    }
    const recipient: RecipientRef = {
      kind: 'member',
      id: member.id as string,
      email: (member.email as string | null) ?? null,
      phone: (member.phone as string | null) ?? null,
      displayName: member.fullName,
    }
    const res = await notify(sendDeps, ctx, {
      intentId: `engagement:${opId}:${member.id}`,
      eventId: null,
      eventType: 'engagement_broadcast',
      operationId: opId,
      templateId: 'engagement_broadcast',
      recipient,
      params: { memberName: member.fullName, subject: p.subject, body: p.body },
    })
    if (res.ok) sent++
    else failed++
  }

  // The final numbers, and — when it was stopped — how many were never attempted. "Durduruldu" alone
  // invites the question this answers: durduruldu, ama kaç kişiye gitti?
  await runRef.update({
    status: stopped ? 'stopped' : 'done',
    sent,
    failed,
    notSent: ids.length - sent - failed,
    finishedAt: Date.now(),
  })
  return { ok: true as const, value: { sent, failed, total: ids.length, operationId: opId, stopped } }
}

export interface EngagementRun {
  readonly operationId: string
  readonly status: 'running' | 'cancelling' | 'stopped' | 'done'
  readonly total: number
  readonly sent: number
  readonly failed: number
  readonly notSent: number
  readonly subject: string
}

/**
 * The most recent send, for the screen to poll.
 *
 * The LATEST rather than one named by the caller, because the caller cannot name it: the send's id
 * is created on the server and does not come back until the send has finished — which is exactly the
 * moment progress stops being interesting. A studio runs one broadcast at a time, so "the latest" is
 * unambiguous; and it has the better property anyway, that a reopened screen finds the send it lost.
 *
 * Ordered on ONE field, so no composite index is needed — this repository has been taken down once
 * by an index that existed only in production's imagination (OR-14).
 */
export async function engagementRunAction(): Promise<EngagementRun | null> {
  const ctx = await requireTenantContext(OPS)
  const q = await adminDb()
    .collection(`studios/${ctx.studioId}/engagementRuns`)
    .orderBy('startedAt', 'desc')
    .limit(1)
    .get()
  const snap = q.docs[0]
  if (!snap) return null
  const d = snap.data() ?? {}
  return {
    operationId: snap.id,
    status: String(d.status ?? 'running') as EngagementRun['status'],
    total: Number(d.total ?? 0),
    sent: Number(d.sent ?? 0),
    failed: Number(d.failed ?? 0),
    notSent: Number(d.notSent ?? 0),
    subject: String(d.subject ?? ''),
  }
}

/**
 * Stop a running send.
 *
 * It asks rather than kills: the flag becomes `cancelling`, and the loop stops itself at its next
 * check. There is no way to interrupt a send that is mid-flight — the message either left or it did
 * not — and pretending otherwise would produce a screen saying "stopped" over a WhatsApp already on
 * its way. The loop then writes `stopped` with the real numbers, so the difference between "asked to
 * stop" and "stopped" stays visible.
 *
 * Owner-only: stopping a send is the same weight of decision as starting one.
 */
export async function cancelEngagementRunAction(input: unknown) {
  const p = z.object({ operationId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const ref = adminDb().doc(`studios/${ctx.studioId}/engagementRuns/${p.operationId}`)
  const snap = await ref.get()
  if (!snap.exists) return { ok: false as const, error: { code: 'run_not_found' as const } }
  if (snap.get('status') !== 'running') return { ok: false as const, error: { code: 'run_not_running' as const } }
  await ref.update({ status: 'cancelling', cancelledBy: ctx.actor.id, cancelledAt: Date.now() })
  return { ok: true as const }
}

// ── GÖNDERMEDEN ÖNCE: KİME NE GİDECEK (owner, 2026-08-31) ────────────────────────────────────
//
// "173 üyeye gönder" sent 173 irreversible messages the moment it was pressed. A `confirm()` asking
// "are you sure?" is not a check: it repeats the number the owner already saw and adds nothing she
// could act on. What she asked for is the thing she cannot get anywhere else — **the list**, before
// it goes.
//
// The preview must be TRUE, so it does not re-implement the rules. It calls the same
// `resolveAudience` the send calls, and the same pure `selectChannels` the pipeline calls, under the
// same 'marketing' category and the same per-send channel override. A preview computed by a second
// copy of the logic is a preview of a send that does not exist — and it would drift on the first
// change to either copy.
//
// The number that matters most here is not the total. Selecting "Sadece e-posta" for 173 members
// reaches 23 of them, because 23 have an e-mail address; the old button said 173 and the studio would
// have had no way to learn otherwise. Every member who will NOT be reached is returned with the
// reason — no consent, no address, her own preference — because a suppressed campaign must never be
// a silent one (the same principle the pipeline already holds for delivery).
export interface EngagementPreviewRow {
  readonly id: string
  readonly name: string
  readonly channels: readonly string[]
  readonly suppressed: readonly { channel: string; reason: string }[]
}

export async function previewEngagementAction(input: unknown) {
  const p = z
    .object({
      segment: z.enum(SEGMENT_KEYS).optional(),
      groupId: z.string().min(1).optional(),
      memberIds: z.array(z.string().min(1)).max(2000).optional(),
      channels: z.array(z.enum(['in_app', 'email', 'sms', 'whatsapp', 'push'])).optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)

  const studioDeps = await notificationDepsFor(ctx.studioId)
  // The identical override the send performs — including adding `in_app` back, which is the member's
  // own account record and not a message anyone may switch off for her.
  const settings = p.channels?.length
    ? { ...studioDeps.settings, enabledChannels: [...new Set(['in_app', ...p.channels])] as typeof studioDeps.settings.enabledChannels }
    : studioDeps.settings

  // The members are read RAW here rather than through the repository, because the one field this
  // screen turns on — `notificationPrefs` — is not part of the domain `Member`: consent is a
  // notification concern, and the member aggregate has no business carrying it. One collection read
  // for 173 members, not 173 document reads inside the loop.
  const [ids, memberSnap, demo] = await Promise.all([
    resolveAudience(ctx.studioId, p),
    adminDb().collection(`studios/${ctx.studioId}/members`).get(),
    isDemoMode(),
  ])
  const byId = new Map(memberSnap.docs.map((d) => [d.id, d.data()]))

  const rows: EngagementPreviewRow[] = []
  const perChannel: Record<string, number> = {}
  const reasons: Record<string, number> = {}
  for (const id of ids) {
    const m = byId.get(id)
    if (!m) continue
    const prefs: NotificationPrefs = { ...DEFAULT_PREFS, ...((m.notificationPrefs as NotificationPrefs | undefined) ?? {}) }
    const recipient: RecipientRef = {
      kind: 'member',
      id,
      email: (m.email as string | null) ?? null,
      phone: (m.phone as string | null) ?? null,
      displayName: String(m.fullName ?? ''),
    }
    const d = selectChannels(recipient, prefs, settings, 'marketing')
    for (const c of d.channels) perChannel[c] = (perChannel[c] ?? 0) + 1
    for (const s of d.suppressed) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1
    rows.push({
      id,
      name: demo ? maskName(String(m.fullName ?? ''), id) : String(m.fullName ?? ''),
      channels: [...d.channels],
      suppressed: d.suppressed.map((s) => ({ channel: s.channel as string, reason: s.reason as string })),
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  return { ok: true as const, value: { total: rows.length, rows, perChannel, reasons } }
}

// Approve engagement SUGGESTIONS (birthday, seni özledik, kilometre taşı…) — one draft per member. Sends
// through the same passthrough, then stamps the cooldown log so the same nudge won't be suggested again.
export async function sendSuggestionsAction(input: unknown) {
  const p = z
    .object({
      items: z
        .array(
          z.object({
            memberId: z.string().min(1),
            subject: z.string().trim().min(1).max(120),
            body: z.string().trim().min(1).max(600),
            logKey: z.string().min(1).max(40),
          }),
        )
        .min(1)
        .max(500),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  // Same reason as the broadcast above: the studio's own channels, read once.
  const sendDeps = await notificationDepsFor(ctx.studioId)
  const memberRepo = new FirestoreMemberRepository(adminDb())
  const opId = newOperationId()
  let sent = 0
  let failed = 0
  for (const it of p.items) {
    const member = await memberRepo.findById(ctx, it.memberId as MemberId)
    if (!member) {
      failed++
      continue
    }
    const recipient: RecipientRef = {
      kind: 'member',
      id: member.id as string,
      email: (member.email as string | null) ?? null,
      phone: (member.phone as string | null) ?? null,
      displayName: member.fullName,
    }
    const res = await notify(sendDeps, ctx, {
      intentId: `suggestion:${opId}:${member.id}:${it.logKey}`,
      eventId: null,
      eventType: 'engagement_suggestion',
      operationId: opId,
      templateId: 'engagement_broadcast',
      recipient,
      params: { memberName: member.fullName, subject: it.subject, body: it.body },
    })
    if (res.ok) {
      sent++
      await adminDb().doc(`studios/${ctx.studioId}/engagementLog/${it.memberId}_${it.logKey}`).set({ sentAt: Date.now() })
    } else failed++
  }
  return { ok: true as const, value: { sent, failed } }
}

export interface NotificationRow {
  readonly attemptId: string
  readonly intentId: string
  readonly templateName: string
  readonly recipientName: string
  readonly recipientKind: string
  readonly channel: string
  readonly status: string
  readonly attemptNo: number
  readonly errorCode: string | null
  readonly permanent: boolean
  readonly suppression: string | null
  readonly at: number
  readonly operationId: string
  readonly causedBy: string
  readonly subject: string | null
}

// Everything the owner asked for on one row: message · recipient · channel · time · what triggered
// it · status · error · retries · OperationId.
export async function listNotificationsAction(): Promise<readonly NotificationRow[]> {
  const ctx = await requireTenantContext(OPS)
  const repo = new FirestoreNotificationRepository(adminDb())

  const [attempts, intents] = await Promise.all([repo.listAttempts(ctx, 200), repo.listIntents(ctx, 200)])
  const byId = new Map(intents.map((i) => [i.id, i]))

  return attempts
    .map((a) => {
      const intent = byId.get(a.intentId)
      return {
        attemptId: a.id,
        intentId: a.intentId,
        templateName: TEMPLATES[intent?.templateId ?? '']?.name ?? (intent?.templateId ?? '—'),
        recipientName: intent?.recipient.displayName ?? '—',
        recipientKind: intent?.recipient.kind ?? '—',
        channel: a.channel,
        status: a.status,
        attemptNo: a.attemptNo,
        errorCode: a.error?.code ?? null,
        permanent: a.error?.permanent ?? false,
        suppression: a.suppression,
        at: (a.sentAt ?? a.queuedAt ?? intent?.createdAt ?? 0) as number,
        operationId: intent?.operationId ?? '',
        causedBy: intent?.eventType ?? '',
        subject: a.subject,
      }
    })
    .sort((x, y) => y.at - x.at)
}

// Sometimes the answer to a failed delivery is a human deciding to try again. Owner only, and it is
// a new attempt — never an edit of the old one.
export async function resendNotificationAction(input: unknown) {
  const p = z.object({ attemptId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const repo = new FirestoreNotificationRepository(adminDb())

  const attempt = await repo.getAttempt(ctx, p.attemptId)
  if (!attempt) return { ok: false as const, error: { code: 'notification_not_found' as const } }
  const intent = await repo.getIntent(ctx, attempt.intentId)
  if (!intent) return { ok: false as const, error: { code: 'notification_not_found' as const } }

  await deliver(deps(), ctx, intent, {
    ...attempt,
    id: `${attempt.intentId}:${attempt.channel}:${attempt.attemptNo + 1}`,
    attemptNo: attempt.attemptNo + 1,
    status: 'pending',
    error: null,
    nextRetryAt: null,
  })
  return { ok: true as const, value: undefined }
}

// ── the member's own inbox (the one channel she cannot switch off — it is her record) ────────
export async function myInboxAction() {
  const { ctx, memberId } = await requireMemberContext()
  return new FirestoreNotificationRepository(adminDb()).listInbox(ctx, memberId as string)
}

export async function markInboxReadAction(input: unknown) {
  const p = z.object({ intentId: z.string().min(1) }).parse(input)
  const { ctx, memberId } = await requireMemberContext()
  await new FirestoreNotificationRepository(adminDb()).markInboxRead(ctx, memberId as string, p.intentId)
  return { ok: true as const }
}

// Her channel preferences. She may say "not by e-mail". She may NOT say "never tell me my class was
// cancelled" — which is why `in_app` is not on this list.
export async function setPrefsAction(input: unknown) {
  const p = z
    .object({
      email: z.boolean(),
      sms: z.boolean(),
      whatsapp: z.boolean(),
      push: z.boolean(),
      // Plus Phase 5 — marketing consent (KVKK), separate from the operational channels.
      campaign: z.boolean().optional(),
    })
    .parse(input)
  const { ctx, memberId } = await requireMemberContext()
  await adminDb()
    .doc(`studios/${ctx.studioId}/members/${memberId}`)
    .set({ notificationPrefs: p }, { merge: true })
  return { ok: true as const }
}

export async function myPrefsAction(): Promise<NotificationPrefs> {
  const { ctx, memberId } = await requireMemberContext()
  const snap = await adminDb().doc(`studios/${ctx.studioId}/members/${memberId}`).get()
  return { ...DEFAULT_PREFS, ...((snap.get('notificationPrefs') as NotificationPrefs) ?? {}) }
}
