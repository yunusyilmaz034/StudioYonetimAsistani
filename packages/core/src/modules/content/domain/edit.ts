// PURE decisions for the AI edit (IG-2c, 2026-11-04). Owner's rules:
//
//   · Reels only. Anyone on the content screen uploads raw clips and asks for an edit; only the owner
//     approves publishing (IG-2b, unchanged).
//   · The cut is decided by the AI and rendered on OUR server; the result is an ordinary file on the
//     post (`media_attached`), checked against Instagram's limits like any upload.
//   · A re-edit keeps the cuts and re-renders with what a person changed (hook, subtitle lines, music,
//     subtitles on/off). A new file means a new approval.
//   · At most 8 clips, 1 GB in all; the result is 3–90 seconds.
//
// A render answers ONE request (`requestId`). A late result of an older request — a run that was
// thought dead, a duplicate delivery — is refused, so it can never overwrite a newer edit.
import { err, ok, type DomainError, type Result } from '../../../shared'
import { CONTENT_POST_EDIT_FAILED, CONTENT_POST_EDIT_REQUESTED, CONTENT_POST_RAW_CLIP_ADDED, type ContentPostEditFailedPayload } from '../events'
import type { ContentDecideContext, Outcome } from './decide'
import { decideAttachMedia } from './publish'
import type { ContentEditOverrides, ContentEditPlan, ContentMedia, ContentPost, ContentRawClip, EditSegment, MusicTrack, SubtitleLine } from './types'

const MB = 1024 * 1024

export const EDIT_LIMITS = {
  clips: 8,
  totalBytes: 1024 * MB,
  clipBytes: 500 * MB,
  clipSeconds: [1, 900],
  outSeconds: [3, 90],
  minSegment: 0.5,
  hook: 120,
  line: 120,
  hookSeconds: 3,
} as const

/** A render that took the request this long ago and never answered died (out of memory, a crash). */
export const EDIT_STALE_MS = 30 * 60_000

const VIDEO_TYPES = ['video/mp4', 'video/quicktime']
const EDITABLE = new Set(['suggested', 'approved', 'scheduled', 'failed'])

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

export const isEditRendering = (p: Pick<ContentPost, 'edit'>, now: number): boolean =>
  p.edit?.status === 'rendering' && now - (p.edit.requestedAt as number) <= EDIT_STALE_MS

export const isEditStale = (p: Pick<ContentPost, 'edit'>, now: number): boolean =>
  p.edit?.status === 'rendering' && now - (p.edit.requestedAt as number) > EDIT_STALE_MS

export function decideAddRawClip(
  ctx: ContentDecideContext,
  current: ContentPost,
  clip: Omit<ContentRawClip, 'uploadedAt' | 'uploadedBy'>,
): Result<Outcome, DomainError> {
  if (current.format !== 'reels') return err({ code: 'content_invalid', field: 'format' })
  if (!EDITABLE.has(current.status)) return err({ code: 'content_not_editable' })
  if (isEditRendering(current, ctx.now as number)) return err({ code: 'operation_not_applicable' })
  const okClip =
    Number.isInteger(clip.slot) &&
    clip.slot >= 0 &&
    clip.slot < EDIT_LIMITS.clips &&
    VIDEO_TYPES.includes(clip.contentType) &&
    clip.bytes > 0 &&
    clip.bytes <= EDIT_LIMITS.clipBytes &&
    clip.width > 0 &&
    clip.height > 0 &&
    clip.seconds >= EDIT_LIMITS.clipSeconds[0] &&
    clip.seconds <= EDIT_LIMITS.clipSeconds[1]
  if (!okClip) return err({ code: 'content_invalid', field: 'media' })
  const others = (current.rawClips ?? []).filter((c) => c.slot !== clip.slot)
  if (others.reduce((s, c) => s + c.bytes, 0) + clip.bytes > EDIT_LIMITS.totalBytes) return err({ code: 'content_invalid', field: 'media' })
  const replaced = others.length !== (current.rawClips ?? []).length
  const rawClips = [...others, { ...clip, uploadedAt: ctx.now, uploadedBy: ctx.actor }].sort((a, b) => a.slot - b.slot)
  return ok({
    next: { ...current, rawClips },
    events: [
      {
        ...base(ctx, current.id),
        type: CONTENT_POST_RAW_CLIP_ADDED,
        payload: { slot: clip.slot, contentType: clip.contentType, bytes: clip.bytes, seconds: clip.seconds, width: clip.width, height: clip.height, replaced, clipCount: rawClips.length },
      },
    ],
  })
}

