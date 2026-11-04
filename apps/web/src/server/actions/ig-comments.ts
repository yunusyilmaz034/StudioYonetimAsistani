'use server'

import { dismissIgComment, FirestoreCommentRepository, hideIgComment, mayReply, replyToIgComment, systemClock, type DomainError, type IgComment } from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

// IG-3 — Instagram comments. Reading: everyone on the content screen. Replying: owner + reception
// (complaints: owner only). Hiding: owner only. All enforced in the domain; Meta is called only after
// the domain said yes.
const TEAM = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const
const ID = z.string().regex(/^\d{5,30}$/)
const GRAPH = 'https://graph.facebook.com/v21.0'
const deps = () => ({ repo: new FirestoreCommentRepository(adminDb()), clock: systemClock })

export type CommentResult = { ok: true } | { ok: false; error: DomainError | { code: 'meta_refused'; message: string } }

export interface CommentRow extends IgComment {
  readonly mayAct: boolean
}
export interface CommentsView {
  readonly rows: readonly CommentRow[]
  readonly isOwner: boolean
}

export async function igCommentsAction(input: unknown): Promise<CommentsView> {
  const p = z.object({ tab: z.enum(['open', 'complaint', 'replied', 'all']) }).parse(input)
  const ctx = await requireTenantContext(TEAM)
  const repo = deps().repo
  const rows =
    p.tab === 'replied'
      ? await repo.listByStatus(ctx, 'replied', 100)
      : p.tab === 'all'
        ? await repo.listRecent(ctx, 150)
        : (await repo.listByStatus(ctx, 'open', 200)).filter((c) => p.tab === 'open' || c.category === 'complaint')
  const role = String(ctx.role)
  // Complaints first, then the oldest open one (it has waited longest).
  const sorted = p.tab === 'open' || p.tab === 'complaint' ? [...rows].sort((a, b) => Number(b.category === 'complaint') - Number(a.category === 'complaint') || (a.commentedAt as number) - (b.commentedAt as number)) : rows
  return { rows: sorted.map((c) => ({ ...c, mayAct: mayReply(role, c) })), isOwner: role === 'owner' || role === 'platform_admin' }
}

async function meta(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN
  if (!token) throw new Error('Instagram bağlantısı yapılandırılmamış.')
  const res = await fetch(`${GRAPH}/${path}`, { method: 'POST', body: new URLSearchParams({ ...params, access_token: token }), signal: AbortSignal.timeout(30_000) })
  const d = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { error_user_msg?: string; message?: string } }
  if (!res.ok || d.error) throw new Error(d.error?.error_user_msg || d.error?.message || `HTTP ${res.status}`)
  return d
}

export async function replyIgCommentAction(input: unknown): Promise<CommentResult> {
  const p = z.object({ id: ID, text: z.string().max(3000) }).parse(input)
  const ctx = await requireTenantContext(TEAM)
  const r = await replyToIgComment(deps(), ctx, p.id, p.text, async (id, text) => ({ igReplyId: String((await meta(`${id}/replies`, { message: text })).id ?? '') }))
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

export async function hideIgCommentAction(input: unknown): Promise<CommentResult> {
  const p = z.object({ id: ID }).parse(input)
  const ctx = await requireTenantContext(TEAM)
  const r = await hideIgComment(deps(), ctx, p.id, async (id) => {
    await meta(id, { hide: 'true' })
  })
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

export async function dismissIgCommentAction(input: unknown): Promise<CommentResult> {
  const p = z.object({ id: ID }).parse(input)
  const ctx = await requireTenantContext(TEAM)
  const r = await dismissIgComment(deps(), ctx, p.id)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}
