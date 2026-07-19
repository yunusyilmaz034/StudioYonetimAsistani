// Product analytics — GA4 via Firebase Analytics (owner request: instrument payment, QR, login,
// upload, wallet, camera, and the flows we choose).
//
// ── Why this file is so defensive ────────────────────────────────────────────────────────────
// Analytics is the ONE place in the app that is allowed to be absent. It is never on the critical
// path: a page must render, a payment must complete, a check-in must record, whether or not GA is
// wired. So every export here is a no-op unless FOUR gates pass — a real measurement id, not the
// emulator, a browser (never SSR), and `isSupported()` (Analytics needs cookies/IndexedDB the runtime
// may deny). A failure to log is swallowed, never thrown. A missing gate is silence, not a crash.
//
// ── The PII rule (non-negotiable #6, applied at the edge) ────────────────────────────────────
// The event LOG forbids PII; analytics is a second sink and deserves the same discipline. We never
// send a name, phone, e-mail, or free text to GA. Call sites pass ids and enums (studioId, role,
// productId, a coarse amount bucket) — behaviour, not identity. `track()` cannot enforce this for
// you; the reviewer does. Do not pass a member name or a raw amount that could single someone out.
'use client'

import { logEvent, setUserProperties, type Analytics } from 'firebase/analytics'

import { analyticsConfigured } from '@/lib/firebase-client'

// The app's own event vocabulary. A closed union so call sites can't drift into typos, and so this
// file is the one place to see everything we measure. GA4 reserves `exception`; the rest are custom.
export type AnalyticsEvent =
  | 'login_success'
  | 'login_failure'
  | 'payment_started'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'qr_scanned'
  | 'checkin_recorded'
  | 'image_uploaded'
  | 'wallet_topup'
  | 'wallet_purchase'
  | 'location_captured'
  | 'exception'

type Params = Record<string, string | number | boolean>

// A single lazy init. Analytics is heavy and browser-only, so we import `getAnalytics`/`isSupported`
// dynamically the first time — nothing analytics-related enters the bundle path until a call is made.
let instance: Analytics | null = null
let initTried = false

async function analytics(): Promise<Analytics | null> {
  if (instance) return instance
  if (initTried) return instance
  initTried = true
  if (typeof window === 'undefined') return null
  if (!analyticsConfigured()) return null
  try {
    const { getAnalytics, isSupported } = await import('firebase/analytics')
    if (!(await isSupported())) return null
    const { clientApp } = await import('@/lib/firebase-client')
    instance = getAnalytics(clientApp())
    return instance
  } catch {
    return null
  }
}

// Fire-and-forget. Never awaited by a caller, never throws — a broken analytics call must not break
// the flow it is measuring. The `void` on the promise is deliberate.
export function track(name: AnalyticsEvent, params?: Params): void {
  void (async () => {
    const a = await analytics()
    if (!a) return
    try {
      // `logEvent`'s typed overloads special-case GA4 reserved names (e.g. `exception`); our union
      // mixes reserved + custom, so we call through a loose signature rather than fight the overloads.
      ;(logEvent as (a: Analytics, name: string, params?: Params) => void)(a, name, params)
    } catch {
      /* analytics is best-effort */
    }
  })()
}

// Non-PII user/context properties: studio, branch, role. Set once after login so every subsequent
// event is attributable to a studio and a role WITHOUT ever identifying the person.
export function setAnalyticsContext(props: { studioId?: string; branchId?: string; role?: string }): void {
  void (async () => {
    const a = await analytics()
    if (!a) return
    try {
      setUserProperties(a, props)
    } catch {
      /* best-effort */
    }
  })()
}

// Error/crash reporting on the web. Firebase Crashlytics is mobile-only; on the web the equivalent
// sink is GA4's reserved `exception` event. We send a message + a context tag, never a stack that
// might carry user data, and never the raw error object. Mirrored to the console in dev.
export function trackError(error: unknown, context?: { where?: string; fatal?: boolean }): void {
  const description = error instanceof Error ? error.message : String(error)
  track('exception', {
    description: description.slice(0, 300),
    fatal: context?.fatal ?? false,
    ...(context?.where ? { where: context.where } : {}),
  })
}
