import { describe, expect, it } from 'vitest'

import { decidePlanPost } from '../../src/modules/content/domain/decide'
import { decideApprovePublish, decideAttachMedia, decidePublished, decidePublishFailed, decideStartPublishing } from '../../src/modules/content/domain/publish'
import { instant, type StudioId } from '../../src/shared'
import approved from './content_post.publish_approved.v1.json'
import attached from './content_post.media_attached.v1.json'
import failed from './content_post.publish_failed.v1.json'
import published from './content_post.published.v1.json'
import started from './content_post.publish_started.v1.json'

// IG-2b (2026-11-04) — NEW event types. Sizes, times, ids. Never the caption, the file path or Meta's text.
const NOW = 1_793_800_000_000
const AT = NOW + 24 * 3_600_000
const ctx = (now = NOW) => ({ studioId: 'std_1' as StudioId, actor: { type: 'staff', id: 'usr_o' } as never, role: 'owner', now: instant(now), correlationId: 'cor_1', source: 'reception_web' })
const clean = (e: unknown) => expect(JSON.stringify(e)).not.toMatch(/GİZLİ|\.mp4/)

describe('content publishing events', () => {
  const planned = decidePlanPost(ctx(), {
    id: 'cpo_1',
    weekStart: '2026-11-02',
    origin: 'ai',
    fields: { scheduledFor: instant(AT), format: 'reels', title: 'GİZLİ-BAŞLIK', shotCard: { clips: [{ seconds: 10, angle: '', what: 'x' }], hook: '', notes: '', music: '' }, caption: 'GİZLİ-METİN', hashtags: [] },
  })
  if (!planned.ok) throw new Error('setup')
  const a = decideAttachMedia(ctx(), planned.value.next, { storagePath: 'studios/std_1/content/cpo_1/GİZLİ.mp4', kind: 'video', contentType: 'video/mp4', bytes: 88_080_384, seconds: 31, width: 1080, height: 1920 }, { notes: [{ level: 'warn', text: 'GİZLİ' }], at: instant(NOW) })
  if (!a.ok) throw new Error('setup')
  const p = decideApprovePublish(ctx(), a.value.next, true)
  if (!p.ok) throw new Error('setup')
  const s = decideStartPublishing(ctx(AT), p.value.next)
  if (!s.ok) throw new Error('setup')

  it('content_post.media_attached', () => {
    expect(a.value.events[0]?.payload).toEqual(attached)
    clean(a.value.events)
  })
  it('content_post.publish_approved', () => expect(p.value.events[0]?.payload).toEqual(approved))
  it('content_post.publish_started', () => expect(s.value.events[0]?.payload).toEqual(started))
  it('content_post.published', () => {
    const r = decidePublished(ctx(AT), s.value.next, { igMediaId: '17900000000000001', permalink: 'https://instagram.com/reel/GİZLİ' })
    expect(r.ok && r.value.events[0]?.payload).toEqual(published)
    clean(r.ok && r.value.events)
  })
  it('content_post.publish_failed', () => {
    const r = decidePublishFailed(ctx(AT), s.value.next, { stage: 'processing', metaCode: '2207026', message: 'GİZLİ-META' })
    expect(r.ok && r.value.events[0]?.payload).toEqual(failed)
    clean(r.ok && r.value.events)
  })
})
