import { describe, expect, it } from 'vitest'

import { instant, type StudioId } from '../../../shared'
import { CONTENT_LIMITS, decideApprovePost, decideEditPost, decidePlanPost, decideRemovePost, istanbulWeekStart } from './decide'
import type { ContentPostFields } from './types'

const NOW = 1_793_700_000_000 // 2026-11-03
const ctx = (role = 'owner') => ({
  studioId: 'std_1' as StudioId,
  actor: { type: role === 'owner' ? 'owner' : 'receptionist', id: 'usr_1' } as never,
  role,
  now: instant(NOW),
  correlationId: 'cor_1',
  source: 'reception_web',
})

const fields = (over: Partial<ContentPostFields> = {}): ContentPostFields => ({
  scheduledFor: instant(NOW + 86_400_000),
  format: 'reels',
  title: 'Reformer’da ilk dersin 3 saniyesi',
  shotCard: { clips: [{ seconds: 3, angle: 'yakın', what: 'ayak bara yerleşiyor' }], hook: 'İlk derste ne olur?', notes: '', music: '' },
  caption: 'İlk dersinde yalnız değilsin.',
  hashtags: ['reformerpilates'],
  ...over,
})

const plan = (f = fields()) => {
  const r = decidePlanPost(ctx(), { id: 'cnt_1', weekStart: '2026-11-02', origin: 'ai', fields: f })
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value.next
}

describe('decidePlanPost', () => {
  it('plans a suggested post with one event and no text in it', () => {
    const r = decidePlanPost(ctx('receptionist'), { id: 'cnt_1', weekStart: '2026-11-02', origin: 'staff', fields: fields() })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('suggested')
    expect(r.value.events).toHaveLength(1)
    expect(JSON.stringify(r.value.events)).not.toContain('Reformer')
    expect(JSON.stringify(r.value.events)).not.toContain('yalnız')
  })

  it.each([
    ['empty title', fields({ title: '   ' }), 'title'],
    ['121-char title', fields({ title: 'x'.repeat(121) }), 'title'],
    ['no clips', fields({ shotCard: { clips: [], hook: '', notes: '', music: '' } }), 'clips'],
    ['9 clips', fields({ shotCard: { clips: Array.from({ length: 9 }, () => ({ seconds: 2, angle: '', what: 'x' })), hook: '', notes: '', music: '' } }), 'clips'],
    ['a 61-second clip', fields({ shotCard: { clips: [{ seconds: 61, angle: '', what: 'x' }], hook: '', notes: '', music: '' } }), 'clips'],
    ['a 0-second clip', fields({ shotCard: { clips: [{ seconds: 0, angle: '', what: 'x' }], hook: '', notes: '', music: '' } }), 'clips'],
    ['a clip with nothing in frame', fields({ shotCard: { clips: [{ seconds: 3, angle: 'yan', what: ' ' }], hook: '', notes: '', music: '' } }), 'clips'],
    ['caption of 2.201', fields({ caption: 'x'.repeat(2201) }), 'caption'],
    ['31 hashtags', fields({ hashtags: Array.from({ length: 31 }, (_, i) => `tag${i}`) }), 'hashtags'],
    ['a time in the past', fields({ scheduledFor: instant(NOW - 1) }), 'scheduledFor'],
    ['an unknown format', fields({ format: 'carousel' as never }), 'format'],
  ])('refuses %s', (_why, f, field) => {
    const r = decidePlanPost(ctx(), { id: 'cnt_1', weekStart: '2026-11-02', origin: 'ai', fields: f })
    expect(r).toEqual({ ok: false, error: { code: 'content_invalid', field } })
  })

  it.each([
    ['caption of exactly 2.200', fields({ caption: 'x'.repeat(CONTENT_LIMITS.caption) })],
    ['exactly 30 hashtags', fields({ hashtags: Array.from({ length: 30 }, (_, i) => `tag${i}`) })],
    ['exactly 8 clips of 60 s', fields({ shotCard: { clips: Array.from({ length: 8 }, () => ({ seconds: 60, angle: '', what: 'x' })), hook: '', notes: '', music: '' } })],
    ['scheduled exactly now', fields({ scheduledFor: instant(NOW) })],
  ])('accepts %s', (_why, f) => {
    expect(decidePlanPost(ctx(), { id: 'cnt_1', weekStart: '2026-11-02', origin: 'ai', fields: f }).ok).toBe(true)
  })

  it('cleans hashtags: strips #, drops empties, folds Turkish-case duplicates', () => {
    const p = plan(fields({ hashtags: ['#Pilates', 'pilates', ' ', '##İstanbul', 'istanbul', 'Çayırova pilates'] }))
    expect(p.hashtags).toEqual(['Pilates', 'İstanbul', 'Çayırovapilates'])
  })

  it('31 tags that collapse to 30 are accepted — Instagram counts distinct tags', () => {
    const tags = [...Array.from({ length: 30 }, (_, i) => `tag${i}`), 'TAG0']
    expect(decidePlanPost(ctx(), { id: 'cnt_1', weekStart: '2026-11-02', origin: 'ai', fields: fields({ hashtags: tags }) }).ok).toBe(true)
  })
})

