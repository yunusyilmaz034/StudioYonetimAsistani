import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from 'firebase/firestore'

// THE FIREBASE WEB CONFIG (hotfix B-1, 2026-07-13).
//
// It used to be HARDCODED to the emulator's demo values — `apiKey: 'demo-api-key'`,
// `authDomain: 'demo-sos.firebaseapp.com'` — with only the project id coming from the environment.
// Against a real project that key is not a key, and **nobody could have signed in to production.**
// The login screen would have refused the owner on the first morning of the pilot.
//
// ── These are IDENTIFIERS, not credentials, and that is why they may be public ───────────────
// A Firebase web `apiKey` is not a secret: it identifies the project to Google's front door. What
// actually protects the data is Firebase Auth plus the security rules, which is why this file may sit
// in the browser bundle at all. A real secret NEVER appears here — it lives in Secret Manager and is
// read server-side by `server/secrets.ts`, which refuses to start without it.
//
// The DEV fallbacks below are the emulator's, and they are fallbacks rather than the truth: a
// production build that forgets its environment gets a config that cannot reach anything, which is
// exactly the failure we want — loud, immediate, and at the front door.
//
// Firestore is initialised WITHOUT offline persistence: the offline data strategy belongs to the
// check-in milestone and its command flow, not here (v1.5/v1.6 correction).
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'demo-api-key',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'demo-sos.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-sos',
}

function app(): FirebaseApp {
  return getApps()[0] ?? initializeApp(firebaseConfig)
}

let cachedAuth: Auth | null = null

export function clientAuth(): Auth {
  if (cachedAuth) return cachedAuth
  const auth = getAuth(app())
  if (useEmulator()) {
    connectAuthEmulator(auth, emulatorAuthUrl(), { disableWarnings: true })
  }
  cachedAuth = auth
  return auth
}

let cachedDb: Firestore | null = null

export function clientDb(): Firestore {
  if (cachedDb) return cachedDb
  const db = getFirestore(app())
  if (useEmulator()) {
    const [host, port] = firestoreEmulator()
    connectFirestoreEmulator(db, host, port)
  }
  cachedDb = db
  return db
}

function useEmulator(): boolean {
  return (
    process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === 'true' ||
    process.env.NODE_ENV !== 'production'
  )
}

function emulatorAuthUrl(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099'
}

function firestoreEmulator(): [string, number] {
  const raw = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR ?? '127.0.0.1:8080'
  const [host, port] = raw.split(':')
  return [host ?? '127.0.0.1', Number(port ?? '8080')]
}
