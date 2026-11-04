import { describe, expect, it } from 'vitest'

import { instant, type Instant, type StudioId } from '../../../shared'
import { decideEditPost, decidePlanPost, decideRemovePost } from './decide'
import {
  isStalePublishing,
  decideApprovePublish,
  decideAttachMedia,
  decidePublished,
  decidePublishFailed,
  decideStartPublishing,
  decideWithdrawPublish,
  mediaFits,
  publishCaption,
} from './publish'
import type { ContentPost } from './types'

const NOW = 1_793_800_000_000
const H = 3_600_000
const ctx = (role = 'owner', now = NOW) => ({
  studioId: 'std_1' as StudioId,
  actor: { type: 'staff', id: role } as never,
  role,
  now: instant(now),
  correlationId: 'cor_1',
  source: 'reception_web',
})

const plan = (format: 'reels' | 'photo' | 'story' = 'reels', at = NOW + 24 * H): ContentPost => {
  const r = decidePlanPost(ctx('receptionist'), {
    id: 'cpo_1',
    weekStart: '2026-11-02',
    origin: 'ai',
    fields: {
      scheduledFor: instant(at),
      format,
      title: "Reformer'da ilk ders",
      shotCard: { clips: [{ seconds: 10, angle: 'yan', what: 'reformer' }], hook: 'İlk dersinde', notes: '', music: '' },
      caption: 'İlk dersin 30 saniyesi',
      hashtags: ['çayırovapilates'],
    },
  })
  if (!r.ok) throw new Error()
  return r.value.next
}

const video = (over: Partial<{ seconds: number; bytes: number; contentType: string }> = {}) => ({
  storagePath: 'studios/std_1/content/cpo_1/a.mp4',
  kind: 'video' as const,
  contentType: 'video/mp4',
  bytes: 84 * 1024 * 1024,
  seconds: 31,
  width: 1080,
  height: 1920,
  ...over,
})
const jpeg = (w = 1080, h = 1350) => ({ storagePath: 'x.jpg', kind: 'image' as const, contentType: 'image/jpeg', bytes: 900_000, seconds: null, width: w, height: h })

const withVideo = (p = plan()) => {
  const r = decideAttachMedia(ctx('trainer'), p, video(), null)
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value.next
}
const scheduled = (p = withVideo()) => {
  const r = decideApprovePublish(ctx(), p, true)
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value.next
}

describe("Instagram's file rules — refused at upload, not at 19:00", () => {
  it.each([
    ['reels: 31 s mp4', 'reels', video(), true],
    ['reels: EXACTLY 3 s', 'reels', video({ seconds: 3 }), true],
    ['reels: 2 s', 'reels', video({ seconds: 2 }), false],
    ['reels: EXACTLY 15 min', 'reels', video({ seconds: 900 }), true],
    ['reels: 15 min 1 s', 'reels', video({ seconds: 901 }), false],
    ['reels: 301 MB', 'reels', video({ bytes: 301 * 1024 * 1024 }), false],
    ['reels: a photo', 'reels', jpeg(), false],
    ['reels: a .webm', 'reels', video({ contentType: 'video/webm' }), false],
    ['story: 60 s video', 'story', video({ seconds: 60 }), true],
    ['story: 61 s video', 'story', video({ seconds: 61 }), false],
    ['story: a photo', 'story', jpeg(1080, 1920), true],
    ['photo: 4:5', 'photo', jpeg(1080, 1350), true],
    ['photo: 1.91:1', 'photo', jpeg(1910, 1000), true],
    ['photo: 9:16 is too tall for the feed', 'photo', jpeg(1080, 1920), false],
    ['photo: a PNG', 'photo', { ...jpeg(), contentType: 'image/png' }, false],
    ['photo: a video', 'photo', video(), false],
  ] as const)('%s', (_w, format, m, fits) => expect(mediaFits(format, m)).toBe(fits))
})

describe('attaching the file — anyone on the content screen', () => {
  it('a trainer attaches; the AI notes stay on state', () => {
    const r = decideAttachMedia(ctx('trainer'), plan(), video(), { notes: [{ level: 'warn', text: 'GİZLİ' }], at: instant(NOW) })
    expect(r.ok && r.value.next.media?.uploadedBy).toMatchObject({ id: 'trainer' })
    expect(JSON.stringify(r.ok && r.value.events)).not.toContain('GİZLİ')
    expect(JSON.stringify(r.ok && r.value.events)).not.toContain('a.mp4')
  })
  it('a wrong file is refused', () => expect(decideAttachMedia(ctx(), plan(), jpeg(), null)).toEqual({ ok: false, error: { code: 'content_invalid', field: 'media' } }))
  it('a NEW file after approval withdraws it', () => {
    const r = decideAttachMedia(ctx('trainer'), scheduled(), video({ seconds: 20 }), null)
    expect(r.ok && r.value.next).toMatchObject({ status: 'approved', publish: null })
    expect(r.ok && r.value.events[0]?.payload).toMatchObject({ replaced: true, approvalWithdrawn: true })
  })
})

