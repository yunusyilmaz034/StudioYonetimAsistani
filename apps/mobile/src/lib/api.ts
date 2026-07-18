// The typed member API client. Every call attaches the member's current Firebase ID token (refreshed
// automatically by the SDK) as a Bearer header; the server verifies it and derives her identity. The
// return types come from `@studio/core/client` — the ONE wire contract shared with the backend.
import type {
  ApiResult,
  InboxItem,
  LeaveFeedbackInput,
  MemberAgenda,
  MemberDashboard,
  MemberFitness,
  MemberProfile,
  MemberReservations,
  NotificationPrefs,
  QrToken,
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
  book: (sessionId: string) => post<ApiResult<{ reservationId: string }>>('/book', { sessionId }),
  cancel: (reservationId: string) => post<ApiResult<unknown>>('/cancel', { reservationId }),
  profile: () => get<MemberProfile>('/profile'),
  updateProfile: (body: { email: string | null; emergencyName: string | null; emergencyPhone: string | null }) =>
    post<ApiResult<unknown>>('/profile', body),
  training: () => get<TrainingBundle>('/training'),
  leaveFeedback: (body: LeaveFeedbackInput) => post<ApiResult<unknown>>('/feedback', body),
  fitness: () => get<MemberFitness>('/fitness'),
  inbox: () => get<readonly InboxItem[]>('/inbox'),
  markRead: (intentId: string) => post<ApiResult<unknown>>('/inbox', { intentId }),
  prefs: () => get<NotificationPrefs>('/prefs'),
  setPrefs: (prefs: NotificationPrefs) => post<ApiResult<unknown>>('/prefs', prefs),
  qrContext: () => get<{ studioId: string; branchId: string | null }>('/qr'),
  mintQr: (branchId: string) => post<QrToken>('/qr', { branchId }),
  wallet: () => get<WalletSummary>('/wallet'),
  registerDevice: (token: string, platform: string) => post<ApiResult<unknown>>('/devices', { token, platform }),
}

// The training endpoint returns everything the screen shows; the app reads the parts it renders.
export interface TrainingBundle {
  readonly programs: readonly import('@studio/core/client').MemberProgram[]
  readonly activeProgram: import('@studio/core/client').MemberProgram | null
  readonly guides: Record<string, import('@studio/core/client').ExerciseGuide>
  readonly measurements: readonly import('@studio/core/client').MemberMeasurement[]
  readonly feedback: readonly import('@studio/core/client').MemberFeedback[]
  readonly photos: readonly import('@studio/core/client').MemberPhoto[]
}
