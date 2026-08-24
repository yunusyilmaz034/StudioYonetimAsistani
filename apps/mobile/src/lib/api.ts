// The typed member API client. Every call attaches the member's current Firebase ID token (refreshed
// automatically by the SDK) as a Bearer header; the server verifies it and derives her identity. The
// return types come from `@studio/core/client` — the ONE wire contract shared with the backend.
import type {
  ApiResult,
  InboxItem,
  LeaveFeedbackInput,
  MemberAgenda,
  MemberDashboard,
  MemberProfile,
  MemberReservations,
  NotificationPrefs,
  QrToken,
  RetailItem,
  StoredWallet,
  WalletSummary,
} from '@studio/core/client'

import { API_BASE, STUDIO_ID } from '@/config'
import { auth } from './firebase'

async function authHeader(): Promise<Record<string, string>> {
  const user = auth().currentUser
  if (!user) throw new Error('not_authenticated')
  const token = await user.getIdToken()
  return { Authorization: `Bearer ${token}` }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: await authHeader() })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return (await res.json()) as T
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`)
  return (await res.json()) as T
}

export interface Branding {
  readonly appName: string
  readonly logoUrl: string
}

// PUBLIC — the login screen's studio name + logo, before anyone signs in.
export async function fetchBranding(): Promise<Branding | null> {
  try {
    const res = await fetch(`${API_BASE}/branding?s=${STUDIO_ID}`)
    const data = (await res.json()) as { branding: Branding | null }
    return data.branding
  } catch {
    return null
  }
}

// PUBLIC — no token yet: turn the phone she typed into the synthetic email she signs in with.
export async function resolveLoginEmail(phone: string): Promise<string> {
  const res = await fetch(`${API_BASE}/login-identifier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studioId: STUDIO_ID, phone }),
  })
  const data = (await res.json()) as ApiResult<{ email: string }>
  if (!data.ok) throw new Error(data.error.code)
  return data.value.email
}

export const api = {
  dashboard: () => get<MemberDashboard>('/dashboard'),
  agenda: () => get<MemberAgenda>('/agenda'),
  reservations: () => get<MemberReservations>('/reservations'),
  subscriptions: () => get<import('@studio/core/client').MemberSubscriptions>('/subscriptions'),
  book: (sessionId: string) => post<ApiResult<{ reservationId: string }>>('/book', { sessionId }),
  cancel: (reservationId: string) => post<ApiResult<unknown>>('/cancel', { reservationId }),
  profile: () => get<MemberProfile>('/profile'),
  updateProfile: (body: { email: string | null; emergencyName: string | null; emergencyPhone: string | null }) =>
    post<ApiResult<unknown>>('/profile', body),
  training: () => get<TrainingBundle>('/training'),
  leaveFeedback: (body: LeaveFeedbackInput) => post<ApiResult<unknown>>('/feedback', body),
  fitness: () => get<MemberFitnessView>('/fitness'),
  home: () => get<HomeExtras>('/home'),
  // Workout log (v1.31). Her position in the programme cycle, and marking a day done. NOT a
  // check-in — nothing here counts towards attendance.
  workout: (programId: string) => get<WorkoutProgress>(`/workout?programId=${encodeURIComponent(programId)}`),
  completeWorkout: (body: CompleteWorkoutBody) => post<ApiResult<unknown>>('/workout', body),
  // Turnstile (v1.33). The code on the door's screen. Produces the same `member.checked_in` the
  // desk and the kiosk produce — the producer never appears in the event type.
  crossTurnstile: (code: string) => post<ApiResult<TurnstileCross>>('/turnstile', { code }),
  inbox: () => get<readonly InboxItem[]>('/inbox'),
  markRead: (intentId: string) => post<ApiResult<unknown>>('/inbox', { intentId }),
  prefs: () => get<NotificationPrefs>('/prefs'),
  setPrefs: (prefs: NotificationPrefs) => post<ApiResult<unknown>>('/prefs', prefs),
  // App Store 5.1.1(v). Her login is destroyed server-side; the app signs out afterwards because
  // there is no longer an account to hold a session for.
  deleteAccount: () => post<ApiResult<{ deleted: true }>>('/delete-account', {}),
  qrContext: () => get<{ studioId: string; branchId: string | null }>('/qr'),
  mintQr: (branchId: string) => post<QrToken>('/qr', { branchId }),
  checkin: (token: string) => post<ApiResult<{ branchId: string }>>('/checkin', { token }),
  wallet: () => get<WalletSummary>('/wallet'),
  products: () => get<readonly MemberProduct[]>('/products'),
  purchase: (productId: string) => post<ApiResult<{ intentId: string; redirectUrl: string; flow: string }>>('/purchase', { productId }),
  // Stored-value wallet (Doc 27): balance + history, the retail shelf, and buying from the balance.
  walletBalance: () => get<StoredWallet>('/wallet-balance'),
  store: () => get<readonly RetailItem[]>('/store'),
  walletBuy: (productId: string, quantity = 1) => post<ApiResult<StoredWallet>>('/wallet-buy', { productId, quantity }),
  walletTopup: (amountKurus: number) => post<ApiResult<{ redirectUrl: string }>>('/wallet-topup', { amountKurus }),
  registerDevice: (token: string, platform: string) => post<ApiResult<unknown>>('/devices', { token, platform }),
  /** Push registration failed. Same endpoint — the server tells them apart by which field arrived. */
  reportPushFailure: (platform: string, error: string) => post<ApiResult<unknown>>('/devices', { platform, error }),
  uploadPhoto: (dataUrl: string) => post<ApiResult<{ avatarUrl: string | null }>>('/photo', { dataUrl }),
  contact: () => get<MemberContact>('/contact'),
}

