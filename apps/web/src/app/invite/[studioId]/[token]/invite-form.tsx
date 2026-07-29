'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { domainErrorMessage } from '@/lib/domain-error'
import { isStaleDeployment } from '@/lib/stale-deployment'
import { activateMemberAction, openInviteAction } from '@/server/actions/portal-auth'

// The member sets HER OWN password here. Reception never knows it — that is the whole point of
// the invite (D1).
// ── A member cannot be told to press Ctrl+R (2026-07-29) ────────────────────────────────────
//
// Staff get a "Sayfayı Yenile" button when their tab predates the running deployment. A member with
// this page open on her phone gets no such instruction — she sees "İşlem tamamlanamadı, tekrar
// deneyin", retries, fails again, and messages the studio. That happened tonight to a member whose
// invite was perfectly valid; the only broken thing was her copy of the page.
//
// So here the page heals itself. She loses two typed password fields, which costs her five seconds,
// and gets a working page instead of a dead end. The wait exists so the sentence is readable before
// the screen changes — a reload with no explanation reads as a crash.
//
// The same guard covers the OPEN call: without it a stale tab reports "Bağlantı geçersiz" about a
// link that is fine, and sends her to reception for a replacement she does not need.
const RELOAD_AFTER_MS = 1200
const REFRESHING = 'Panel güncellendi, sayfa yenileniyor…'

export function InviteForm({ studioId, token }: { studioId: string; token: string }) {
  const router = useRouter()
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    openInviteAction({ studioId, token })
      .then((r) => {
        if (r.ok) {
          setName(r.value.displayName)
          setState('ready')
        } else {
          setState('invalid')
        }
      })
      .catch((e) => {
        if (isStaleDeployment(e)) {
          setError(REFRESHING)
          setTimeout(() => window.location.reload(), RELOAD_AFTER_MS)
          return
        }
        setState('invalid')
      })
  }, [studioId, token])

  async function submit() {
    if (password !== confirm) {
      setError('Şifreler eşleşmiyor.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await activateMemberAction({ studioId, token, password })
      if (res.ok) {
        router.replace(`/portal/login?s=${encodeURIComponent(studioId)}&welcome=1`)
      } else {
        setError(domainErrorMessage(res.error))
        setBusy(false)
      }
    } catch (e) {
      if (isStaleDeployment(e)) {
        setError(REFRESHING)
        setTimeout(() => window.location.reload(), RELOAD_AFTER_MS)
        return
      }
      setError('İşlem tamamlanamadı. Lütfen tekrar deneyin.')
      setBusy(false)
    }
  }

  if (state === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
      </p>
    )
  }

  if (state === 'invalid') {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-h1">Bağlantı geçersiz</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Bu davet artık geçerli değil. Lütfen stüdyodan yeni bir bağlantı isteyin.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-h1">Hoş geldiniz{name ? `, ${name}` : ''}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Hesabınızı aktifleştirmek için bir şifre belirleyin. Girişte telefon numaranızı ve bu
          şifreyi kullanacaksınız.
        </p>
        <Input
          type="password"
          placeholder="Şifre (en az 8 karakter)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        <Input
          type="password"
          placeholder="Şifre (tekrar)"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button className="min-h-11 w-full" onClick={submit} disabled={busy || password.length < 8}>
          {busy ? <Loader2Icon className="animate-spin" /> : null} Şifremi Belirle
        </Button>
      </CardContent>
    </Card>
  )
}
