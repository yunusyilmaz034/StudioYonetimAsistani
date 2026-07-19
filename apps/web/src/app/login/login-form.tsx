'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { FirebaseError } from 'firebase/app'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMathCaptcha } from '@/components/math-captcha'
import { track } from '@/lib/analytics'
import { clientAuth } from '@/lib/firebase-client'
import { requestPasswordReset } from '@/server/actions/password-reset'
import { createSession } from '@/server/actions/session'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)
  // PF-29 — after the first failure, require a simple captcha before the next attempt.
  const [attempts, setAttempts] = useState(0)
  const captcha = useMathCaptcha()
  const needsCaptcha = attempts >= 1

  // The answer is the same whether or not the address exists — see `requestPasswordReset`. The login
  // page must not become a way to find out who works here.
  async function onReset() {
    if (!email.trim()) {
      setError('Önce e-posta adresini yaz, sonra sıfırlama bağlantısı gönderelim.')
      return
    }
    setLoading(true)
    setError(null)
    await requestPasswordReset(email)
    setResetSent(true)
    setLoading(false)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (needsCaptcha && !captcha.solved) {
      setError('Lütfen doğrulama sorusunu doğru yanıtlayın.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const credential = await signInWithEmailAndPassword(clientAuth(), email, password)
      const idToken = await credential.user.getIdToken()
      await createSession(idToken)
      track('login_success', { surface: 'staff' })
      router.replace('/')
    } catch (err) {
      track('login_failure', { surface: 'staff' })
      setError(toMessage(err))
      setAttempts((a) => a + 1)
      captcha.reset()
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

      {needsCaptcha ? captcha.node : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {resetSent ? (
        <p role="status" className="text-sm text-muted-foreground">
          Bu adres kayıtlıysa, şifre belirleme bağlantısı gönderildi. Gelen kutunu kontrol et.
        </p>
      ) : null}

      <Button type="submit" className="min-h-11 w-full" disabled={loading || (needsCaptcha && !captcha.solved)}>
        {loading ? (
          <>
            <Loader2Icon className="animate-spin" />
            Giriş yapılıyor…
          </>
        ) : (
          'Giriş Yap'
        )}
      </Button>

      <button
        type="button"
        onClick={onReset}
        disabled={loading}
        className="min-h-11 w-full text-sm text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
      >
        Şifremi unuttum
      </button>
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
