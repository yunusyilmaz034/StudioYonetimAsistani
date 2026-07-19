// Mobile analytics — the SAME surface as the web `lib/analytics.ts` (track / trackError /
// setAnalyticsContext), so call sites read identically across the two apps.
//
// ── Why this is a no-op today, and how it turns on ───────────────────────────────────────────
// React Native cannot use the JS `firebase/analytics` (it needs a DOM). Real mobile Analytics +
// Crashlytics require the NATIVE `@react-native-firebase/*` modules, which need: the packages
// installed, the Expo config plugins added, the studio's `google-services.json` /
// `GoogleService-Info.plist` from the Firebase console, and an EAS/dev build (Expo Go can't load
// native modules). None of that can be provisioned or verified from a headless shell, and a half-wired
// native dependency would break the owner's build silently — so this file is the SEAM, not the wiring.
//
// It is a safe no-op now (a dev-only console echo), and every screen already calls it. Turning it on
// is a native, owner-run step documented in `docs/ops/mobile-analytics-crashlytics.md`; when it lands,
// ONLY the bodies below change — not a single call site. This is the phase-discipline move: build the
// extension point, don't ship an unverifiable native integration early.
//
// The PII rule from the web applies here too: pass ids and enums, never a name/phone/free text.

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

const DEV = typeof __DEV__ !== 'undefined' && __DEV__

// eslint-disable-next-line no-console
const echo = (label: string, payload: unknown) => DEV && console.log(`[analytics] ${label}`, payload)

export function track(name: AnalyticsEvent, params?: Params): void {
  // TODO(mobile-analytics): analytics().logEvent(name, params) once @react-native-firebase is wired.
  echo(name, params ?? {})
}

export function setAnalyticsContext(props: { studioId?: string; role?: string }): void {
  // TODO(mobile-analytics): analytics().setUserProperties(props) + crashlytics().setAttributes(props).
  echo('context', props)
}

export function trackError(error: unknown, context?: { where?: string; fatal?: boolean }): void {
  const description = error instanceof Error ? error.message : String(error)
  // TODO(mobile-analytics): crashlytics().recordError(error) + logEvent('exception', ...).
  echo('exception', { description: description.slice(0, 300), ...context })
}
