import { describe, expect, it } from 'vitest'

import { instant, type StudioId } from '../../../shared'
import { decidePlanPost } from './decide'
import {
  applyEditOverrides,
  decideAddRawClip,
  decideEditFailed,
  decideEditRendered,
  decideRequestEdit,
  EDIT_STALE_MS,
  normalizeEditPlan,
  type AiEditProposal,
} from './edit'
import { decideApprovePublish, decideAttachMedia } from './publish'
import type { ContentEditPlan, ContentPost } from './types'

const NOW = 1_793_800_000_000
const H = 3_600_000
const MB = 1024 * 1024
const ctx = (role = 'trainer', now = NOW, cor = 'cor_1') => ({
  studioId: 'std_1' as StudioId,
  actor: { type: 'staff', id: role } as never,
  role,
  now: instant(now),
  correlationId: cor,
  source: 'reception_web',
})

const plan = (format: 'reels' | 'photo' | 'story' = 'reels'): ContentPost => {
  const r = decidePlanPost(ctx(), {
    id: 'cpo_1',
    weekStart: '2026-11-02',
    origin: 'ai',
    fields: {
      scheduledFor: instant(NOW + 24 * H),
      format,
      title: 'İlk ders',
      shotCard: { clips: [{ seconds: 6, angle: 'yan', what: 'giriş' }], hook: 'İlk dersinde', notes: '', music: '' },
      caption: 'x',
      hashtags: [],
    },
  })
  if (!r.ok) throw new Error()
  return r.value.next
}
const clip = (slot: number, over: Partial<{ bytes: number; seconds: number; contentType: string }> = {}) => ({
  slot,
  storagePath: `studios/std_1/content/cpo_1/raw/${slot}.mp4`,
  contentType: 'video/mp4',
  bytes: 100 * MB,
  seconds: 20,
  width: 1080,
  height: 1920,
  ...over,
})
const withClips = (p = plan(), n = 2) => {
  let cur = p
  for (let i = 0; i < n; i++) {
    const r = decideAddRawClip(ctx(), cur, clip(i))
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    cur = r.value.next
  }
  return cur
}
const rendering = (p = withClips()) => {
  const r = decideRequestEdit(ctx(), p, null)
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value.next
}
const PLAN: ContentEditPlan = {
  segments: [{ slot: 0, from: 1, to: 8 }],
  seconds: 7,
  hook: 'İlk dersinde',
  coverAt: 6,
  musicTrackId: null,
  subtitles: true,
  lines: [{ id: '0:0', start: 0, end: 2, text: 'merhaba', unsure: true }],
  notes: [{ level: 'ok', text: 'Dikey' }],
}
const OUT = { storagePath: 'studios/std_1/content/cpo_1/out.mp4', kind: 'video' as const, contentType: 'video/mp4', bytes: 30 * MB, seconds: 7, width: 1080, height: 1920 }

describe('raw clips', () => {
  it('a trainer adds clips; slots are kept in order', () => {
    const p = withClips(plan(), 3)
    expect(p.rawClips?.map((c) => c.slot)).toEqual([0, 1, 2])
  })
  it('the same slot replaces the clip', () => {
    const r = decideAddRawClip(ctx(), withClips(), clip(1, { seconds: 9 }))
    expect(r.ok && r.value.next.rawClips?.length).toBe(2)
    expect(r.ok && r.value.events[0]?.payload).toMatchObject({ slot: 1, replaced: true, clipCount: 2 })
  })
  it.each([
    ['a photo post', () => decideAddRawClip(ctx(), plan('photo'), clip(0)), 'content_invalid'],
    ['slot 8 (a 9th clip)', () => decideAddRawClip(ctx(), plan(), clip(8)), 'content_invalid'],
    ['a .webm', () => decideAddRawClip(ctx(), plan(), clip(0, { contentType: 'video/webm' })), 'content_invalid'],
    ['a clip over 500 MB', () => decideAddRawClip(ctx(), plan(), clip(0, { bytes: 501 * MB })), 'content_invalid'],
    ['under 1 second', () => decideAddRawClip(ctx(), plan(), clip(0, { seconds: 0.5 })), 'content_invalid'],
  ])('refused: %s', (_w, f, code) => expect(f()).toMatchObject({ ok: false, error: { code } }))
  it('1 GB in all: EXACTLY 1 GB passes, one byte more is refused', () => {
    let p = plan()
    for (let i = 0; i < 2; i++) {
      const r = decideAddRawClip(ctx(), p, clip(i, { bytes: 500 * MB }))
      if (!r.ok) throw new Error()
      p = r.value.next
    }
    expect(decideAddRawClip(ctx(), p, clip(2, { bytes: 24 * MB })).ok).toBe(true)
    expect(decideAddRawClip(ctx(), p, clip(2, { bytes: 24 * MB + 1 })).ok).toBe(false)
  })
  it('not while an edit renders', () => expect(decideAddRawClip(ctx(), rendering(), clip(3))).toMatchObject({ ok: false }))
})