/** The first edit (`overrides` null: the AI decides everything) or a re-edit with a person's changes. */
export function decideRequestEdit(ctx: ContentDecideContext, current: ContentPost, overrides: ContentEditOverrides | null): Result<Outcome, DomainError> {
  if (current.format !== 'reels') return err({ code: 'content_invalid', field: 'format' })
  if (!EDITABLE.has(current.status)) return err({ code: 'content_not_editable' })
  if ((current.rawClips ?? []).length === 0) return err({ code: 'content_invalid', field: 'media' })
  if (isEditRendering(current, ctx.now as number)) return err({ code: 'operation_already_applied' })
  let clean: ContentEditOverrides | null = null
  if (overrides) {
    const plan = current.edit?.plan
    if (!plan) return err({ code: 'operation_not_applicable' })
    const hook = overrides.hook.trim()
    if (hook.length > EDIT_LIMITS.hook) return err({ code: 'content_invalid', field: 'hook' })
    const ids = new Set(plan.lines.map((l) => l.id))
    const lines = overrides.lines.map((l) => ({ id: l.id, text: l.text.trim() }))
    if (lines.some((l) => !ids.has(l.id) || l.text.length > EDIT_LIMITS.line)) return err({ code: 'content_invalid', field: 'caption' })
    clean = { hook, lines, musicTrackId: overrides.musicTrackId, subtitles: overrides.subtitles }
  }
  // A new file is coming: the owner approved THE OLD ONE. Withdrawn now, so it cannot go out meanwhile.
  const approvalWithdrawn = current.status === 'scheduled'
  const next: ContentPost = {
    ...current,
    status: current.status === 'scheduled' || current.status === 'failed' ? 'approved' : current.status,
    publish: current.status === 'scheduled' || current.status === 'failed' ? null : (current.publish ?? null),
    edit: {
      status: 'rendering',
      requestId: ctx.correlationId,
      requestedAt: ctx.now,
      requestedBy: ctx.actor,
      plan: current.edit?.plan ?? null,
      overrides: clean,
      failure: null,
      renderedAt: current.edit?.renderedAt ?? null,
    },
  }
  return ok({
    next,
    events: [
      {
        ...base(ctx, current.id),
        type: CONTENT_POST_EDIT_REQUESTED,
        payload: { clipCount: (current.rawClips ?? []).length, redo: clean !== null, subtitles: clean ? clean.subtitles : null, approvalWithdrawn },
      },
    ],
  })
}

const answering = (current: ContentPost, requestId: string) => current.edit?.status === 'rendering' && current.edit.requestId === requestId

/** The render is done: the file goes on the post like any upload, and the plan is kept for a re-edit. */
export function decideEditRendered(
  ctx: ContentDecideContext,
  current: ContentPost,
  input: { readonly requestId: string; readonly plan: ContentEditPlan; readonly media: Omit<ContentMedia, 'uploadedAt' | 'uploadedBy'> },
): Result<Outcome, DomainError> {
  if (!answering(current, input.requestId)) return err({ code: 'operation_not_applicable' })
  const attached = decideAttachMedia(ctx, current, { ...input.media, coverAtMs: Math.round(input.plan.coverAt * 1000) }, { notes: input.plan.notes, at: ctx.now })
  if (!attached.ok) return attached
  const next: ContentPost = {
    ...attached.value.next,
    edit: { ...current.edit!, status: 'ready', plan: input.plan, overrides: null, failure: null, renderedAt: ctx.now },
  }
  return ok({ next, events: attached.value.events })
}

export function decideEditFailed(
  ctx: ContentDecideContext,
  current: ContentPost,
  input: { readonly requestId: string; readonly stage: ContentPostEditFailedPayload['stage']; readonly message: string },
): Result<Outcome, DomainError> {
  if (!answering(current, input.requestId)) return err({ code: 'operation_not_applicable' })
  return ok({
    next: { ...current, edit: { ...current.edit!, status: 'failed', failure: { stage: input.stage, message: input.message.slice(0, 300) } } },
    events: [{ ...base(ctx, current.id), type: CONTENT_POST_EDIT_FAILED, payload: { stage: input.stage } }],
  })
}

// ── The plan: what the AI proposed, made safe to render ────────────────────────────────────────────

/** One transcribed phrase of one raw clip, in that clip's seconds. */
export interface TranscriptLine {
  readonly slot: number
  readonly index: number
  readonly start: number
  readonly end: number
  readonly text: string
}

