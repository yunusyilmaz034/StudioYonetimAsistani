// PURE decisions for the content plan (IG-2a). No I/O, no clock: `ctx.now` is given.
//
// The limits are INSTAGRAM'S, not ours — a caption over 2.200 characters or a 31st hashtag is
// refused by Instagram at publish time (IG-2b), days after someone wrote it. Refusing it here, at the
// moment of writing, is the same rule said early enough to be useful.
import { err, ok, type ActorRef, type DomainError, type Instant, type NewEvent, type Result, type StudioId } from '../../../shared'
import {
  CONTENT_POST_APPROVED,
  CONTENT_POST_EDITED,
  CONTENT_POST_PLANNED,
  CONTENT_POST_REMOVED,
  type ContentFormat,
  type ContentOrigin,
} from '../events'
import type { ContentPost, ContentPostFields, ShotCard } from './types'

export interface ContentDecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly role: string // the principal's role; only owner / platform_admin may approve
  readonly now: Instant
  readonly correlationId: string
  readonly source: string
}

export interface Outcome {
  readonly next: ContentPost
  readonly events: readonly NewEvent[]
}

export const CONTENT_LIMITS = {
  title: 120,
  caption: 2200, // Instagram
  hashtags: 30, // Instagram
  clipsMin: 1,
  clipsMax: 8,
  clipSecondsMin: 1,
  clipSecondsMax: 60,
  hook: 120,
} as const

const FORMATS: readonly ContentFormat[] = ['reels', 'photo', 'story']
const APPROVERS: readonly string[] = ['owner', 'platform_admin']
/** IG-2b: what is being (or has been) published is history — not edited, not moved. */
const LOCKED = new Set(['removed', 'publishing', 'published'])

