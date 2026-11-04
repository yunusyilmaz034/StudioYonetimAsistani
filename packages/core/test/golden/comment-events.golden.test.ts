import { describe, expect, it } from 'vitest'

import { decideDismiss, decideHidden, decideReceiveComment, decideReplied } from '../../src/modules/comments/domain/decide'
import { instant, type StudioId } from '../../src/shared'
import dismissed from './ig_comment.dismissed.v1.json'
import hidden from './ig_comment.hidden.v1.json'
import received from './ig_comment.received.v1.json'
import replied from './ig_comment.replied.v1.json'

// IG-3 (2026-11-04) — NEW event types. Never the comment, the reply or the username.
const NOW = 1_793_800_000_000
const ctx = (role: string) => ({ studioId: 'std_1' as StudioId, actor: { type: 'staff', id: 'usr_1' } as never, role, now: instant(NOW), correlationId: 'cor_1', source: 'reception_web' })
const clean = (e: unknown) => expect(JSON.stringify(e)).not.toMatch(/GİZLİ/)
const input = (category: 'question' | 'spam' | 'praise') => ({
  id: '17900000000000001',
  mediaId: '17993305386106335',
  mediaLabel: 'GİZLİ',
  mediaPermalink: null,
  username: 'GİZLİ',
  text: 'GİZLİ',
  commentedAt: instant(NOW - 7_200_000),
  category,
  draft: 'GİZLİ taslak',
})

describe('comment events', () => {
  it('ig_comment.received', () => {
    const r = decideReceiveComment(ctx('system'), input('question'))
    expect(r.ok && r.value.events[0]?.payload).toEqual(received)
    clean(r.ok && r.value.events)
  })
  it('ig_comment.replied', () => {
    const r = decideReceiveComment(ctx('system'), input('question'))
    if (!r.ok) throw new Error()
    const p = decideReplied(ctx('receptionist'), r.value.next, { text: 'GİZLİ taslak', igReplyId: '1' })
    expect(p.ok && p.value.events[0]?.payload).toEqual(replied)
    clean(p.ok && p.value.events)
  })
  it('ig_comment.hidden', () => {
    const r = decideReceiveComment(ctx('system'), input('spam'))
    if (!r.ok) throw new Error()
    const h = decideHidden(ctx('owner'), r.value.next)
    expect(h.ok && h.value.events[0]?.payload).toEqual(hidden)
  })
  it('ig_comment.dismissed', () => {
    const r = decideReceiveComment(ctx('system'), input('praise'))
    if (!r.ok) throw new Error()
    const x = decideDismiss(ctx('receptionist'), r.value.next)
    expect(x.ok && x.value.events[0]?.payload).toEqual(dismissed)
  })
})
