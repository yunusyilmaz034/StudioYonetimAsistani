import { getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getStorage, type Storage } from 'firebase-admin/storage'

// Admin SDK singleton — server only (its directory is the enforced boundary; see
// the dependency-cruiser `no-firestore-outside-infrastructure` rule).
//
// Emulator only in v1.5: when FIREBASE_AUTH_EMULATOR_HOST is set, the Admin SDK
// talks to the Auth emulator and needs no credentials. Production would add real
// credentials (applicationDefault / a service account) here once the real project
// exists — that is out of this milestone (decision #1).
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  'demo-sos'

function adminApp(): App {
  return getApps()[0] ?? initializeApp({ projectId: PROJECT_ID })
}

export function adminAuth(): Auth {
  return getAuth(adminApp())
}

// The Admin Firestore. When FIRESTORE_EMULATOR_HOST is set it talks to the
// emulator. Trusted state writes (members, /products, …) go through this, which
// bypasses security rules by design (authorization is requireTenantContext()).
export function adminDb(): Firestore {
  return getFirestore(adminApp())
}

// Admin Storage. Progress photos (member PII, §2) live in a private bucket; a short-lived signed
// URL is minted on read, and NOTHING is ever made public. The bucket name comes from config, so a
// misconfigured environment fails loudly rather than writing to the wrong bucket.
const STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET ??
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
  `${PROJECT_ID}.firebasestorage.app`

export function adminStorage(): Storage {
  return getStorage(adminApp())
}

export function storageBucketName(): string {
  return STORAGE_BUCKET
}
