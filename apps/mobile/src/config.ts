// Runtime configuration for the member app. None of this is secret: the Firebase web `apiKey` is a
// project IDENTIFIER (what protects the data is Auth + Firestore rules + the server-side member API),
// and the studio id + API base are public. The same values the web app ships (apphosting.yaml).
//
// ── Which studio is this build for? (Faz A4) ───────────────────────────────────────────────
// It is no longer written here. `app.config.js` reads a profile from `studios/` at build time and
// puts the answer in `expo.extra`; this file reads it back. So the studio travels INSIDE the build,
// and opening a white-label app is a new profile rather than an edit to a source file somebody must
// remember to revert.
import Constants from 'expo-constants'

interface StudioExtra {
  readonly studioId?: string
  readonly apiBase?: string
  readonly displayName?: string
}

const extra = (Constants.expoConfig?.extra ?? {}) as StudioExtra

// It THROWS rather than defaulting to the pilot. A build whose config did not resolve is a build
// that would point at another studio's data while looking perfectly healthy — and it would only be
// discovered by a member seeing somebody else's classes. Failing at startup is the cheap failure.
function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Yapılandırma eksik: expo.extra.${name}. app.config.js çözümlenmemiş — 'npx expo config' ile bak.`,
    )
  }
  return value
}

export const STUDIO_ID = required(extra.studioId, 'studioId')
export const API_BASE = required(extra.apiBase, 'apiBase')

/** The studio's own name, for the one screen that must show it before any data has loaded. */
export const STUDIO_NAME = extra.displayName ?? ''

// Shared by every studio: the platform is multi-tenant on ONE Firebase project, and a studio is a
// `studioId` inside it — never a project of its own. That is the architecture's first sentence, and
// it is why nothing below is per-studio.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBYCZEFu-oxit5J9h_pgNnEfCyYyud1b0s',
  authDomain: 'studio-yonetim-prod.firebaseapp.com',
  projectId: 'studio-yonetim-prod',
  storageBucket: 'studio-yonetim-prod.firebasestorage.app',
} as const
