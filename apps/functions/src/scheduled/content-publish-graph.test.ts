import { describe, expect, it } from 'vitest'

import { containerParams, containerState } from './content-publish-graph'

describe('containerParams', () => {
  it('reels', () => expect(containerParams({ format: 'reels', kind: 'video', url: 'U', caption: 'C' })).toEqual({ media_type: 'REELS', video_url: 'U', caption: 'C', share_to_feed: 'true' }))
  it('photo', () => expect(containerParams({ format: 'photo', kind: 'image', url: 'U', caption: 'C' })).toEqual({ image_url: 'U', caption: 'C' }))
  it('story video carries no caption', () => expect(containerParams({ format: 'story', kind: 'video', url: 'U', caption: 'C' })).toEqual({ media_type: 'STORIES', video_url: 'U' }))
  it('story photo', () => expect(containerParams({ format: 'story', kind: 'image', url: 'U', caption: 'C' })).toEqual({ media_type: 'STORIES', image_url: 'U' }))
})

describe('containerState', () => {
  it.each([
    ['FINISHED', 'ready'],
    ['IN_PROGRESS', 'wait'],
    [undefined, 'wait'],
    ['ERROR', 'error'],
    ['EXPIRED', 'error'],
  ] as const)('%s → %s', (code, want) => expect(containerState(code)).toBe(want))
})
