import { describe, expect, it } from 'vitest'

import { classifyPrompt, parseClassification, pickNew } from './ig-comments-ai'

const c = (id: string, username = 'biri') => ({ id, text: 't', username, timestamp: '2026-11-04T10:00:00+0000', mediaId: 'm1' })

describe('which comments are new', () => {
  it('drops ours (ASCII, any case — "I" is not folded to "ı"), recorded ones and duplicates', () =>
    expect(pickNew([c('1'), c('2', 'PilatesByIsil'), c('3'), c('1')], 'pilatesbyisil', new Set(['3'])).map((x) => x.id)).toEqual(['1']))
})

describe('the AI', () => {
  it('never sees the username', () => expect(classifyPrompt([{ text: 'fiyat?', post: 'Reformer' }])).not.toContain('@'))
  it('reads its answer by number; spam loses its draft; unknown category → other', () =>
    expect(parseClassification(JSON.stringify({ items: [{ n: 2, category: 'spam', draft: 'x' }, { n: 1, category: 'weird', draft: 'Merhaba' }, { n: 9, category: 'praise', draft: 'y' }] }), 2)).toEqual([
      { category: 'other', draft: 'Merhaba' },
      { category: 'spam', draft: '' },
    ]))
  it('unreadable → every comment arrives as "other", no draft (a person still sees it)', () => expect(parseClassification('nope', 1)).toEqual([{ category: 'other', draft: '' }]))
})
