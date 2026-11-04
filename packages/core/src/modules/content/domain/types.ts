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

// IG-2b: scheduled (publish approved, waiting for its time) → publishing (the lock) → published | failed.
export type ContentStatus = 'suggested' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'removed'

/** The file the studio filmed (IG-2b). Lives in private Storage; served to Meta by a short signed URL. */
export interface ContentMedia {
  readonly storagePath: string
  readonly kind: 'video' | 'image'
  readonly contentType: string
  readonly bytes: number
  readonly seconds: number | null // video only
  readonly width: number
  readonly height: number
  readonly uploadedAt: Instant
  readonly uploadedBy: ActorRef
  readonly coverAtMs?: number | null // IG-2c: the frame Instagram shows as the Reels cover
}

/** The AI's last look at the file — shown on the card, never in an event. */
export interface ContentAiCheck {
  readonly notes: readonly { readonly level: 'ok' | 'warn'; readonly text: string }[]
  readonly at: Instant
}

export interface ContentPublishState {
  readonly approvedAt: Instant
  readonly approvedBy: ActorRef
  readonly publishAt: Instant // max(scheduledFor, the moment of approval)
  readonly startedAt?: Instant | null // when a run took the lock — to spot a run that died mid-way
  readonly igMediaId: string | null
  readonly permalink: string | null
  readonly publishedAt: Instant | null
  readonly failure: { readonly stage: string; readonly metaCode: string | null; readonly message: string } | null
}

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
  // IG-2b — absent on IG-2a documents.
  readonly media?: ContentMedia | null
  readonly aiCheck?: ContentAiCheck | null
  readonly publish?: ContentPublishState | null
  // IG-2c — absent on older documents.
  readonly rawClips?: readonly ContentRawClip[]
  readonly edit?: ContentEditState | null
}

// ── IG-2c: the AI edit ─────────────────────────────────────────────────────────────────────────────

/** One unedited clip the team filmed. `slot` = the shot card's clip index; extras take the next free one. */
export interface ContentRawClip {
  readonly slot: number
  readonly storagePath: string
  readonly contentType: string
  readonly bytes: number
  readonly seconds: number
  readonly width: number
  readonly height: number
  readonly uploadedAt: Instant
  readonly uploadedBy: ActorRef
}

/** A piece of one raw clip, in source seconds. */
export interface EditSegment {
  readonly slot: number
  readonly from: number
  readonly to: number
}

/** One subtitle line on the OUTPUT timeline. `unsure` = the AI could not hear it clearly. */
export interface SubtitleLine {
  readonly id: string
  readonly start: number
  readonly end: number
  readonly text: string
  readonly unsure: boolean
}

export interface ContentEditPlan {
  readonly segments: readonly EditSegment[]
  readonly seconds: number // output length
  readonly hook: string // on screen for the first 3 seconds ('' = none)
  readonly coverAt: number // output second shown as the cover
  readonly musicTrackId: string | null
  readonly subtitles: boolean
  readonly lines: readonly SubtitleLine[]
  readonly notes: readonly { readonly level: 'ok' | 'warn'; readonly text: string }[]
}

/** What a person changed before "Yeniden kurgula" — the cuts stay, these are re-rendered. */
export interface ContentEditOverrides {
  readonly hook: string
  readonly lines: readonly { readonly id: string; readonly text: string }[]
  readonly musicTrackId: string | null
  readonly subtitles: boolean
}

export interface ContentEditState {
  readonly status: 'rendering' | 'ready' | 'failed'
  readonly requestId: string // a render's result is accepted only for the request it answers
  readonly requestedAt: Instant
  readonly requestedBy: ActorRef
  readonly plan: ContentEditPlan | null // the last good plan (kept across a re-edit)
  readonly overrides: ContentEditOverrides | null // present while a re-edit renders
  readonly failure: { readonly stage: string; readonly message: string } | null
  readonly renderedAt: Instant | null
}

/** A music track the owner made available (settings/content.music). Royalty-free, commercial use allowed. */
export interface MusicTrack {
  readonly id: string
  readonly name: string
  readonly mood: string
  readonly seconds: number
  readonly storagePath: string
  readonly source: string
  readonly active: boolean
}

/** The editable part — what a human may change on a post. */
export type ContentPostFields = Pick<ContentPost, 'scheduledFor' | 'format' | 'title' | 'shotCard' | 'caption' | 'hashtags'>
