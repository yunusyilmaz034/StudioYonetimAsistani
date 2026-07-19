// `@studio/core/client` — the CLIENT-SAFE surface (AD-71).
//
// This is the ONLY entry the React Native app (`apps/mobile`) and the member HTTP API
// (`apps/web/src/app/api/member`) share. It is deliberately SELF-CONTAINED: it imports nothing from
// the core barrel, so `firebase-admin`, `ulid`, `firestore` and every other server-only dependency
// stay out of the phone's bundle. Everything here is a plain type or a pure, dependency-free helper.
//
// The shapes mirror the web member portal's DTOs (`apps/web/src/server/portal-query.ts`) and the
// training domain, but expressed in WIRE form: ids are strings, timestamps are epoch-millisecond
// numbers, money is an integer in kuruş. Branded types and `Instant` never cross the wire.

// ── Result envelope (mirrors the server's Result, primitives only) ──────────────────────────
export interface ApiError {
  readonly code: string
  readonly message?: string
}
export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiError }

// ── Shared enums (redeclared as wire strings, not imported from core internals) ─────────────
export type ClassCategory = 'pilates_group' | 'fitness' | 'private'
export type ProgramStatus = 'draft' | 'active' | 'completed' | 'archived'
export type FeedbackStatus = 'open' | 'answered' | 'resolved'
export const FEEDBACK_REASONS = ['pain', 'too_easy', 'too_hard', 'not_felt', 'machine_busy', 'video_unclear', 'other'] as const
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]
export type PhotoAngle = 'front' | 'side' | 'back'
export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'whatsapp' | 'push'

// The reason a member cannot book a session she can see (null = she can). Server-decided.
export type BlockedReason = 'full' | 'no_credit' | 'self_booking_off' | 'past' | null

// ── Dashboard / packages / reservations ─────────────────────────────────────────────────────
export interface MemberPackage {
  readonly entitlementId: string
  readonly productName: string
  readonly category: string
  readonly remaining: number | null // null = unlimited (a period package has no counter)
  readonly validUntil: number // epoch ms
  readonly balanceDue: number // kuruş
}

export interface MemberReservation {
  readonly reservationId: string
  readonly sessionId: string
  readonly serviceName: string
  readonly trainerName: string | null
  readonly roomName: string | null
  readonly category: string
  readonly startsAt: number // epoch ms
  readonly endsAt: number
  readonly status: string
  readonly cancellationWindowHours: number
  readonly lateCancellationConsumesCredit: boolean
}

export interface MemberDashboard {
  readonly memberName: string
  readonly upcoming: readonly MemberReservation[]
  readonly packages: readonly MemberPackage[]
  readonly balanceDue: number // kuruş
}

export interface MemberReservations {
  readonly upcoming: readonly MemberReservation[]
  readonly past: readonly MemberReservation[]
}

// ── Agenda (what she may see & whether she may book) ────────────────────────────────────────
export interface MemberSession {
  readonly sessionId: string
  readonly serviceName: string
  readonly category: string
  readonly trainerName: string | null
  readonly roomName: string | null
  readonly startsAt: number
  readonly endsAt: number
  readonly capacity: number
  readonly bookedCount: number
  readonly cancellationWindowHours: number
  readonly isAssignedToMe: boolean
  readonly alreadyBooked: boolean
  readonly blockedReason: BlockedReason
}

export interface MemberAgenda {
  readonly sessions: readonly MemberSession[]
  readonly hasActivePackage: boolean
}

// ── Profile ─────────────────────────────────────────────────────────────────────────────────
export interface MemberProfile {
  readonly fullName: string
  readonly phone: string
  readonly birthDate: string | null // LocalDate
  readonly email: string | null
  readonly emergencyName: string | null
  readonly emergencyPhone: string | null
  readonly avatarUrl?: string | null // a short-lived signed URL for her profile photo
}

// ── Training: exercise guide + programme (wire snapshot) ─────────────────────────────────────
export interface ExerciseGuide {
  readonly nameTr: string
  readonly muscleGroup: string
  readonly equipment: string
  readonly description: string
  readonly tips: string
  readonly commonMistakes: string
  readonly videoUrl: string | null
  readonly photoUrl: string | null
  readonly gifUrl: string | null
}

