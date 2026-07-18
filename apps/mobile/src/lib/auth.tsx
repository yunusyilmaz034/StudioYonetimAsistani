// Auth state for the whole app. Phone + password (AD-70, same as the web portal): the app resolves the
// synthetic email from the phone, then signs in with Firebase. `onAuthStateChanged` drives navigation.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'

import { resolveLoginEmail } from './api'
import { auth } from './firebase'

interface AuthState {
  readonly user: User | null
  readonly loading: boolean
  readonly signIn: (phone: string, password: string) => Promise<void>
  readonly signOutMember: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth(), (u) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      async signIn(phone, password) {
        const email = await resolveLoginEmail(phone)
        await signInWithEmailAndPassword(auth(), email, password)
      },
      async signOutMember() {
        await signOut(auth())
      },
    }),
    [user, loading],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
  return v
}
