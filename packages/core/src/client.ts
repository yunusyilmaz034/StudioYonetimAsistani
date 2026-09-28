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

/** Bir demetin tek bileşeni — bir kredi yarısı ya da bir giriş yarısı. */
export interface MemberSubscriptionComponent {
  readonly entitlementId: string
  readonly category: string
  readonly remaining: number | null
  readonly total: number | null
  readonly fitnessEntry: { readonly used: number; readonly allowance: number } | null
}

/**
 * Üyenin TUTTUĞU paket — deponun satırı değil.
 *
 * Hibrit bir ürün kategori duvarı yüzünden bileşen başına bir entitlement yazar (bir pilates
 * kredisi, bir fitness girişi). Üye ise tek bir paket aldı, tek fiyat ödedi, tek bitiş tarihi var —
 * bu yüzden burası bir demeti TEK satır olarak taşır ve dökümünü `components`e koyar.
 */
export interface MemberSubscription {
  readonly entitlementId: string
  readonly productName: string
  readonly category: string
  readonly remaining: number | null
  readonly total: number | null
  readonly validUntil: number
  /**
   * Geçerliliğin BAŞLADIĞI an — satın alma anıyla aynı olmak zorunda değil (ileri tarihli satış).
   * İsteğe bağlı: eski istemciler görmez, ve eski sürümlerin cevabı okumayı sürdürmesi gerekiyor.
   */
  readonly validFrom?: number
  readonly purchasedAt: number
  readonly status: string
  // Fitness serbest-giriş cap (v1.27) — present only on a capped fitness membership. `used` door
  // check-ins of `allowance`; remaining = allowance − used (soft, so `used` may exceed `allowance`).
  readonly fitnessEntry: { readonly used: number; readonly allowance: number } | null
  /** Demetin dökümü; normal pakette tek elemanlı. İsteğe bağlı — eski istemciler yok sayar. */
  readonly components?: readonly MemberSubscriptionComponent[]
}
export interface MemberSubscriptions {
  readonly active: readonly MemberSubscription[]
  readonly past: readonly MemberSubscription[]
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
  /**
   * What booking this class will cost her. `null` ⇒ she cannot book it.
   *
   * Optional so an app running against an older server (or an older app against this one) reads it
   * as "unknown" and simply says less, rather than crashing or inventing a number. Store releases
   * are slow; a field that only exists on one side of the wire must never be load-bearing.
   */
  readonly cost?: BookingCost | null
}

/** A credit package spends one credit; an unlimited membership spends nothing. */
export type BookingCost = { readonly kind: 'credit'; readonly remainingAfter: number } | { readonly kind: 'unlimited' }

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
  /**
   * Which muscles the body diagram paints, RESOLVED SERVER-SIDE (2026-08-01).
   *
   * The exercise-name → muscle table is a single table on the server; sending the answer rather than
   * the table is what lets the mobile app draw the same diagram as the panel without shipping — and
   * then having to keep in sync — a copy of it. A new exercise added to the table lights up in both
   * clients at once, with no app release.
   *
   * Absent for an exercise the table does not know: the diagram is skipped, the rest of the guide is
   * not. The strings are the diagram's own muscle vocabulary (`chest`, `quadriceps`, …), which is
   * why they are typed loosely here — `client.ts` is a wire contract, not the drawing.
   */
  readonly primaryMuscles?: readonly string[]
  readonly secondaryMuscles?: readonly string[]
}

/**
 * A YouTube watch/share/shorts link → the embeddable player URL, or null if it is not YouTube.
 *
 * Owner, 2026-08-01: *"video için youtube yönlendirmesin, sistem pratik olmuyor."* Leaving the app
 * to watch a fifteen-second form clip loses her place in the programme — on mobile she comes back
 * to a cold start, and on the web she comes back to a second tab. So both clients play it in a
 * popup, and both need to turn the same stored link into the same embed URL: hence one function,
 * here, tested once.
 *
 * `youtube-nocookie.com` is deliberate — it is the same player without the tracking cookie, which
 * is the version we may show a member without asking her for anything.
 */