export interface ProgramExercise {
  readonly exerciseId: string
  readonly order: number
  readonly nameTr: string
  readonly videoUrl: string | null
  readonly description: string
  readonly sets: number
  readonly reps: string
  readonly restSeconds: number
  readonly tempo: string
  readonly note: string
  readonly alternativeExerciseId: string | null
}

export interface ProgramDay {
  readonly order: number
  readonly name: string
  readonly exercises: readonly ProgramExercise[]
}

export interface ProgramVersion {
  readonly version: number
  readonly note: string
  readonly days: readonly ProgramDay[]
  readonly publishedAt: number
}

export interface MemberProgram {
  readonly id: string
  readonly title: string
  readonly status: ProgramStatus
  readonly startsOn: string | null
  readonly endsOn: string | null
  readonly currentVersion: number
  readonly versions: readonly ProgramVersion[]
  readonly updatedAt: number
}

// ── Measurements ─────────────────────────────────────────────────────────────────────────────
export interface MemberMeasurement {
  readonly id: string
  readonly takenOn: string // LocalDate
  readonly weightKg: number | null
  readonly fatPercent: number | null
  readonly musclePercent: number | null
  readonly waterPercent: number | null
  readonly bmi: number | null
  readonly bmr: number | null
  readonly visceralFat: number | null
  readonly circumferences: Readonly<Record<string, number>>
  readonly note: string
  readonly recordedAt: number
}

// ── Per-exercise feedback ─────────────────────────────────────────────────────────────────────
export interface MemberFeedback {
  readonly id: string
  readonly programId: string
  readonly programVersion: number
  readonly dayOrder: number
  readonly exerciseId: string
  readonly reason: FeedbackReason
  readonly message: string
  readonly trainerReply: string | null
  readonly status: FeedbackStatus
  readonly createdAt: number
  readonly answeredAt: number | null
}

export interface LeaveFeedbackInput {
  readonly programId: string
  readonly programVersion: number
  readonly dayOrder: number
  readonly exerciseId: string
  readonly reason: FeedbackReason
  readonly message: string
}

// ── Progress photos (signed URL minted server-side per read) ──────────────────────────────────
export interface MemberPhoto {
  readonly id: string
  readonly takenOn: string
  readonly angle: PhotoAngle
  readonly url: string // a short-lived signed URL
  readonly note: string
}

// ── Fitness / streak ─────────────────────────────────────────────────────────────────────────
export interface MemberVisit {
  readonly at: number
  readonly branchName: string | null
}
export interface MemberFitness {
  readonly currentStreak: number
  readonly longestStreak: number
  readonly last30Count: number
  readonly visits: readonly MemberVisit[]
}

// ── Inbox / preferences ───────────────────────────────────────────────────────────────────────
export interface InboxItem {
  readonly intentId: string
  readonly title: string
  readonly body: string
  readonly createdAt: number
  readonly readAt: number | null
}
export interface NotificationPrefs {
  readonly email: boolean
  readonly sms: boolean
  readonly whatsapp: boolean
  readonly push: boolean
  readonly campaign: boolean
}

// ── Wallet (M3) ───────────────────────────────────────────────────────────────────────────────
export interface WalletPackageLine {
  readonly entitlementId: string
  readonly productName: string
  readonly category: string
  readonly remaining: number | null
  readonly validUntil: number
}
export interface PaymentHistoryItem {
  readonly id: string
  readonly amount: number // kuruş
  readonly method: string
  readonly at: number
  readonly description: string
}
export interface WalletSummary {
  readonly balanceDue: number // kuruş — what she still owes
  readonly packages: readonly WalletPackageLine[]
  readonly history: readonly PaymentHistoryItem[]
}

// ── QR check-in token (member displays it; reception scans) ───────────────────────────────────
export interface QrToken {
  readonly token: string
  readonly expiresAt: number
  readonly ttlSeconds: number
}

// ── Auth ──────────────────────────────────────────────────────────────────────────────────────
// The member types her phone; the server derives the synthetic Firebase email from it. The app never
// builds the identifier itself — it asks the API, then signs in with Firebase.
export interface LoginIdentifier {
  readonly email: string
}

// ── Tiny pure helpers (dependency-free, safe in a React Native bundle) ────────────────────────
/** Integer kuruş → a Turkish-lira display string, e.g. 900000 → "9.000 ₺". */
export function formatKurus(kurus: number): string {
  return `${(kurus / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₺`
}
