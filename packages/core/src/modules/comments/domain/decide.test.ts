import { describe, expect, it } from 'vitest'

import { instant, type StudioId } from '../../../shared'
import { checkReply, containsPrice, decideDismiss, decideHidden, decideReceiveComment, decideReplied } from './decide'
import type { IgComment } from './types'

const NOW = 1_793_800_000_000
const DAY = 86_400_000
const ctx = (role = 'receptionist', now = NOW) => ({ studioId: 'std_1' as StudioId, actor: { type: 'staff', id: role } as never, role, now: instant(now), correlationId: 'cor_1', source: 'reception_web' })
const comment = (over: Partial<Parameters<typeof decideReceiveComment>[1]> = {}): IgComment => {
  const r = decideReceiveComment(ctx('system'), {
    id: '17900000000000001',
    mediaId: '17993305386106335',
    mediaLabel: 'Reformer ilk ders',
    mediaPermalink: null,
    username: 'GİZLİ_KULLANICI',
    text: 'GİZLİ_METİN fiyat?',
    commentedAt: instant(NOW - 2 * 3_600_000),
    category: 'question',
    draft: 'Merhaba! DM’den iletelim 🌿',
    ...over,
  })
  if (!r.ok) throw new Error()
  return r.value.next
}

describe('arriving', () => {
  it('a recent comment is open work; no text or username in the event', () => {
    const r = decideReceiveComment(ctx('system'), { ...comment(), commentedAt: instant(NOW - DAY) })
    expect(r.ok && r.value.next.status).toBe('open')
    expect(JSON.stringify(r.ok && r.value.events)).not.toMatch(/GİZLİ/)
  })
  it('first run: EXACTLY 7 days is still open, a minute older is closed history', () => {
    expect(comment({ commentedAt: instant(NOW - 7 * DAY) }).status).toBe('open')
    expect(comment({ commentedAt: instant(NOW - 7 * DAY - 60_000) }).status).toBe('closed')
  })
  it('spam gets no draft', () => expect(comment({ category: 'spam' }).draft).toBeNull())
  it('an unknown category becomes "other"', () => expect(comment({ category: 'weird' as never }).category).toBe('other'))
})

describe('replying — a person sends, never the AI', () => {
  it('reception replies to a question with the draft as it is', () => {
    const c = comment()
    const r = decideReplied(ctx(), c, { text: c.draft!, igReplyId: 'r1' })
    expect(r.ok && r.value.next).toMatchObject({ status: 'replied', reply: { edited: false } })
    expect(r.ok && r.value.events[0]?.payload).toEqual({ category: 'question', edited: false, hadDraft: true })
  })
  it('an edited draft is recorded as edited', () => expect(decideReplied(ctx(), comment(), { text: 'Kendi cevabım', igReplyId: 'r1' })).toMatchObject({ ok: true, value: { next: { reply: { edited: true } } } }))
  it('a trainer cannot answer in the studio name', () => expect(checkReply(ctx('trainer'), comment(), 'x')).toEqual({ ok: false, error: { code: 'comment_forbidden' } }))
  it('a complaint: reception may not, the owner may', () => {
    const c = comment({ category: 'complaint' })
    expect(checkReply(ctx('receptionist'), c, 'Üzgünüz')).toEqual({ ok: false, error: { code: 'comment_forbidden' } })
    expect(checkReply(ctx('owner'), c, 'Üzgünüz').ok).toBe(true)
    expect(decideDismiss(ctx('receptionist'), c)).toEqual({ ok: false, error: { code: 'comment_forbidden' } })
  })
  it.each(['Paket 1.500 TL', '1500₺ aylık', '₺ 900', '900 lira', 'fiyat 2.000tl'])('a price is refused: %s', (t) =>
    expect(checkReply(ctx(), comment(), t)).toEqual({ ok: false, error: { code: 'comment_invalid', field: 'price' } }))
  it.each(['Haftada 2 gün için DM’den yazın', '10 kişilik sınıflar', 'Saat 19:00 dersimiz var'])('not a price: %s', (t) => expect(containsPrice(t)).toBe(false))
  it('empty / over 2.200 characters is refused', () => {
    expect(checkReply(ctx(), comment(), '   ')).toMatchObject({ ok: false, error: { field: 'text' } })
    expect(checkReply(ctx(), comment(), 'x'.repeat(2200)).ok).toBe(true)
    expect(checkReply(ctx(), comment(), 'x'.repeat(2201)).ok).toBe(false)
  })
  it('a replied comment is not replied again', () => {
    const r = decideReplied(ctx(), comment(), { text: 'a', igReplyId: 'r1' })
    if (!r.ok) throw new Error()
    expect(checkReply(ctx(), r.value.next, 'b')).toEqual({ ok: false, error: { code: 'comment_not_open' } })
  })
})

describe('hiding — the owner only', () => {
  it('reception cannot hide', () => expect(decideHidden(ctx(), comment({ category: 'spam' }))).toEqual({ ok: false, error: { code: 'comment_forbidden' } }))
  it('the owner hides spam, even an old closed one', () => {
    expect(decideHidden(ctx('owner'), comment({ category: 'spam' }))).toMatchObject({ ok: true, value: { next: { status: 'hidden' } } })
    expect(decideHidden(ctx('owner'), comment({ commentedAt: instant(NOW - 30 * DAY) })).ok).toBe(true)
  })
  it('a dismissed comment cannot be hidden from here', () => {
    const r = decideDismiss(ctx(), comment())
    if (!r.ok) throw new Error()
    expect(decideHidden(ctx('owner'), r.value.next)).toEqual({ ok: false, error: { code: 'comment_not_open' } })
  })
})
