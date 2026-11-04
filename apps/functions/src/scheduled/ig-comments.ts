// IG-3 (2026-11-04) — every 10 minutes: new comments under the studio's last 25 posts → AI sorts and
// drafts → recorded (once). A complaint → e-mail to the owner (no text, no username in it). Nothing is
// ever SENT from here: replies are a person's press in the panel.
//
// Polling, not webhooks: Meta delivers comment webhooks only to a published (App Review) app. Reading our
// own account's comments works with the system user token today.
import { allStudioIds, FirestoreCommentRepository, FirestoreIdentityRepository, newCorrelationId, notify, receiveIgComment, systemClock, type TenantContext } from '@studio/core'
import { getAuth } from 'firebase-admin/auth'
import * as logger from 'firebase-functions/logger'

import { db } from '../shared/firebase'
import { notificationDeps, studioNotificationSettings } from '../triggers/on-event-notify'
import { CLASSIFY_SCHEMA, classifyPrompt, parseClassification, pickNew, type RawComment } from './ig-comments-ai'

const GRAPH = 'https://graph.facebook.com/v21.0'
const OPEN_WINDOW_MS = 7 * 86_400_000
const systemCtx = (studioId: string) => ({ studioId, branchIds: [], role: 'system', actor: { type: 'system', id: 'ig_comments' } }) as unknown as TenantContext
const deps = () => ({ repo: new FirestoreCommentRepository(db()), clock: systemClock })

async function graph<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  const d = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok || d.error) throw new Error(d.error?.message ?? `HTTP ${res.status}`)
  return d
}

async function classify(key: string, items: readonly { text: string; post: string }[]) {
  if (!key || items.length === 0) return items.map(() => ({ category: 'other' as const, draft: '' }))
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 4000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: CLASSIFY_SCHEMA } },
        messages: [{ role: 'user', content: classifyPrompt(items) }],
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) throw new Error(`model ${res.status}`)
    const data = (await res.json()) as { content?: { type?: string; text?: string }[] }
    return parseClassification(data.content?.find((b) => b.type === 'text')?.text ?? '', items.length)
  } catch (e) {
    logger.warn('ig-comments: AI failed — comments arrive without a draft', { error: (e as Error)?.message })
    return items.map(() => ({ category: 'other' as const, draft: '' }))
  }
}

async function tellOwner(studioId: string, count: number, now: number): Promise<void> {
  const ctx = { studioId, branchIds: [], role: 'owner', actor: { type: 'system', id: 'ig_comments' } } as unknown as TenantContext
  const owners = (await new FirestoreIdentityRepository(db()).listStaff(ctx)).filter((s) => s.active && s.role === 'owner')
  const nd = notificationDeps(await studioNotificationSettings(studioId as TenantContext['studioId']))
  for (const owner of owners) {
    let email: string | null = null
    try {
      email = (await getAuth().getUser(owner.id as string)).email ?? null
    } catch {
      /* in-app still reaches her */
    }
    try {
      await notify(nd, ctx, {
        intentId: `ig-complaint-${now}-${owner.id}`,
        eventId: null,
        eventType: 'system.ig_comment_complaint',
        operationId: newCorrelationId(),
        templateId: 'ig_comment_complaint',
        recipient: { kind: 'staff', id: owner.id as string, email, phone: null, displayName: owner.displayName },
        params: { summary: count === 1 ? 'Instagram gönderilerinden birine olumsuz bir yorum geldi.' : `Instagram gönderilerine ${count} olumsuz yorum geldi.` },
      })
    } catch (e) {
      logger.warn('ig-comments: complaint notification failed', { studioId, error: (e as Error)?.message })
    }
  }
}

async function syncStudio(studioId: string, token: string, key: string, now: number): Promise<void> {
  const igUserId = String((await db().doc(`studios/${studioId}/settings/content`).get()).get('igUserId') ?? '')
  if (!/^\d+$/.test(igUserId)) return
  const me = await graph<{ username?: string }>(`${igUserId}?fields=username`, token)
  const media = await graph<{ data?: { id: string; caption?: string; permalink?: string; comments_count?: number }[] }>(`${igUserId}/media?fields=id,caption,permalink,comments_count&limit=25`, token)
  const posts = new Map((media.data ?? []).map((m) => [m.id, m]))
  const raw: RawComment[] = []
  for (const m of media.data ?? []) {
    if (!m.comments_count) continue
    const c = await graph<{ data?: { id: string; text?: string; username?: string; timestamp?: string }[] }>(`${m.id}/comments?fields=id,text,username,timestamp&limit=50`, token)
    for (const x of c.data ?? []) raw.push({ id: x.id, text: String(x.text ?? ''), username: String(x.username ?? ''), timestamp: String(x.timestamp ?? ''), mediaId: m.id })
  }
  const ctx = systemCtx(studioId)
  const existing = await deps().repo.existingIds(ctx, raw.map((r) => r.id))
  const fresh = pickNew(raw, String(me.username ?? ''), existing)
  if (fresh.length === 0) return
  // Only OPEN work goes to the AI; first-run history arrives closed without a draft.
  const open = fresh.filter((c) => now - Date.parse(c.timestamp) <= OPEN_WINDOW_MS)
  const ai = await classify(key, open.map((c) => ({ text: c.text, post: String(posts.get(c.mediaId)?.caption ?? '') })))
  const byId = new Map(open.map((c, i) => [c.id, ai[i]!]))
  let complaints = 0
  for (const c of fresh) {
    const p = posts.get(c.mediaId)
    const a = byId.get(c.id) ?? { category: 'other' as const, draft: '' }
    const created = await receiveIgComment(deps(), ctx, {
      id: c.id,
      mediaId: c.mediaId,
      mediaLabel: String(p?.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      mediaPermalink: p?.permalink ?? null,
      username: c.username,
      text: c.text.slice(0, 2200),
      commentedAt: Date.parse(c.timestamp) as never,
      category: a.category,
      draft: a.draft || null,
    })
    if (created && a.category === 'complaint' && byId.has(c.id)) complaints++
  }
  logger.info('ig-comments: recorded', { studioId, fresh: fresh.length, open: open.length, complaints })
  if (complaints > 0) await tellOwner(studioId, complaints, now)
}

export async function runIgComments(now: number): Promise<void> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN
  if (!token) return logger.error('ig-comments: INSTAGRAM_ACCESS_TOKEN missing')
  for (const studioId of await allStudioIds(db())) {
    try {
      await syncStudio(String(studioId), token, process.env.ANTHROPIC_API_KEY ?? '', now)
    } catch (e) {
      logger.error('ig-comments: studio failed', { studioId, error: (e as Error)?.message })
    }
  }
}
