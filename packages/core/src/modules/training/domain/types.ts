import type { ActorRef, Instant, StudioId } from '../../../shared'

// ── TRAINING & PROGRESS (Plus Phase 7). ──────────────────────────────────────────────────────
//
// Managing the member's development — NOT logging her actual workout. It assigns a programme, shows
// exercises with media, keeps measurements and photos over time, and carries a per-exercise feedback
// loop. Two disciplines carry the whole module:
//   • A programme is NEVER edited — every change is a new VERSION, history kept forever.
//   • A version SNAPSHOTS what it referenced (exercise name, media, sets…) at publish time, so
//     editing the exercise library tomorrow never rewrites a member's past programme (the same
//     snapshot discipline as SaleLine / productSnapshot).
// Photos and measurements are member PII — they live on the member's records, never in an event.

// ── Exercise library ──
export interface Exercise {
  readonly id: string
  readonly studioId: StudioId
  readonly nameTr: string
  readonly nameEn: string
  readonly description: string
  readonly muscleGroup: string
  readonly equipment: string
  readonly photoUrl: string | null
  readonly gifUrl: string | null
  readonly videoUrl: string | null // a secure/external reference (YouTube/Vimeo/Storage), never the file
  readonly tips: string
  readonly commonMistakes: string
  readonly alternativeExerciseIds: readonly string[]
  readonly active: boolean
  readonly version: number
  readonly updatedBy: string
  readonly updatedAt: Instant
}

// ── Programme + its versions (the snapshot lives on the version) ──
export type ProgramStatus = 'draft' | 'active' | 'completed' | 'archived'

// A single exercise slot within a programme day — snapshotted from the library at publish time.
export interface ProgramExercise {
  readonly exerciseId: string
  readonly order: number
  // The SNAPSHOT — what the exercise looked like when this version was published (§6). The library
  // may change afterwards; this does not.
  readonly nameTr: string
  readonly videoUrl: string | null
  readonly description: string
  readonly sets: number
  readonly reps: string // "12" or "8-10" or "failure"
  readonly restSeconds: number
  readonly tempo: string
  readonly note: string
  readonly alternativeExerciseId: string | null
}

export interface ProgramDay {
  readonly order: number
  readonly name: string // "Pazartesi" / "Gün 1 — İtiş" — free, not a fixed 3-day week
  readonly exercises: readonly ProgramExercise[]
}

export interface ProgramVersion {
  readonly version: number
  readonly note: string
  readonly days: readonly ProgramDay[]
  readonly publishedBy: ActorRef
  readonly publishedAt: Instant
}

export interface Program {
  readonly id: string
  readonly studioId: StudioId
  readonly memberId: string
  readonly trainerId: string
  readonly title: string
  readonly status: ProgramStatus
  readonly startsOn: string | null // LocalDate
  readonly endsOn: string | null
  readonly currentVersion: number
  readonly versions: readonly ProgramVersion[] // append-only; a revision adds one, never edits
  readonly createdAt: Instant
  readonly updatedAt: Instant
}

// ── Measurements (a tarihçe — every reading a new record; corrections are compensating) ──
export interface Measurement {
  readonly id: string
  readonly studioId: StudioId
  readonly memberId: string
  readonly takenOn: string // LocalDate
  readonly weightKg: number | null
  readonly fatPercent: number | null
  readonly musclePercent: number | null
  readonly waterPercent: number | null
  readonly bmi: number | null
  readonly bmr: number | null
  readonly visceralFat: number | null
  // Circumference measures (cm) + any extra device metric, kept as a free map so a new scale's field
  // does not need a schema change.
  readonly circumferences: Readonly<Record<string, number>>
  readonly note: string
  readonly correctedFrom: string | null // the measurement this one corrects (audit, not an edit)
  readonly recordedBy: ActorRef
  readonly recordedAt: Instant
}

// ── Per-exercise feedback (bound to a version + day + exercise, never a free chat) ──
export type FeedbackStatus = 'open' | 'answered' | 'resolved'
export const FeedbackReasons = ['pain', 'too_easy', 'too_hard', 'not_felt', 'machine_busy', 'video_unclear', 'other'] as const
export type FeedbackReason = (typeof FeedbackReasons)[number]

export interface TrainingFeedback {
  readonly id: string
  readonly studioId: StudioId
  readonly memberId: string
  readonly programId: string
  readonly programVersion: number
  readonly dayOrder: number
  readonly exerciseId: string
  readonly reason: FeedbackReason
  readonly message: string
  readonly trainerReply: string | null
  readonly status: FeedbackStatus
  readonly createdAt: Instant
  readonly answeredAt: Instant | null
}

// ── Progress photos — metadata only here; the FILE lives in secure Storage (signed URL), and the
//    url NEVER enters an event (member PII). ──
export type PhotoAngle = 'front' | 'side' | 'back'
export interface ProgressPhoto {
  readonly id: string
  readonly studioId: StudioId
  readonly memberId: string
  readonly takenOn: string // LocalDate
  readonly angle: PhotoAngle
  readonly storagePath: string // the Storage object path — a signed URL is minted on read, never stored
  readonly note: string
  readonly memberVisible: boolean
  readonly uploadedBy: ActorRef
  readonly uploadedAt: Instant
}