// The studio's own contact card (business info, not member PII) — mirrors memberStudioContact on the
// server. Empty strings when the owner hasn't filled a field in.
export interface MemberContact {
  readonly name: string
  readonly phone: string
  readonly email: string
  readonly website: string | null
  readonly address: string
  readonly mapsUrl: string | null
}

export interface MemberProduct {
  readonly id: string
  readonly name: string
  readonly category: string
  readonly durationDays: number
  /** What she will actually be charged: base + the studio's card surcharge. Paying here IS by card. */
  readonly totalKurus: number
  /** The price on the studio wall. Shown so the difference is explained rather than discovered. */
  readonly cashKurus: number
}

export interface HomeBanner {
  readonly id?: string
  readonly active: boolean
  readonly title: string
  readonly body: string
  readonly tone: 'accent' | 'gold' | 'good'
  readonly imageUrl?: string
  readonly detail?: string // long text shown on the banner detail screen
}
export interface HomeCampaign {
  readonly active: boolean
  readonly imageUrl: string
  readonly title: string
  readonly ctaLabel: string
  readonly ctaUrl: string
}
export interface HomeExtras {
  readonly occupancyLevel: string | null
  readonly banner: HomeBanner | null // legacy single banner (back-compat)
  readonly banners?: readonly HomeBanner[] // the carousel
  readonly branding: Branding | null
  readonly campaign: HomeCampaign | null
}

// The training endpoint returns everything the screen shows; the app reads the parts it renders.
export interface TrainingBundle {
  readonly programs: readonly import('@studio/core/client').MemberProgram[]
  readonly activeProgram: import('@studio/core/client').MemberProgram | null
  /**
   * The programme she trained most recently — the one the home screen's progress line speaks for.
   * A member may hold several active programmes, and picking "the first active one" told a member
   * who trains three times a week that she had never trained at all. `null` ⇒ she has not started.
   */
  readonly lastWorkoutProgramId: string | null
  readonly guides: Record<string, import('@studio/core/client').ExerciseGuide>
  readonly measurements: readonly import('@studio/core/client').MemberMeasurement[]
  readonly feedback: readonly import('@studio/core/client').MemberFeedback[]
  readonly photos: readonly import('@studio/core/client').MemberPhoto[]
  readonly showPrograms: boolean // pilates-only members see only measurements, no training programmes
}


// ── Workout log (v1.31) ─────────────────────────────────────────────────────────────────────
export interface WorkoutSetEntryDto {
  readonly exerciseId: string
  /** `null` ⇒ she did it as prescribed. An untouched field must cost no taps. */
  readonly sets: number | null
  readonly reps: string | null
  /** Integer grams — money and weights are never floats in a data path. */
  readonly weightGrams: number | null
  readonly skipped: boolean
}
export interface WorkoutLogDto {
  readonly id: string
  readonly programId: string
  readonly dayOrder: number
  readonly performedOn: string
  readonly entries: readonly WorkoutSetEntryDto[]
  readonly note: string
  readonly undoneAt: number | null
}
export interface WorkoutProgress {
  /** Derived from her logs, never a stored counter that could drift. */
  readonly cycle: { readonly completed: number; readonly nextDayOrder: number; readonly rounds: number }
  readonly logs: readonly WorkoutLogDto[]
  readonly dayCount: number
}
export interface CompleteWorkoutBody {
  readonly programId: string
  readonly dayOrder: number
  readonly performedOn: string
  readonly entries: readonly WorkoutSetEntryDto[]
  readonly note: string
}


// ── Fitness / consistency (v1.31 — corrected) ───────────────────────────────────────────────
//
// The app used to type this endpoint as core's `MemberFitness` ({ currentStreak, last30Count,
// visits }) while `/api/member/fitness` has always returned { stats, recent }. Nothing failed
// loudly: every field read came back `undefined`, so the "Son 30 gün" figure on Bugün and the
// streak line on Ben simply never rendered and no one could tell they were meant to.
//
// A wrong type is worse than no type — it is a lie the compiler enforces. This one matches the
// wire, so the compiler can start being useful about it again.
export interface MemberFitnessView {
  readonly stats: {
    readonly totalVisitDays: number
    readonly currentWeekVisits: number
    readonly currentStreakWeeks: number
    readonly longestStreakWeeks: number
    readonly lastVisitEpochDay: number | null
  }
  /** Recent check-in instants, newest first — what the consistency strip is drawn from. */
  readonly recent: readonly number[]
}


// ── Turnstile (v1.33) ───────────────────────────────────────────────────────────────────────
export interface TurnstileCross {
  readonly direction: 'in' | 'out'
  readonly deviceId: string
  readonly branchId: string
}
