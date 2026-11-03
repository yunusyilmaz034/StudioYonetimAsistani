import { describe, expect, it } from 'vitest'

import { decideApprovePost, decideEditPost, decidePlanPost, decideRemovePost } from '../../src/modules/content/domain/decide'
import type { ContentPostFields } from '../../src/modules/content/domain/types'
import { instant, type StudioId } from '../../src/shared'
import approved from './content_post.approved.v1.json'
import edited from './content_post.edited.v1.json'
import planned from './content_post.planned.v1.json'
import removed from './content_post.removed.v1.json'

// IG-2a (2026-11-03) — NEW event types. The payloads carry the post's LIFECYCLE only; the title,
// shot card and caption stay on state, so none of the text below may appear in an event.

const ctx = {
  studioId: 'std_1' as StudioId,
  actor: { type: 'owner', id: 'usr_owner' } as never,
  role: 'owner',
  now: instant(1_793_700_000_000),
  correlationId: 'cor_1',
  source: 'reception_web',
}
const fields: ContentPostFields = {
  scheduledFor: instant(1_793_786_400_000),
  format: 'reels',
  title: 'GİZLİ-BAŞLIK',
  shotCard: { clips: [{ seconds: 3, angle: 'yakın', what: 'GİZLİ-KADRAJ' }, { seconds: 5, angle: 'yan', what: 'eğitmen' }], hook: 'GİZLİ-KANCA', notes: '', music: '' },
  caption: 'GİZLİ-METİN Ayşe',
  hashtags: ['reformerpilates'],
}
const noText = (e: unknown) => expect(JSON.stringify(e)).not.toMatch(/GİZLİ|Ayşe/)

describe('content events', () => {
  const p = decidePlanPost(ctx, { id: 'cnt_1', weekStart: '2026-11-02', origin: 'ai', fields })
  if (!p.ok) throw new Error('setup')

  it('content_post.planned', () => {
    expect(p.value.events[0]?.type).toBe('content_post.planned')
    expect(p.value.events[0]?.payload).toEqual(planned)
    noText(p.value.events)
  })

  it('content_post.approved', () => {
    const a = decideApprovePost(ctx, p.value.next, true)
    if (!a.ok) throw new Error()
    expect(a.value.events[0]?.payload).toEqual(approved)
    noText(a.value.events)
  })

  it('content_post.edited', () => {
    const a = decideApprovePost(ctx, p.value.next, true)
    if (!a.ok) throw new Error()
    const e = decideEditPost(ctx, a.value.next, { ...fields, caption: 'GİZLİ-YENİ', hashtags: ['pilates'] })
    if (!e.ok) throw new Error()
    expect(e.value.events[0]?.payload).toEqual(edited)
    noText(e.value.events)
  })

  it('content_post.removed', () => {
    const r = decideRemovePost(ctx, p.value.next)
    if (!r.ok) throw new Error()
    expect(r.value.events[0]?.payload).toEqual(removed)
  })
})
