import { describe, expect, it } from 'vitest'

import { decidePlanPost } from '../../src/modules/content/domain/decide'
import { decideAddRawClip, decideEditFailed, decideRequestEdit } from '../../src/modules/content/domain/edit'
import { instant, type StudioId } from '../../src/shared'
import failed from './content_post.edit_failed.v1.json'
import requested from './content_post.edit_requested.v1.json'
import added from './content_post.raw_clip_added.v1.json'

// IG-2c (2026-11-04) — NEW event types. Counts, sizes, stages. Never the path, the transcript or the hook.
const NOW = 1_793_800_000_000
const ctx = { studioId: 'std_1' as StudioId, actor: { type: 'staff', id: 'usr_t' } as never, role: 'trainer', now: instant(NOW), correlationId: 'cor_1', source: 'reception_web' }
const clean = (e: unknown) => expect(JSON.stringify(e)).not.toMatch(/GİZLİ|\.mp4/)

describe('content edit events', () => {
  const planned = decidePlanPost(ctx, {
    id: 'cpo_1',
    weekStart: '2026-11-02',
    origin: 'ai',
    fields: { scheduledFor: instant(NOW + 86_400_000), format: 'reels', title: 'GİZLİ', shotCard: { clips: [{ seconds: 10, angle: '', what: 'x' }], hook: 'GİZLİ', notes: '', music: '' }, caption: 'GİZLİ', hashtags: [] },
  })
  if (!planned.ok) throw new Error('setup')
  const a = decideAddRawClip(ctx, planned.value.next, { slot: 0, storagePath: 'studios/std_1/content/cpo_1/raw/GİZLİ.mp4', contentType: 'video/mp4', bytes: 104_857_600, seconds: 20, width: 1080, height: 1920 })
  if (!a.ok) throw new Error('setup')
  const r = decideRequestEdit(ctx, a.value.next, null)
  if (!r.ok) throw new Error('setup')

  it('content_post.raw_clip_added', () => {
    expect(a.value.events[0]?.payload).toEqual(added)
    clean(a.value.events)
  })
  it('content_post.edit_requested', () => expect(r.value.events[0]?.payload).toEqual(requested))
  it('content_post.edit_failed', () => {
    const f = decideEditFailed(ctx, r.value.next, { requestId: 'cor_1', stage: 'render', message: 'GİZLİ' })
    expect(f.ok && f.value.events[0]?.payload).toEqual(failed)
    clean(f.ok && f.value.events)
  })
})