/** Normalise and check the editable fields. Returns the cleaned fields or the first broken rule. */
export function validateContentFields(f: ContentPostFields, now: Instant): Result<ContentPostFields, DomainError> {
  const title = f.title.trim()
  if (title.length === 0 || title.length > CONTENT_LIMITS.title) return err({ code: 'content_invalid', field: 'title' })
  if (!FORMATS.includes(f.format)) return err({ code: 'content_invalid', field: 'format' })
  const clips = f.shotCard.clips
  if (clips.length < CONTENT_LIMITS.clipsMin || clips.length > CONTENT_LIMITS.clipsMax) return err({ code: 'content_invalid', field: 'clips' })
  for (const c of clips) {
    if (!Number.isInteger(c.seconds) || c.seconds < CONTENT_LIMITS.clipSecondsMin || c.seconds > CONTENT_LIMITS.clipSecondsMax || c.what.trim() === '') {
      return err({ code: 'content_invalid', field: 'clips' })
    }
  }
  if (f.shotCard.hook.trim().length > CONTENT_LIMITS.hook) return err({ code: 'content_invalid', field: 'hook' })
  const caption = f.caption.trim()
  if (caption.length > CONTENT_LIMITS.caption) return err({ code: 'content_invalid', field: 'caption' })
  // '#pilates', 'pilates', ' Pilates ' → 'pilates'-as-typed without the '#'; empties dropped; duplicates
  // (case-insensitive, Turkish-aware) collapse — Instagram counts each, so we must too.
  const seen = new Set<string>()
  const hashtags: string[] = []
  for (const raw of f.hashtags) {
    const t = raw.trim().replace(/^#+/, '').replace(/\s+/g, '')
    if (!t) continue
    const key = t.toLocaleLowerCase('tr')
    if (seen.has(key)) continue
    seen.add(key)
    hashtags.push(t)
  }
  if (hashtags.length > CONTENT_LIMITS.hashtags) return err({ code: 'content_invalid', field: 'hashtags' })
  if ((f.scheduledFor as number) < (now as number)) return err({ code: 'content_invalid', field: 'scheduledFor' })
  const shotCard: ShotCard = {
    clips: clips.map((c) => ({ seconds: c.seconds, angle: c.angle.trim(), what: c.what.trim() })),
    hook: f.shotCard.hook.trim(),
    notes: f.shotCard.notes.trim(),
    music: f.shotCard.music.trim(),
  }
  return ok({ scheduledFor: f.scheduledFor, format: f.format, title, shotCard, caption, hashtags })
}

const base = (ctx: ContentDecideContext, id: string) => ({
  studioId: ctx.studioId,
  branchId: null,
  version: 1,
  occurredAt: ctx.now,
  actor: ctx.actor,
  source: ctx.source,
  subject: { kind: 'contentPost' as const, id },
  related: {},
  policyRef: null,
  commandId: null,
  causationId: null,
  correlationId: ctx.correlationId as never,
})

export function decidePlanPost(
  ctx: ContentDecideContext,
  input: { readonly id: string; readonly weekStart: string; readonly origin: ContentOrigin; readonly fields: ContentPostFields },
): Result<Outcome, DomainError> {
  const v = validateContentFields(input.fields, ctx.now)
  if (!v.ok) return v
  const next: ContentPost = {
    id: input.id,
    studioId: ctx.studioId,
    weekStart: input.weekStart,
    ...v.value,
    origin: input.origin,
    status: 'suggested',
    createdAt: ctx.now,
    createdBy: ctx.actor,
    approvedAt: null,
    approvedBy: null,
    consentConfirmed: false,
  }
  return ok({
    next,
    events: [
      {
        ...base(ctx, next.id),
        type: CONTENT_POST_PLANNED,
        payload: {
          format: next.format,
          origin: next.origin,
          weekStart: next.weekStart,
          scheduledFor: next.scheduledFor,
          clipCount: next.shotCard.clips.length,
        },
      },
    ],
  })
}

const FIELD_NAMES = ['scheduledFor', 'format', 'title', 'shotCard', 'caption', 'hashtags'] as const

export { LOCKED as CONTENT_LOCKED_STATUSES }

export function decideEditPost(ctx: ContentDecideContext, current: ContentPost, fields: ContentPostFields): Result<Outcome, DomainError> {
  if (LOCKED.has(current.status)) return err({ code: 'content_not_editable' })
  const v = validateContentFields(fields, ctx.now)
  if (!v.ok) return v
  const changed = FIELD_NAMES.filter((k) => JSON.stringify(current[k]) !== JSON.stringify(v.value[k]))
  if (changed.length === 0) return ok({ next: current, events: [] })
  const approvalWithdrawn = current.status === 'approved' || current.status === 'scheduled'
  const next: ContentPost = {
    ...current,
    ...v.value,
    status: 'suggested',
    approvedAt: null,
    approvedBy: null,
    consentConfirmed: false,
    publish: null, // IG-2b: the owner approved THAT text for publishing, not this one
  }
  return ok({
    next,
    events: [{ ...base(ctx, current.id), type: CONTENT_POST_EDITED, payload: { changedFields: [...changed], approvalWithdrawn } }],
  })
}

export function decideApprovePost(ctx: ContentDecideContext, current: ContentPost, consentConfirmed: boolean): Result<Outcome, DomainError> {
  if (!APPROVERS.includes(ctx.role)) return err({ code: 'content_approve_forbidden' })
  if (current.status === 'approved') return err({ code: 'operation_already_applied' })
  if (current.status !== 'suggested') return err({ code: 'content_not_editable' })
  // A post whose time has already passed cannot be approved for that time — move it first.
  if ((current.scheduledFor as number) < (ctx.now as number)) return err({ code: 'content_invalid', field: 'scheduledFor' })
  const next: ContentPost = { ...current, status: 'approved', approvedAt: ctx.now, approvedBy: ctx.actor, consentConfirmed }
  return ok({
    next,
    events: [
      {
        ...base(ctx, current.id),
        type: CONTENT_POST_APPROVED,
        payload: { format: current.format, scheduledFor: current.scheduledFor, consentConfirmed },
      },
    ],
  })
}

export function decideRemovePost(ctx: ContentDecideContext, current: ContentPost): Result<Outcome, DomainError> {
  if (current.status === 'removed') return err({ code: 'operation_already_applied' })
  if (current.status === 'publishing' || current.status === 'published') return err({ code: 'content_not_editable' })
  const next: ContentPost = { ...current, status: 'removed' }
  return ok({
    next,
    events: [{ ...base(ctx, current.id), type: CONTENT_POST_REMOVED, payload: { wasApproved: current.status === 'approved' || current.status === 'scheduled' } }],
  })
}

/** Monday of the week `t` falls in, Europe/Istanbul (UTC+3, no DST since 2016), as 'YYYY-MM-DD'. Pure —
 * plain day arithmetic (no `Date`, which the domain does not use: D2). */
export function istanbulWeekStart(t: number): string {
  const days = Math.floor((t + 3 * 3_600_000) / 86_400_000) // days since 1970-01-01, Istanbul
  const monday = days - ((days + 3) % 7) // 1970-01-01 was a Thursday
  return civilDate(monday)
}

/** Days since the epoch → 'YYYY-MM-DD' (proleptic Gregorian; H. Hinnant's algorithm). */
function civilDate(z0: number): string {
  const z = z0 + 719_468
  const era = Math.floor(z / 146_097)
  const doe = z - era * 146_097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