describe('decideApprovePost', () => {
  it('the owner approves, with the consent box recorded', () => {
    const r = decideApprovePost(ctx('owner'), plan(), true)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('approved')
    expect(r.value.events[0]?.payload).toMatchObject({ consentConfirmed: true })
  })

  it.each(['receptionist', 'trainer', 'member', 'kiosk'])('REFUSES a %s — only the owner approves (OR-131)', (role) => {
    expect(decideApprovePost(ctx(role), plan(), true)).toEqual({ ok: false, error: { code: 'content_approve_forbidden' } })
  })

  it('platform_admin may approve', () => expect(decideApprovePost(ctx('platform_admin'), plan(), false).ok).toBe(true))

  it('refuses twice, refuses a removed post, refuses a post whose time has passed', () => {
    const approved = decideApprovePost(ctx(), plan(), true)
    if (!approved.ok) throw new Error()
    expect(decideApprovePost(ctx(), approved.value.next, true)).toEqual({ ok: false, error: { code: 'operation_already_applied' } })
    const removed = decideRemovePost(ctx(), plan())
    if (!removed.ok) throw new Error()
    expect(decideApprovePost(ctx(), removed.value.next, true)).toEqual({ ok: false, error: { code: 'content_not_editable' } })
    const late = { ...plan(), scheduledFor: instant(NOW - 1) }
    expect(decideApprovePost(ctx(), late, true)).toEqual({ ok: false, error: { code: 'content_invalid', field: 'scheduledFor' } })
  })
})

describe('decideEditPost', () => {
  it('an edit after approval WITHDRAWS the approval', () => {
    const a = decideApprovePost(ctx(), plan(), true)
    if (!a.ok) throw new Error()
    const r = decideEditPost(ctx('receptionist'), a.value.next, fields({ caption: 'Yeni metin' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.next.status).toBe('suggested')
    expect(r.value.next.consentConfirmed).toBe(false)
    expect(r.value.events[0]?.payload).toEqual({ changedFields: ['caption'], approvalWithdrawn: true })
  })

  it('an edit that changes nothing writes nothing', () => {
    const p = plan()
    const r = decideEditPost(ctx(), p, fields())
    expect(r.ok && r.value.events.length).toBe(0)
  })

  it('a removed post cannot be edited', () => {
    const removed = decideRemovePost(ctx(), plan())
    if (!removed.ok) throw new Error()
    expect(decideEditPost(ctx(), removed.value.next, fields())).toEqual({ ok: false, error: { code: 'content_not_editable' } })
  })
})

describe('istanbulWeekStart', () => {
  it.each([
    ['Monday 00:30 Istanbul belongs to that Monday', 1_793_568_600_000 /* 2026-11-01T21:30Z */, '2026-11-02'],
    ['Sunday 23:30 Istanbul belongs to the previous Monday', 1_794_169_800_000 /* 2026-11-08T20:30Z */, '2026-11-02'],
    ['Sunday 21:00 UTC is already Monday in Istanbul', 1_794_171_600_000 /* 2026-11-08T21:00Z */, '2026-11-09'],
    ['Tuesday', NOW, '2026-11-02'],
  ])('%s', (_why, t, want) => expect(istanbulWeekStart(t)).toBe(want))
})
