import type { FeedbackReason, FeedbackStatus, ProgramStatus } from '@studio/core'

// Turkish labels + tones for the training module, shared by the staff screens and the member portal
// so the two never drift. Colour never carries meaning alone — every chip is written out too.
//
// The reason ORDER for the member's picker lives here, not imported from `@studio/core`: a runtime
// value pulled from the core barrel would drag firebase-admin into the client bundle. This list is
// the same closed enum, kept in step by the exhaustive `FeedbackReason`-keyed maps below.
export const FEEDBACK_REASONS: readonly FeedbackReason[] = [
  'too_hard',
  'too_easy',
  'pain',
  'not_felt',
  'machine_busy',
  'video_unclear',
  'other',
]

export const FEEDBACK_REASON_LABEL: Record<FeedbackReason, string> = {
  pain: 'Ağrı',
  too_easy: 'Çok kolay',
  too_hard: 'Çok zor',
  not_felt: 'Hissetmedim',
  machine_busy: 'Alet meşgul',
  video_unclear: 'Video anlaşılmıyor',
  other: 'Diğer',
}

// `pain` is the one reason that is an operational signal, not a preference — it reads as a warning.
export const FEEDBACK_REASON_TONE: Record<FeedbackReason, string> = {
  pain: 'bg-danger/10 text-danger',
  too_easy: 'bg-primary-soft text-primary',
  too_hard: 'bg-warning/10 text-warning',
  not_felt: 'bg-muted text-muted-foreground',
  machine_busy: 'bg-muted text-muted-foreground',
  video_unclear: 'bg-muted text-muted-foreground',
  other: 'bg-muted text-muted-foreground',
}

export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: 'Yeni',
  answered: 'Yanıtlandı',
  resolved: 'Kapatıldı',
}

export const PROGRAM_STATUS_LABEL: Record<ProgramStatus, string> = {
  draft: 'Taslak',
  active: 'Aktif',
  completed: 'Tamamlandı',
  archived: 'Arşivlendi',
}

export const PROGRAM_STATUS_TONE: Record<ProgramStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-success/10 text-success',
  completed: 'bg-primary-soft text-primary',
  archived: 'bg-muted text-muted-foreground',
}

export const PHOTO_ANGLE_LABEL: Record<'front' | 'side' | 'back', string> = {
  front: 'Ön',
  side: 'Yan',
  back: 'Arka',
}
