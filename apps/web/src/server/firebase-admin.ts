import { getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth, type Auth } from 'firebase-admin/auth'

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