export function youtubeEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  // The four shapes a trainer actually pastes: watch?v=, youtu.be/, /shorts/, and an /embed/ link
  // somebody already copied out of an embed dialog.
  const m =
    /[?&]v=([A-Za-z0-9_-]{11})/.exec(trimmed) ??
    /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(trimmed) ??
    /\/shorts\/([A-Za-z0-9_-]{11})/.exec(trimmed) ??
    /\/embed\/([A-Za-z0-9_-]{11})/.exec(trimmed)
  if (!m?.[1]) return null
  // `playsinline` matters on iOS: without it the player hijacks the screen into fullscreen, which is
  // the very jump out of context this change exists to remove.
  return `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0&playsinline=1&autoplay=1`
}

/**
 * The guide's description carries a convention, not just prose: an optional first line
 * `🎯 Ana: … · İkincil: … · Zayıf: …`, then a blank line, then the movement summary. Both clients
 * render it as a colour-coded target list plus a paragraph, so both must read it the same way —
 * hence one parser (2026-08-01; it lived only in the web dialog before the app grew a guide).
 *
 * No 🎯 line ⇒ the whole description IS the summary. An exercise written before the convention
 * existed still reads correctly; that is the point of parsing rather than requiring.
 */
export function parseGuideTargets(description: string): {
  readonly ana: string | null
  readonly ikincil: string | null
  readonly zayif: string | null
  readonly note: string | null
  readonly summary: string
} {
  const [head, ...rest] = description.split('\n\n')
  const summary = rest.join('\n\n').trim()
  if (!head?.trim().startsWith('🎯')) return { ana: null, ikincil: null, zayif: null, note: null, summary: description.trim() }
  const segs = head.replace('🎯', '').split('·').map((s) => s.trim()).filter(Boolean)
  let ana: string | null = null
  let ikincil: string | null = null
  let zayif: string | null = null
  let note: string | null = null
  for (const s of segs) {
    if (/^Ana\s*:/i.test(s)) ana = s.replace(/^Ana\s*:/i, '').trim()
    else if (/^İkincil\s*:/i.test(s)) ikincil = s.replace(/^İkincil\s*:/i, '').trim()
    else if (/^Zayıf\s*:/i.test(s)) zayif = s.replace(/^Zayıf\s*:/i, '').trim()
    else note = s
  }
  return { ana, ikincil, zayif, note, summary }
}

/** Tips and common mistakes are stored one-per-line; blanks are formatting, not content. */
export function guideLines(s: string): readonly string[] {
  return s.split('\n').map((l) => l.trim()).filter(Boolean)
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
  readonly idealWeightKg?: number | null
  readonly leanMassKg?: number | null
  readonly leanMassPercent?: number | null
  readonly muscleKg?: number | null
  readonly waterKg?: number | null
  readonly fatKg?: number | null
  readonly circumferences: Readonly<Record<string, number>>
  readonly note: string
  readonly recordedAt: number
}

// ── Two readings, side by side ────────────────────────────────────────────────────────────────
//
// What changed between a member's last two measurements. Deliberately WITHOUT a verdict (owner,
// 2026-08-05: "yorumlayacağımız bişey yok"): it reports that muscle went up 1.2 kg, it does not
// congratulate her, and it does not colour weight gain red — a member who put on muscle would be
// told she got worse. The numbers are hers to read.
//
// Computed from the stored readings, not re-read from the PDF: the records are already the truth and
// this way the comparison costs nothing and works for the 57 readings taken before PDFs existed.
export interface MeasurementDeltaRow {
  readonly key: string
  readonly label: string
  readonly unit: 'kg' | '%' | 'cm'
  readonly from: number
  readonly to: number
  readonly diff: number // to − from; sign is the direction, never a judgement
}
export interface MeasurementComparison {
  readonly fromDate: string // LocalDate
  readonly toDate: string
  readonly days: number
  readonly rows: readonly MeasurementDeltaRow[]
}

