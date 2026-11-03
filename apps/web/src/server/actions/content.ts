'use server'

import {
  approveContentPost,
  CONTENT_LIMITS,
  editContentPost,
  FirestoreContentRepository,
  instant,
  istanbulWeekStart,
  planContentPosts,
  removeContentPost,
  systemClock,
  type ContentPost,
  type ContentPostFields,
  type DomainError,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { planInstagramWeek } from '../ai/content-planner'
import { adminDb } from '../firebase-admin'

// IG-2a — the Instagram content plan (owner, 2026-11-03). Plan, edit and remove: owner + reception +
// trainer. APPROVE: the owner — enforced in the domain (`decideApprovePost`), not only here.
const TEAM = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const
const OWNER = ['owner', 'platform_admin'] as const
const IST = 3 * 3_600_000 // Europe/Istanbul, UTC+3 (no DST)

const deps = () => ({ repo: new FirestoreContentRepository(adminDb()), clock: systemClock })

const weekKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const clip = z.object({ seconds: z.number().int(), angle: z.string().max(200), what: z.string().max(300) })
const fieldsSchema = z.object({
  scheduledFor: z.number().int().positive(),
  format: z.enum(['reels', 'photo', 'story']),
  title: z.string().max(400),
  shotCard: z.object({ clips: z.array(clip).max(20), hook: z.string().max(400), notes: z.string().max(1000), music: z.string().max(200) }),
  caption: z.string().max(5000),
  hashtags: z.array(z.string().max(100)).max(100),
})
const toFields = (f: z.infer<typeof fieldsSchema>): ContentPostFields => ({ ...f, scheduledFor: instant(f.scheduledFor) })

export type ContentResult<T = undefined> = { ok: true; value: T } | { ok: false; error: DomainError | { code: 'ai_unavailable' } }

export interface ContentWeek {
  readonly weekStart: string
  readonly posts: readonly ContentPost[]
  readonly areas: readonly string[]
  readonly canApprove: boolean
}

const settingsRef = (sid: string) => adminDb().doc(`studios/${sid}/settings/content`)

function addDays(weekStart: string, n: number): string {
  const d = new Date(`${weekStart}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function contentWeekAction(input: unknown): Promise<ContentWeek> {
  const p = z.object({ weekStart: weekKey.optional() }).parse(input ?? {})
  const ctx = await requireTenantContext(TEAM)
  const weekStart = p.weekStart ?? istanbulWeekStart(Date.now())
  const [posts, settings] = await Promise.all([deps().repo.listWeek(ctx, weekStart), settingsRef(String(ctx.studioId)).get()])
  return {
    weekStart,
    posts: posts.filter((x) => x.status !== 'removed'),
    areas: ((settings.get('areas') as string[] | undefined) ?? []).map(String),
    canApprove: (OWNER as readonly string[]).includes(String(ctx.role)),
  }
}

/** Owner: the area names the plan should be found by (Çayırova, Gebze, …). Data, not code. */
export async function setContentAreasAction(input: unknown): Promise<{ ok: true }> {
  const p = z.object({ areas: z.array(z.string().trim().min(1).max(40)).max(15) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  await settingsRef(String(ctx.studioId)).set({ areas: [...new Set(p.areas)] }, { merge: true })
  return { ok: true }
}

/**
 * Ask the AI for this week's posts. "Yeniden öner" REPLACES the suggestions nobody has touched yet
 * (AI-made, still `suggested`) — approved posts and the studio's own ideas stay.
 */
export async function suggestContentWeekAction(input: unknown): Promise<ContentResult<{ added: number }>> {
  const p = z.object({ weekStart: weekKey }).parse(input)
  const ctx = await requireTenantContext(TEAM)
  const sid = String(ctx.studioId)
  const now = Date.now()
  const d = deps()

  const [current, prev, ai, settings] = await Promise.all([
    d.repo.listWeek(ctx, p.weekStart),
    d.repo.listWeek(ctx, addDays(p.weekStart, -7)),
    adminDb().doc(`studios/${sid}/settings/ai`).get(),
    settingsRef(sid).get(),
  ])
  const kept = current.filter((x) => x.status !== 'removed' && !(x.origin === 'ai' && x.status === 'suggested'))
  // Aim for four posts a week; never more than five. With four already kept, one more idea is still offered.
  const count = kept.length >= 5 ? 0 : Math.max(1, 4 - kept.length)
  if (count === 0) return { ok: true, value: { added: 0 } }

  const card = [ai.get('identity'), ai.get('basics'), ai.get('campaign')].filter(Boolean).map(String).join('\n\n').slice(0, 9000)
  const monday = new Date(`${p.weekStart}T00:00:00Z`)
  const sunday = new Date(monday.getTime() + 6 * 86_400_000)
  const weekLabel = `${monday.getUTCDate()}–${sunday.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`
  const r = await planInstagramWeek({
    studio: card,
    areas: ((settings.get('areas') as string[] | undefined) ?? []).map(String),
    weekLabel,
    recentTitles: [...prev, ...kept].map((x) => x.title).slice(0, 12),
    count,
  })
  if (!r.ok) return { ok: false, error: { code: 'ai_unavailable' } }

  // The model's draft, fitted to Instagram's limits — trimmed rather than refused, because a person
  // reads every card before anything happens. The DOMAIN still validates what is saved.
  const fields: ContentPostFields[] = []
  for (const idea of r.ideas) {
    const [hh, mm] = /^\d{1,2}:\d{2}$/.test(idea.time) ? idea.time.split(':').map(Number) : [19, 0]
    const day = Math.min(6, Math.max(0, Math.trunc(idea.dayIndex)))
    const at = monday.getTime() + day * 86_400_000 + (hh! * 60 + mm!) * 60_000 - IST
    if (at < now) continue // this week is half gone: no posts into the past
    fields.push({
      scheduledFor: instant(at),
      format: idea.format,
      title: idea.title.trim().slice(0, CONTENT_LIMITS.title),
      shotCard: {
        clips: idea.clips
          .slice(0, CONTENT_LIMITS.clipsMax)
          .map((c) => ({ seconds: Math.min(60, Math.max(1, Math.round(c.seconds))), angle: c.angle.slice(0, 120), what: c.what.slice(0, 200) }))
          .filter((c) => c.what.trim()),
        hook: idea.hook.slice(0, CONTENT_LIMITS.hook),
        notes: idea.notes.slice(0, 400),
        music: idea.music.slice(0, 120),
      },
      caption: idea.caption.slice(0, CONTENT_LIMITS.caption),
      hashtags: idea.hashtags.slice(0, CONTENT_LIMITS.hashtags),
    })
  }
  const stale = current.filter((x) => x.origin === 'ai' && x.status === 'suggested')
  for (const s of stale) await removeContentPost(d, ctx, s.id)
  const planned = await planContentPosts(d, ctx, { origin: 'ai', posts: fields.filter((f) => f.shotCard.clips.length > 0) })
  if (!planned.ok) return { ok: false, error: planned.error }
  return { ok: true, value: { added: planned.value.length } }
}

export async function addContentIdeaAction(input: unknown): Promise<ContentResult> {
  const p = z.object({ fields: fieldsSchema }).parse(input)
  const ctx = await requireTenantContext(TEAM)
  const r = await planContentPosts(deps(), ctx, { origin: 'staff', posts: [toFields(p.fields)] })
  return r.ok ? { ok: true, value: undefined } : { ok: false, error: r.error }
}

export async function editContentPostAction(input: unknown): Promise<ContentResult> {
  const p = z.object({ id: z.string().regex(/^cnt_[0-9A-Z]{26}$/), fields: fieldsSchema }).parse(input)
  const ctx = await requireTenantContext(TEAM)
  const r = await editContentPost(deps(), ctx, p.id, toFields(p.fields))
  return r.ok ? { ok: true, value: undefined } : { ok: false, error: r.error }
}

export async function approveContentPostAction(input: unknown): Promise<ContentResult> {
  const p = z.object({ id: z.string().regex(/^cnt_[0-9A-Z]{26}$/), consentConfirmed: z.boolean() }).parse(input)
  const ctx = await requireTenantContext(TEAM) // the domain refuses anyone but the owner
  const r = await approveContentPost(deps(), ctx, p.id, p.consentConfirmed)
  return r.ok ? { ok: true, value: undefined } : { ok: false, error: r.error }
}

export async function removeContentPostAction(input: unknown): Promise<ContentResult> {
  const p = z.object({ id: z.string().regex(/^cnt_[0-9A-Z]{26}$/) }).parse(input)
  const ctx = await requireTenantContext(TEAM)
  const r = await removeContentPost(deps(), ctx, p.id)
  return r.ok ? { ok: true, value: undefined } : { ok: false, error: r.error }
}