describe('approval — the owner, the file, the consent', () => {
  it('approved → scheduled at its planned time', () => {
    const p = scheduled()
    expect(p.status).toBe('scheduled')
    expect(p.publish?.publishAt).toBe(NOW + 24 * H)
  })
  it.each(['receptionist', 'trainer', 'system'])('a %s cannot approve', (role) =>
    expect(decideApprovePublish(ctx(role), withVideo(), true)).toEqual({ ok: false, error: { code: 'content_approve_forbidden' } }))
  it('no file → refused', () => expect(decideApprovePublish(ctx(), plan(), true)).toEqual({ ok: false, error: { code: 'content_invalid', field: 'media' } }))
  it('"Şimdi yayınla": publishAt is now, not the planned time', () => {
    const r = decideApprovePublish(ctx(), scheduled(), true, { now: true })
    expect(r.ok && r.value.next.publish?.publishAt).toBe(NOW)
  })
  it('consent not ticked → refused', () => expect(decideApprovePublish(ctx(), withVideo(), false)).toEqual({ ok: false, error: { code: 'content_invalid', field: 'consent' } }))
  it('its time has passed → it goes out NOW, not refused', () => {
    const r = decideApprovePublish(ctx('owner', NOW + 30 * H), withVideo(), true)
    expect(r.ok && r.value.next.publish?.publishAt).toBe(NOW + 30 * H)
  })
  it('caption + hashtags over 2.200 characters in all → refused', () => {
    const p = { ...withVideo(), caption: 'x'.repeat(2190), hashtags: ['pilates', 'gebze'] }
    expect(decideApprovePublish(ctx(), p, true)).toEqual({ ok: false, error: { code: 'content_invalid', field: 'caption' } })
  })
  it('editing the caption after approval withdraws it', () => {
    const p = scheduled()
    const e = decideEditPost(ctx('receptionist'), p, { scheduledFor: p.scheduledFor, format: p.format, title: p.title, shotCard: p.shotCard, caption: 'yeni', hashtags: p.hashtags })
    expect(e.ok && e.value.next).toMatchObject({ status: 'suggested', publish: null })
  })
  it('the owner withdraws; nobody else can', () => {
    expect(decideWithdrawPublish(ctx(), scheduled())).toMatchObject({ ok: true, value: { next: { status: 'approved', publish: null } } })
    expect(decideWithdrawPublish(ctx('receptionist'), scheduled())).toEqual({ ok: false, error: { code: 'content_approve_forbidden' } })
  })
})

describe('publishing — once, at its time', () => {
  it('not before its time', () => expect(decideStartPublishing(ctx(), scheduled())).toEqual({ ok: false, error: { code: 'operation_not_applicable' } }))
  it('at its time: once — the second run is refused (no double post)', () => {
    const s = decideStartPublishing(ctx('system', NOW + 24 * H), scheduled())
    expect(s.ok && s.value.next.status).toBe('publishing')
    if (!s.ok) return
    expect(decideStartPublishing(ctx('system', NOW + 25 * H), s.value.next).ok).toBe(false)
  })
  it('a run that died: stale after 20 minutes, not before', () => {
    const s = decideStartPublishing(ctx('system', NOW + 24 * H), scheduled())
    if (!s.ok) throw new Error()
    expect(isStalePublishing(s.value.next, NOW + 24 * H + 20 * 60_000)).toBe(false)
    expect(isStalePublishing(s.value.next, NOW + 24 * H + 20 * 60_000 + 1)).toBe(true)
  })
  it('a post nobody approved never starts', () => expect(decideStartPublishing(ctx('system', NOW + 48 * H), withVideo()).ok).toBe(false))
  it('published: the id is kept; it cannot be edited or removed any more', () => {
    const s = decideStartPublishing(ctx('system', NOW + 24 * H), scheduled())
    if (!s.ok) throw new Error()
    const p = decidePublished(ctx('system', NOW + 24 * H), s.value.next, { igMediaId: '1790', permalink: 'https://instagram.com/reel/x' })
    if (!p.ok) throw new Error()
    expect(p.value.events[0]?.payload).toEqual({ igMediaId: '1790' })
    const n = p.value.next
    expect(decideEditPost(ctx(), n, { scheduledFor: instant(NOW + 99 * H), format: n.format, title: n.title, shotCard: n.shotCard, caption: 'x', hashtags: [] })).toEqual({ ok: false, error: { code: 'content_not_editable' } })
    expect(decideRemovePost(ctx(), n)).toEqual({ ok: false, error: { code: 'content_not_editable' } })
  })
  it('failed: Meta text stays on state; a new approval is needed', () => {
    const s = decideStartPublishing(ctx('system', NOW + 24 * H), scheduled())
    if (!s.ok) throw new Error()
    const f = decidePublishFailed(ctx('system', NOW + 24 * H), s.value.next, { stage: 'processing', metaCode: '2207026', message: 'GİZLİ-META' })
    if (!f.ok) throw new Error()
    expect(f.value.next.status).toBe('failed')
    expect(JSON.stringify(f.value.events)).not.toContain('GİZLİ')
    expect(decideStartPublishing(ctx('system', NOW + 26 * H), f.value.next).ok).toBe(false)
    expect(decideApprovePublish(ctx('receptionist', NOW + 26 * H), f.value.next, true).ok).toBe(false)
    expect(decideApprovePublish(ctx('owner', NOW + 26 * H), f.value.next, true)).toMatchObject({ ok: true, value: { next: { status: 'scheduled' } } }) // a NEW approval
    const again = decideAttachMedia(ctx('trainer', NOW + 26 * H), f.value.next, video({ seconds: 25 }), null)
    expect(again.ok && again.value.next.status).toBe('approved')
  })
})

it('caption: text, a blank line, the hashtags', () =>
  expect(publishCaption({ caption: 'İlk ders', hashtags: ['çayırovapilates', 'gebze'] })).toBe('İlk ders\n\n#çayırovapilates #gebze'))

export type _ = Instant