// Only what a comparison actually needs. Stated structurally so the SAME function serves the phone
// (`MemberMeasurement`, wire shape) and the member web portal (the domain `Measurement`, branded
// timestamps and all) — one implementation, so the two surfaces can never disagree about a number.
export interface MeasurementLike {
  readonly takenOn: string // LocalDate
  readonly weightKg: number | null
  readonly musclePercent: number | null
  readonly waterPercent: number | null
  readonly fatPercent: number | null
  readonly leanMassKg?: number | null
  readonly muscleKg?: number | null
  readonly waterKg?: number | null
  readonly fatKg?: number | null
  readonly circumferences: Readonly<Record<string, number>>
}

const DELTA_METRICS: readonly { key: keyof MeasurementLike; label: string; unit: 'kg' | '%' }[] = [
  { key: 'weightKg', label: 'Kilo', unit: 'kg' },
  { key: 'leanMassKg', label: 'Yağsız kütle', unit: 'kg' },
  { key: 'muscleKg', label: 'Kas', unit: 'kg' },
  { key: 'musclePercent', label: 'Kas oranı', unit: '%' },
  { key: 'waterKg', label: 'Sıvı', unit: 'kg' },
  { key: 'waterPercent', label: 'Sıvı oranı', unit: '%' },
  { key: 'fatKg', label: 'Yağ', unit: 'kg' },
  { key: 'fatPercent', label: 'Yağ oranı', unit: '%' },
]

// Only the DIFFERENCE is rounded — 42 − 40.75 is 1.25, and 0.30000000000000004 kg of muscle is not a
// thing anyone measured. The readings themselves are passed through untouched: the scale printed
// 40.75 kg, so 40.75 kg is what she is shown.
const round1 = (n: number): number => Math.round(n * 10) / 10