describe('asking for an edit', () => {
  it('needs at least one clip', () => expect(decideRequestEdit(ctx(), plan(), null)).toEqual({ ok: false, error: { code: 'content_invalid', field: 'media' } }))
  it('starts rendering; the request id is the correlation id', () => {
    const p = rendering()
    expect(p.edit).toMatchObject({ status: 'rendering', requestId: 'cor_1', overrides: null })
  })
  it('a second press while it renders is refused', () => expect(decideRequestEdit(ctx(), rendering(), null)).toMatchObject({ ok: false, error: { code: 'operation_already_applied' } }))
  it('a render silent for 30 minutes may be asked again — not a minute before', () => {
    const p = rendering()
    expect(decideRequestEdit(ctx('trainer', NOW + EDIT_STALE_MS), p, null).ok).toBe(false)
    expect(decideRequestEdit(ctx('trainer', NOW + EDIT_STALE_MS + 1), p, null).ok).toBe(true)
  })
  it('an APPROVED post is withdrawn at once — the old file cannot go out while the new one renders', () => {
    const withFile = decideAttachMedia(ctx(), withClips(), OUT, null)
    if (!withFile.ok) throw new Error()
    const s = decideApprovePublish(ctx('owner'), withFile.value.next, true)
    if (!s.ok) throw new Error()
    const r = decideRequestEdit(ctx(), s.value.next, null)
    expect(r.ok && r.value.next).toMatchObject({ status: 'approved', publish: null })
    expect(r.ok && r.value.events[0]?.payload).toMatchObject({ approvalWithdrawn: true, redo: false })
  })
  it('a re-edit needs a previous plan', () =>
    expect(decideRequestEdit(ctx(), withClips(), { hook: '', lines: [], musicTrackId: null, subtitles: true })).toMatchObject({ ok: false, error: { code: 'operation_not_applicable' } }))
  it('a re-edit may only change lines that exist', () => {
    const done = decideEditRendered(ctx('system'), rendering(), { requestId: 'cor_1', plan: PLAN, media: OUT })
    if (!done.ok) throw new Error(JSON.stringify(done.error))
    expect(decideRequestEdit(ctx(), done.value.next, { hook: 'x', lines: [{ id: '9:9', text: 'y' }], musicTrackId: null, subtitles: true }).ok).toBe(false)
    const r = decideRequestEdit(ctx(), done.value.next, { hook: 'x', lines: [{ id: '0:0', text: 'Merhaba' }], musicTrackId: null, subtitles: false })
    expect(r.ok && r.value.events[0]?.payload).toMatchObject({ redo: true, subtitles: false })
  })
})

describe('the render answers ITS request only', () => {
  it('done: the file is attached, the plan kept, the AI notes shown', () => {
    const r = decideEditRendered(ctx('system'), rendering(), { requestId: 'cor_1', plan: PLAN, media: OUT })
    expect(r.ok && r.value.next.edit?.status).toBe('ready')
    expect(r.ok && r.value.next.media).toMatchObject({ storagePath: OUT.storagePath, coverAtMs: 6000 })
    expect(r.ok && r.value.next.aiCheck?.notes).toEqual(PLAN.notes)
    expect(r.ok && r.value.events.map((e) => e.type)).toEqual(['content_post.media_attached'])
  })
  it('a duplicate or late result is refused (another request owns the post now)', () => {
    const p = rendering()
    expect(decideEditRendered(ctx('system'), p, { requestId: 'cor_OLD', plan: PLAN, media: OUT }).ok).toBe(false)
    const done = decideEditRendered(ctx('system'), p, { requestId: 'cor_1', plan: PLAN, media: OUT })
    if (!done.ok) throw new Error()
    expect(decideEditRendered(ctx('system'), done.value.next, { requestId: 'cor_1', plan: PLAN, media: OUT }).ok).toBe(false)
  })
  it('a render outside Instagram limits is refused like any upload', () =>
    expect(decideEditRendered(ctx('system'), rendering(), { requestId: 'cor_1', plan: PLAN, media: { ...OUT, seconds: 2 } })).toMatchObject({ ok: false, error: { code: 'content_invalid' } }))
  it('failed: the stage is logged, the message stays on the card', () => {
    const r = decideEditFailed(ctx('system'), rendering(), { requestId: 'cor_1', stage: 'render', message: 'GİZLİ-FFMPEG' })
    expect(r.ok && r.value.next.edit).toMatchObject({ status: 'failed', failure: { stage: 'render' } })
    expect(JSON.stringify(r.ok && r.value.events)).not.toContain('GİZLİ')
    if (!r.ok) throw new Error()
    expect(decideRequestEdit(ctx('trainer', NOW + 60_000, 'cor_2'), r.value.next, null).ok).toBe(true) // "Tekrar dene"
  })
})

