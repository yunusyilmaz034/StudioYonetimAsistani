import type { ActorRef, Instant, StudioId } from '../../../shared'
import type { ContentFormat, ContentOrigin } from '../events'

/** One clip the studio films: how long, from where, showing what. */
export interface ShotClip {
  readonly seconds: number
  readonly angle: string // "yakın plan", "yan açı, bel hizası"
  readonly what: string // what must be in frame
}

export interface ShotCard {
  readonly clips: readonly ShotClip[] // photo: one "clip" = the frame to take
  readonly hook: string // on-screen text for the first 3 seconds ('' for a photo)
  readonly notes: string // light, phone orientation, anything else
  readonly music: string // mood + source, e.g. "sakin · Meta Sound Collection" ('' = none)
}

export type ContentStatus = 'suggested' | 'approved' | 'removed'

export interface ContentPost {
  readonly id: string
  readonly studioId: StudioId
  readonly weekStart: string // 'YYYY-MM-DD' — Monday, Europe/Istanbul
  readonly scheduledFor: Instant
  readonly format: ContentFormat
  readonly origin: ContentOrigin
  readonly title: string
  readonly shotCard: ShotCard
  readonly caption: string
  readonly hashtags: readonly string[] // without '#', as typed
  readonly status: ContentStatus
  readonly createdAt: Instant
  readonly createdBy: ActorRef
  readonly approvedAt: Instant | null
  readonly approvedBy: ActorRef | null
  readonly consentConfirmed: boolean
}

/** The editable part — what a human may change on a post. */
export type ContentPostFields = Pick<ContentPost, 'scheduledFor' | 'format' | 'title' | 'shotCard' | 'caption' | 'hashtags'>
