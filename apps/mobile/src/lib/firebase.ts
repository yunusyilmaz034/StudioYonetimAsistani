// Firebase Auth for React Native. The member signs in with the SAME synthetic phone-email + password
// as the web portal; the app just needs an ID token to send to `/api/member`. Persistence uses
// AsyncStorage so the session survives an app restart (the web equivalent is the httpOnly cookie).
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getApp, getApps, initializeApp } from 'firebase/app'
// @ts-expect-error — getReactNativePersistence is exported by firebase/auth at runtime for RN but is
// intentionally absent from the web-typed surface.
import { getAuth, getReactNativePersistence, initializeAuth, type Auth } from 'firebase/auth'

import { FIREBASE_CONFIG } from '@/config'

function app() {
  return getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG)
}

let cached: Auth | null = null
export function auth(): Auth {
  if (cached) return cached
  try {
    cached = initializeAuth(app(), { persistence: getReactNativePersistence(AsyncStorage) })
  } catch {
    // initializeAuth throws if already initialised (Fast Refresh) — fall back to the existing instance.
    cached = getAuth(app())
  }
  return cached
}