describe('normalizing the AI proposal', () => {
  const clips = [
    { slot: 0, seconds: 20 },
    { slot: 1, seconds: 10 },
  ]
  const t = [
    { slot: 1, index: 0, start: 1, end: 3, text: 'merhba' },
    { slot: 1, index: 1, start: 8, end: 12, text: 'nefes' },
    { slot: 0, index: 0, start: 15, end: 16, text: 'görülmeyen' },
  ]
  const prop = (over: Partial<AiEditProposal> = {}): AiEditProposal => ({
    segments: [
      { slot: 0, from: 2, to: 6 },
      { slot: 1, from: 0, to: 9 },
    ],
    hook: ' İlk dersinde ',
    coverAt: 12,
    musicTrackId: 'trk_calm',
    subtitles: true,
    lineFixes: [{ id: '1:0', text: 'merhaba', unsure: true }],
    notes: [],
    ...over,
  })
  const tracks = [
    { id: 'trk_calm', active: true },
    { id: 'trk_off', active: false },
  ]
  it('maps the speech onto the output timeline and applies the fixes', () => {
    const r = normalizeEditPlan(prop(), clips, t, tracks)
    expect(r.ok && r.value).toMatchObject({ seconds: 13, hook: 'İlk dersinde', musicTrackId: 'trk_calm' })
    expect(r.ok && r.value.lines).toEqual([
      { id: '1:0', start: 5, end: 7, text: 'merhaba', unsure: true },
      { id: '1:1', start: 12, end: 13, text: 'nefes', unsure: false }, // cut at the segment end
    ])
  })
  it('a segment past its clip is clipped; one that does not exist is dropped', () => {
    const r = normalizeEditPlan(prop({ segments: [{ slot: 1, from: 5, to: 30 }, { slot: 7, from: 0, to: 5 }] }), clips, t, tracks)
    expect(r.ok && r.value.segments).toEqual([{ slot: 1, from: 5, to: 10 }])
  })
  it('the length is cut at EXACTLY 90 seconds', () => {
    const long = [{ slot: 0, seconds: 900 }]
    const r = normalizeEditPlan(prop({ segments: [{ slot: 0, from: 0, to: 60 }, { slot: 0, from: 100, to: 160 }] }), long, [], tracks)
    expect(r.ok && r.value.seconds).toBe(90)
    expect(r.ok && r.value.segments[1]).toEqual({ slot: 0, from: 100, to: 130 })
  })
  it('under 3 seconds → refused', () => expect(normalizeEditPlan(prop({ segments: [{ slot: 0, from: 0, to: 2.9 }] }), clips, t, tracks).ok).toBe(false))
  it('a switched-off track is not used', () => expect(normalizeEditPlan(prop({ musicTrackId: 'trk_off' }), clips, t, tracks)).toMatchObject({ ok: true, value: { musicTrackId: null } }))
  it('no speech → no subtitles, whatever the AI said', () => expect(normalizeEditPlan(prop(), clips, [], tracks)).toMatchObject({ ok: true, value: { subtitles: false, lines: [] } }))
  it('a re-edit: the cuts stay, the edited line is no longer unsure, an emptied line disappears', () => {
    const r = normalizeEditPlan(prop(), clips, t, tracks)
    if (!r.ok) throw new Error()
    const p = applyEditOverrides(r.value, { hook: 'Yeni', lines: [{ id: '1:0', text: 'Merhaba!' }, { id: '1:1', text: '' }], musicTrackId: 'trk_off', subtitles: true }, tracks)
    expect(p.segments).toEqual(r.value.segments)
    expect(p).toMatchObject({ hook: 'Yeni', musicTrackId: null })
    expect(p.lines).toEqual([{ id: '1:0', start: 5, end: 7, text: 'Merhaba!', unsure: false }])
  })
})
