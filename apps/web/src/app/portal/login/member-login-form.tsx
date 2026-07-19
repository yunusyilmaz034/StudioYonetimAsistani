'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useMathCaptcha } from '@/components/math-captcha'
import { track } from '@/lib/analytics'
import { clientAuth } from '@/lib/firebase-client'
import { createSession } from '@/server/actions/session'
import { memberLoginIdentifierAction, recordPortalLoginAction } from '@/server/actions/portal-auth'

// D3 — the member logs in with PHONE + password. The synthetic e-mail Firebase needs is derived
// server-side from the normalised phone (AD-40); she never sees it and never types it.
export function MemberLoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const studioId = params.get('s') ?? ''
  const justActivated = params.get('welcome') === '1'

  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // PF-29 — a simple captcha appears after the first failed attempt.
  const [attempts, setAttempts] = useState(0)
  const captcha = useMathCaptcha()
  const needsCaptcha = attempts >= 1

  // PF-30 — the member portal ignores a STAFF session in the same browser. If a non-member Firebase
  // user is signed in (the owner testing both), sign it out so member login starts clean and never
  // bounces to the admin app. A genuine member session is left alone.
  useEffect(() => {
    const u = clientAuth().currentUser
    if (!u) return
    void u
      .getIdTokenResult()
      .then((t) => {
        if (t.claims.role !== 'member') void signOut(clientAuth())
      })
      .catch(() => {})
  }, [])

  async function submit() {
    if (needsCaptcha && !captcha.solved) {
      setError('Lütfen doğrulama sorusunu doğru yanıtlayın.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // The phone is normalised on the SERVER (AD-40). Importing core here would pull
      // firebase-admin into the browser bundle.
      const id = await memberLoginIdentifierAction({ studioId, phone })
      if (!id.ok) {
        setError('Telefon numarası geçersiz.')
        setBusy(false)
        return
      }
      const cred = await signInWithEmailAndPassword(clientAuth(), id.value.email, password)
      await createSession(await cred.user.getIdToken())
      await recordPortalLoginAction()
      track('login_success', { surface: 'member' })
      router.replace('/portal')
    } catch {
      // One message for every failure: wrong phone, wrong password, no account. A prober learns
      // nothing about which members exist.
      track('login_failure', { surface: 'member' })
      setError('Telefon veya şifre hatalı.')
      setAttempts((a) => a + 1)
      captcha.reset()
      setBusy(false)
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-h1">Üye Girişi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {justActivated ? (
          <p className="rounded-lg bg-success/10 p-3 text-sm text-success">
            Şifreniz belirlendi. Şimdi giriş yapabilirsiniz.
          </p>
        ) : null}
        <Input
          placeholder="Telefon (05xx xxx xx xx)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoFocus
        />
        <Input
          type="password"
          placeholder="Şifre"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {needsCaptcha ? captcha.node : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button className="min-h-11 w-full" onClick={submit} disabled={busy || !studioId || (needsCaptcha && !captcha.solved)}>
          {busy ? <Loader2Icon className="animate-spin" /> : null} Giriş Yap
        </Button>
        {!studioId ? (
          <p className="text-xs text-muted-foreground">
            Bu bağlantı eksik. Lütfen stüdyodan aldığınız giriş bağlantısını kullanın.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
