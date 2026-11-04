// IG-2b — PURE: what the Instagram Content Publishing API receives for each format. Tested.
export interface ContainerInput {
  readonly format: 'reels' | 'photo' | 'story'
  readonly kind: 'video' | 'image'
  readonly url: string // a short signed URL Meta fetches the file from
  readonly caption: string
}

export function containerParams(i: ContainerInput): Record<string, string> {
  if (i.format === 'reels') return { media_type: 'REELS', video_url: i.url, caption: i.caption, share_to_feed: 'true' }
  if (i.format === 'photo') return { image_url: i.url, caption: i.caption }
  // Stories carry no caption on Instagram.
  return i.kind === 'video' ? { media_type: 'STORIES', video_url: i.url } : { media_type: 'STORIES', image_url: i.url }
}

/** Container status → keep waiting, go on, or stop. */
export function containerState(statusCode: string | undefined): 'wait' | 'ready' | 'error' {
  if (statusCode === 'FINISHED') return 'ready'
  if (statusCode === 'ERROR' || statusCode === 'EXPIRED') return 'error'
  return 'wait' // IN_PROGRESS, PUBLISHED-pending, or not yet reported
}
