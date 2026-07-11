import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

// The Admin SDK singleton for the functions runtime. In deployment it initialises
// from the ambient service account; under the emulator `FIRESTORE_EMULATOR_HOST`
// routes it to the local Firestore. Trusted state writes here bypass security rules
// by design — the actor is a `system` principal or the command's own principal.
export function db(): Firestore {
  const app = getApps()[0] ?? initializeApp()
  return getFirestore(app)
}
