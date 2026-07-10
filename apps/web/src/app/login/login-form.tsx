'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { FirebaseError } from 'firebase/app'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { clientAuth } from '@/lib/firebase-client'
import { createSession } from '@/server/actions/session'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const credential = await signInWithEmailAndPassword(clientAuth(), email, password)
      const idToken = await credential.user.getIdToken()
      await createSession(idToken)
      router.replace('/')
    } catch (err) {
      setError(toMessage(err))
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          E-posta
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          Parola
        </label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" className="min-h-11 w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2Icon className="animate-spin" />
            Giriş yapılıyor…
          </>
        ) : (
          'Giriş Yap'
        )}
      </Button>
    </form>
  )
}

function toMessage(err: unknown): string {
  if (err instanceof FirebaseError) {
    if (
      err.code === 'auth/invalid-credential' ||
      err.code === 'auth/wrong-password' ||
      err.code === 'auth/user-not-found' ||
      err.code === 'auth/invalid-email'
    ) {
      return 'E-posta veya parola hatalı.'
    }
    if (err.code === 'auth/too-many-requests') {
      return 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.'
    }
  }
  return 'Giriş yapılamadı. Lütfen tekrar deneyin.'
}