export interface AiEditProposal {
  readonly segments: readonly { readonly slot: number; readonly from: number; readonly to: number }[]
  readonly hook: string
  readonly coverAt: number
  readonly musicTrackId: string | null
  readonly subtitles: boolean
  readonly lineFixes: readonly { readonly id: string; readonly text: string; readonly unsure: boolean }[]
  readonly notes: readonly { readonly level: 'ok' | 'warn'; readonly text: string }[]
}

const r1 = (n: number) => Math.round(n * 10) / 10
export const lineId = (slot: number, index: number) => `${slot}:${index}`

/**
 * The AI's proposal → a plan the renderer can trust. Segments that do not exist in their clip are
 * dropped, the length is cut at 90 s, a music track that is not in the active library is dropped.
 * Fewer than 3 seconds left → refused (nothing to post).
 */
export function normalizeEditPlan(
  proposal: AiEditProposal,
  clips: readonly Pick<ContentRawClip, 'slot' | 'seconds'>[],
  transcript: readonly TranscriptLine[],
  tracks: readonly Pick<MusicTrack, 'id' | 'active'>[],
): Result<ContentEditPlan, DomainError> {
  const len = new Map(clips.map((c) => [c.slot, c.seconds]))
  const segments: EditSegment[] = []
  let total = 0
  for (const s of proposal.segments) {
    const d = len.get(s.slot)
    if (d == null || !Number.isFinite(s.from) || !Number.isFinite(s.to)) continue
    const from = r1(Math.max(0, s.from))
    let to = r1(Math.min(d, s.to))
    if (to - from < EDIT_LIMITS.minSegment) continue
    const room = EDIT_LIMITS.outSeconds[1] - total
    if (room < EDIT_LIMITS.minSegment) break
    if (to - from > room) to = r1(from + room)
    segments.push({ slot: s.slot, from, to })
    total = r1(total + (to - from))
  }
  if (total < EDIT_LIMITS.outSeconds[0]) return err({ code: 'content_invalid', field: 'media' })

  const fixes = new Map(proposal.lineFixes.map((f) => [f.id, f]))
  const lines: SubtitleLine[] = []
  let offset = 0
  for (const s of segments) {
    for (const t of transcript) {
      if (t.slot !== s.slot || t.end <= s.from || t.start >= s.to) continue
      const id = lineId(t.slot, t.index)
      const fix = fixes.get(id)
      const text = (fix?.text.trim() || t.text.trim()).slice(0, EDIT_LIMITS.line)
      if (!text) continue
      const start = r1(offset + Math.max(t.start, s.from) - s.from)
      const end = r1(offset + Math.min(t.end, s.to) - s.from)
      if (end - start < 0.3) continue
      if (lines.some((l) => l.id === id)) continue // a phrase cut into two segments is shown once
      lines.push({ id, start, end, text, unsure: Boolean(fix?.unsure) })
    }
    offset = r1(offset + (s.to - s.from))
  }

  const active = new Set(tracks.filter((t) => t.active).map((t) => t.id))
  return ok({
    segments,
    seconds: total,
    hook: proposal.hook.trim().slice(0, EDIT_LIMITS.hook),
    coverAt: r1(Math.min(Math.max(0, proposal.coverAt), Math.max(0, total - 0.1))),
    musicTrackId: proposal.musicTrackId && active.has(proposal.musicTrackId) ? proposal.musicTrackId : null,
    subtitles: proposal.subtitles && lines.length > 0,
    lines,
    notes: proposal.notes.slice(0, 5).map((n) => ({ level: n.level === 'warn' ? 'warn' : 'ok', text: n.text.slice(0, 240) })),
  })
}

/** A re-edit: the cuts stay, a person's changes win. Edited lines are no longer "unsure". */
export function applyEditOverrides(plan: ContentEditPlan, o: ContentEditOverrides, tracks: readonly Pick<MusicTrack, 'id' | 'active'>[]): ContentEditPlan {
  const edited = new Map(o.lines.map((l) => [l.id, l.text]))
  const active = new Set(tracks.filter((t) => t.active).map((t) => t.id))
  return {
    ...plan,
    hook: o.hook,
    musicTrackId: o.musicTrackId && active.has(o.musicTrackId) ? o.musicTrackId : null,
    subtitles: o.subtitles,
    lines: plan.lines
      .map((l) => (edited.has(l.id) ? { ...l, text: edited.get(l.id)!, unsure: edited.get(l.id) === l.text ? l.unsure : false } : l))
      .filter((l) => l.text.length > 0),
  }
}