export function compareMeasurements(list: readonly MeasurementLike[]): MeasurementComparison | null {
  // Newest first is how the API returns them, but sorting here makes the function safe to call with
  // any order — a comparison that silently ran backwards would invert every sign.
  const sorted = [...list].sort((a, b) => b.takenOn.localeCompare(a.takenOn))
  const to = sorted[0]
  const from = sorted[1]
  if (!to || !from) return null

  const rows: MeasurementDeltaRow[] = []
  for (const m of DELTA_METRICS) {
    const a = from[m.key]
    const b = to[m.key]
    // A field only compares if BOTH readings carry it. A metric that appeared for the first time in
    // the newer reading has no "change" — reporting one against an implied zero would be a lie.
    if (typeof a !== 'number' || typeof b !== 'number') continue
    const diff = round1(b - a)
    if (diff === 0) continue
    rows.push({ key: String(m.key), label: m.label, unit: m.unit, from: a, to: b, diff })
  }
  for (const [key, b] of Object.entries(to.circumferences)) {
    const a = from.circumferences[key]
    if (typeof a !== 'number') continue
    const diff = round1(b - a)
    if (diff === 0) continue
    rows.push({ key: `circ:${key}`, label: key, unit: 'cm', from: a, to: b, diff })
  }
  if (rows.length === 0) return null

  const days = Math.max(0, Math.round((Date.parse(`${to.takenOn}T00:00:00Z`) - Date.parse(`${from.takenOn}T00:00:00Z`)) / 86_400_000))
  return { fromDate: from.takenOn, toDate: to.takenOn, days, rows }
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
  readonly subject: string
  readonly body: string
  readonly at: number
  readonly read: boolean
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

// ── STORED-VALUE WALLET (Doc 27, v1.27) — distinct from WalletSummary above (which is her ACCOUNT:
//    what she owes + her packages). This is a prepaid balance she loads (virtual POS or at the desk)
//    and spends on retail items (su, çorap, havlu…). Money is integer kuruş; a debit never goes below
//    zero (I-37). ──────────────────────────────────────────────────────────────────────────────
export type WalletTxnKind = 'topup' | 'purchase' | 'refund' | 'adjustment' | 'void'
export interface WalletTxn {
  readonly id: string
  readonly kind: WalletTxnKind
  readonly direction: 'in' | 'out' // in raises the balance, out lowers it
  readonly amount: number // kuruş, always positive — `direction` says the sign
  readonly label: string // ready-to-show Turkish, e.g. "Bakiye yükleme" / "Su"
  readonly at: number
  readonly balanceAfter: number // kuruş
}
export interface StoredWallet {
  readonly balance: number // kuruş
  readonly history: readonly WalletTxn[]
}
export interface RetailItem {
  readonly id: string
  readonly name: string
  readonly priceInKurus: number
  readonly category: string
  readonly stock: number | null // null ⇒ stock not tracked (always buyable)
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

// ── DEVAMLILIK ŞERİDİ (v1.31) ───────────────────────────────────────────────────────────────
//
// Her last eight weeks of DOOR check-ins, bucketed per week for the member app's home screen. Pure,
// so the rule that decides whether the strip appears at all is testable — and it is a rule, not a
// styling detail.
//
// A chart of mostly-empty weeks is not neutral. To a member who had a reason the app cannot know —
// illness, a child, a shift pattern — it reads as an accusation, and the app she feels judged by is
// the one she stops opening. So it stays silent until there is a real pattern to show, and it says
// only what she DID. What she missed belongs on the staff screen, where a human can ring her.
//
// This counts CHECK-INS ONLY. Workout ticks are the member's own declaration and are never added to
// an observation (#11) — see `workout.day_completed` in the training module.
export const CONSISTENCY_WEEKS = 8
export const CONSISTENCY_MIN_VISITS = 3
const WEEK_MS = 7 * 86_400_000

/**
 * Visits per week for the last {@link CONSISTENCY_WEEKS} weeks, oldest first — the current week is
 * always the last bar.
 *
 * `null` means "say nothing": fewer than {@link CONSISTENCY_MIN_VISITS} visits in total, or none of
 * them inside the window.
 */
export function weeklyVisitCounts(visitInstants: readonly number[], nowMs: number): readonly number[] | null {
  if (visitInstants.length < CONSISTENCY_MIN_VISITS) return null
  const thisWeek = nowMs - (nowMs % WEEK_MS)
  const buckets = new Array<number>(CONSISTENCY_WEEKS).fill(0)
  for (const at of visitInstants) {
    const weeksAgo = Math.floor((thisWeek - (at - (at % WEEK_MS))) / WEEK_MS)
    if (weeksAgo < 0 || weeksAgo >= CONSISTENCY_WEEKS) continue
    const i = CONSISTENCY_WEEKS - 1 - weeksAgo
    buckets[i] = (buckets[i] ?? 0) + 1
  }
  return buckets.some((n) => n > 0) ? buckets : null
}

// ── DÖNGÜ MODU (Faz 3.2) ─────────────────────────────────────────────────────────────────────
//
// THIS IS NOT A WIRE CONTRACT. Nothing below ever crosses the network, and that is the feature.
//
// The roadmap's binding rule for the women's-health module is: *"Üyenin bedenine ait veri
// telefonunda kalır."* Cycle data is special-category health data under KVKK, and the cheapest way
// to be safe with it is to never hold it: it lives in the phone's own storage, the studio cannot
// read it, it is not in any backup of ours, and if the database leaked tomorrow it would not be in
// it. The app fetches Işıl's class programme from the server and merges the two ON THE PHONE.
//
// It lives in `client.ts` anyway because this is the only module the standalone Expo app can import
// (`@studio/core/client`, a Metro alias) — and putting it here is what lets `pnpm check` test it.
// Logic that decides what a woman is told about her own body does not belong in an untested file.
//
// WHAT IT DOES NOT DO: prescribe. "Train hard in the follicular phase, go easy in the luteal phase"
// has weak and contested evidence, so the app never says it. It shows her HER OWN pattern —
// collected from the one-tap "how did that class feel" she gives after a session — and lets her
// draw the conclusion. That claim cannot be wrong, because it is her own data.

export type CyclePhase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal'
/** One tap after a class. Deliberately three coarse buckets: a 1–10 scale is not answered honestly. */
export type SessionFeel = 'hard' | 'normal' | 'good'
export type CycleConfidence = 'none' | 'low' | 'good'

export const CYCLE_DEFAULT_LENGTH = 28
/** Outside this band a gap is not a cycle: it is a double entry, a skipped month, or a typo. */
export const CYCLE_MIN_LENGTH = 21
export const CYCLE_MAX_LENGTH = 45
/** How many days the bleed is assumed to last when she has not said otherwise. */
export const CYCLE_PERIOD_DAYS = 5
/** Past this, the last entry is history rather than a current cycle — the app asks instead of guessing. */
export const CYCLE_STALE_DAYS = 60

export interface CycleReading {
  /** 1 on the first day of bleeding. */
  readonly dayOfCycle: number
  readonly phase: CyclePhase
  readonly averageLength: number
  /** LocalDate, or null when there is not enough history to predict anything. */
  readonly nextExpectedStart: string | null
  readonly daysUntilNext: number | null
  readonly confidence: CycleConfidence
}

const DAY_MS = 86_400_000

/** LocalDate → whole days since the epoch, or null if it is not a date. */
function dayNumber(localDate: string): number | null {
  const ms = Date.parse(`${localDate}T00:00:00Z`)
  return Number.isNaN(ms) ? null : Math.round(ms / DAY_MS)
}

function localDate(dayNo: number): string {
  return new Date(dayNo * DAY_MS).toISOString().slice(0, 10)
}

/** Valid, de-duplicated, oldest first. Input order is not trusted: she may log a forgotten month. */
function cleanStarts(periodStarts: readonly string[]): readonly number[] {
  const seen = new Set<number>()
  for (const s of periodStarts) {
    const n = dayNumber(s)
    if (n !== null) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * The gaps between her logged starts that are actually cycles.
 *
 * Two kinds of noise are filtered, and they need different treatment:
 *
 *  • **A second tap a few days later** ("did I log it?") is not the start of a cycle at all, so it is
 *    skipped WITHOUT becoming the new anchor. Letting it anchor would split one 28-day gap into 3 and
 *    25 — and 25 is plausible enough to be believed, which is how a clean cycle becomes a wrong one.
 *  • **A gap far too long** is a month she did not log. The gap is not counted, but the later entry
 *    IS a real start, so it becomes the anchor for what follows.
 */
function usableGaps(starts: readonly number[]): readonly number[] {
  const gaps: number[] = []
  let anchor = starts[0]
  if (anchor === undefined) return gaps
  for (let i = 1; i < starts.length; i += 1) {
    const gap = (starts[i] as number) - anchor
    if (gap < CYCLE_MIN_LENGTH) continue // a re-log of the same period; the anchor stands
    if (gap <= CYCLE_MAX_LENGTH) gaps.push(gap)
    anchor = starts[i] as number
  }
  return gaps
}

/**
 * Her average cycle length from the gaps between logged starts, ignoring implausible ones.
 *
 * Null when no gap is usable — the caller then falls back to {@link CYCLE_DEFAULT_LENGTH} and says
 * so through `confidence`, rather than presenting twenty-eight as something she was measured to have.
 */
export function averageCycleLength(periodStarts: readonly string[]): number | null {
  const gaps = usableGaps(cleanStarts(periodStarts))
  if (gaps.length === 0) return null
  return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
}

function phaseOf(dayOfCycle: number, averageLength: number): CyclePhase {
  if (dayOfCycle <= CYCLE_PERIOD_DAYS) return 'menstrual'
  // Ovulation is timed from the END of the cycle, not the start: the luteal phase is the stable
  // fourteen-ish days, and it is the follicular phase that stretches when a cycle runs long.
  const ovulation = averageLength - 14
  if (dayOfCycle >= ovulation - 2 && dayOfCycle <= ovulation + 1) return 'ovulatory'
  return dayOfCycle < ovulation ? 'follicular' : 'luteal'
}

/**
 * Where she is today, or null when there is nothing honest to say — no entry at all, only entries in
 * the future, or a last entry so old that it describes a different season of her life.
 */
export function cycleReading(periodStarts: readonly string[], today: string): CycleReading | null {
  const starts = cleanStarts(periodStarts)
  const now = dayNumber(today)
  if (now === null) return null

  const past = starts.filter((d) => d <= now)
  const last = past[past.length - 1]
  if (last === undefined) return null

  const dayOfCycle = now - last + 1
  if (dayOfCycle > CYCLE_STALE_DAYS) return null

  const measured = averageCycleLength(periodStarts)
  const averageLength = measured ?? CYCLE_DEFAULT_LENGTH

  // Two readings can agree by luck; three that agree are a pattern. And a woman whose cycles swing
  // by more than four days is not served by a confident prediction — she is served by being told
  // the prediction is loose, which is what `low` renders as.
  const gaps = usableGaps(starts)
  const spread = gaps.length > 0 ? Math.max(...gaps) - Math.min(...gaps) : Infinity
  const confidence: CycleConfidence = measured === null ? 'none' : gaps.length >= 2 && spread <= 4 ? 'good' : 'low'

  const nextStartDay = confidence === 'none' ? null : last + averageLength
  return {
    dayOfCycle,
    phase: phaseOf(dayOfCycle, averageLength),
    averageLength,
    nextExpectedStart: nextStartDay === null ? null : localDate(nextStartDay),
    daysUntilNext: nextStartDay === null ? null : nextStartDay - now,
    confidence,
  }
}

/** One class, as she rated it. `date` is the day of the class (LocalDate). */
export interface FeelEntry {
  readonly date: string
  readonly feel: SessionFeel
}

export interface FeelPattern {
  readonly phase: CyclePhase
  /** 0…1 — how often classes in that phase were marked hard. */
  readonly hardRate: number
  /** How many rated classes fell in that phase. Shown, so she can judge the claim herself. */
  readonly samples: number
  /** Whether she is in that phase right now — the only case where the app volunteers the pattern. */
  readonly isNow: boolean
}

/** Below these, a "pattern" is noise wearing a sentence. */
export const FEEL_MIN_TOTAL = 6
export const FEEL_MIN_PHASE_SAMPLES = 3
const FEEL_MIN_RATE = 0.5
const FEEL_MIN_EDGE = 0.25

/**
 * The one thing the app is allowed to claim: *"in the last months you marked classes hard mostly in
 * this part of your cycle."*
 *
 * Null unless the claim survives four checks — enough ratings overall, enough in the phase itself,
 * a majority of them hard, and clearly harder than the rest of her cycle. Silence is the default
 * because a woman told a confident falsehood about her own body deletes the app, and she is right to.
 */
export function feelPattern(
  periodStarts: readonly string[],
  feels: readonly FeelEntry[],
  today: string,
): FeelPattern | null {
  const starts = cleanStarts(periodStarts)
  if (starts.length === 0) return null
  const averageLength = averageCycleLength(periodStarts) ?? CYCLE_DEFAULT_LENGTH

  const tally = new Map<CyclePhase, { hard: number; total: number }>()
  let total = 0
  for (const entry of feels) {
    const day = dayNumber(entry.date)
    if (day === null) continue
    // The cycle a class belongs to is the one that had already started when she took it.
    let start: number | undefined
    for (const s of starts) if (s <= day) start = s
    if (start === undefined) continue
    const dayOfCycle = day - start + 1
    if (dayOfCycle > CYCLE_STALE_DAYS) continue // a class logged in a gap she never filled in
    const phase = phaseOf(dayOfCycle, averageLength)
    const cell = tally.get(phase) ?? { hard: 0, total: 0 }
    cell.total += 1
    if (entry.feel === 'hard') cell.hard += 1
    tally.set(phase, cell)
    total += 1
  }
  if (total < FEEL_MIN_TOTAL) return null

  let best: { phase: CyclePhase; rate: number; samples: number } | null = null
  for (const [phase, cell] of tally) {
    if (cell.total < FEEL_MIN_PHASE_SAMPLES) continue
    const rate = cell.hard / cell.total
    if (best === null || rate > best.rate) best = { phase, rate, samples: cell.total }
  }
  if (best === null || best.rate < FEEL_MIN_RATE) return null

  let restHard = 0
  let restTotal = 0
  for (const [phase, cell] of tally) {
    if (phase === best.phase) continue
    restHard += cell.hard
    restTotal += cell.total
  }
  // With nothing to compare against, "you find these hard" is a fact about her, not about her cycle.
  if (restTotal === 0) return null
  if (best.rate - restHard / restTotal < FEEL_MIN_EDGE) return null

  const now = cycleReading(periodStarts, today)
  return { phase: best.phase, hardRate: best.rate, samples: best.samples, isNow: now?.phase === best.phase }
}
