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
  fitness: () => get<MemberFitness>('/fitness'),
  home: () => get<HomeExtras>('/home'),
  inbox: () => get<readonly InboxItem[]>('/inbox'),
  markRead: (intentId: string) => post<ApiResult<unknown>>('/inbox', { intentId }),
  prefs: () => get<NotificationPrefs>('/prefs'),
  setPrefs: (prefs: NotificationPrefs) => post<ApiResult<unknown>>('/prefs', prefs),
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
  uploadPhoto: (dataUrl: string) => post<ApiResult<{ avatarUrl: string | null }>>('/photo', { dataUrl }),
}

export interface MemberProduct {
  readonly id: string
  readonly name: string
  readonly priceInKurus: number
  readonly category: string
  readonly durationDays: number
}

export interface HomeBanner {
  readonly active: boolean
  readonly title: string
  readonly body: string
  readonly tone: 'accent' | 'gold' | 'good'
  readonly imageUrl?: string
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
  readonly banner: HomeBanner | null
  readonly branding: Branding | null
  readonly campaign: HomeCampaign | null
}

// The training endpoint returns everything the screen shows; the app reads the parts it renders.
export interface TrainingBundle {
  readonly programs: readonly import('@studio/core/client').MemberProgram[]
  readonly activeProgram: import('@studio/core/client').MemberProgram | null
  readonly guides: Record<string, import('@studio/core/client').ExerciseGuide>
  readonly measurements: readonly import('@studio/core/client').MemberMeasurement[]
  readonly feedback: readonly import('@studio/core/client').MemberFeedback[]
  readonly photos: readonly import('@studio/core/client').MemberPhoto[]
  readonly showPrograms: boolean // pilates-only members see only measurements, no training programmes
}
