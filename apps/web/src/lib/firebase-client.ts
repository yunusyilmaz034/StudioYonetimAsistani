import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from 'firebase/firestore'

// Firebase client SDK against the Emulator Suite with a fixed demo project id: no
// real project, no real secrets.
//
// Firestore is initialised WITHOUT offline persistence: the offline data strategy
// belongs to the check-in milestone and its command flow, not here (v1.5/v1.6
// correction). Reads here are plain online reads.
const firebaseConfig = {
  apiKey: 'demo-api-key',
  authDomain: 'demo-sos.firebaseapp.com',
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
