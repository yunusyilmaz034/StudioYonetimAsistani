'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { setStaffPasswordAction } from '@/server/actions/staff-invite'

// Meslektaşın göreceği tek ekran: adı, e-postası, ve iki şifre kutusu. Owner şifreyi hiç görmez —
// davet mekanizmasının bütün amacı bu.
export function StaffInviteForm({
  studioId,
  token,
  displayName,
  email,
}: {
  studioId: string
  token: string
  displayName: string
  email: string
}) {
  const router = useRouter()
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [busy, setBusy] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [bitti, setBitti] = useState(false)

  const kisa = p1.length > 0 && p1.length < 8
  const uyusmuyor = p2.length > 0 && p1 !== p2
  const gecerli = p1.length >= 8 && p1 === p2

  async function kaydet() {
    setBusy(true)
    setHata(null)
    try {
      const res = await setStaffPasswordAction({ studioId, token, password: p1 })
      if (res.ok) setBitti(true)
      else setHata(res.reason === 'weak' ? 'Şifre en az 8 karakter olmalı.' : 'Bu davet artık geçerli değil. Stüdyodan yeni bir bağlantı isteyin.')
    } catch {
      setHata('İşlem tamamlanamadı. Bağlantınızı kontrol edip tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  if (bitti) {
    return (
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <p className="text-2xl" aria-hidden>
          ✅
        </p>
        <h1 className="text-lg font-semibold text-foreground">Şifreniz belirlendi</h1>
        <p className="text-sm text-muted-foreground">
          Artık <b className="text-foreground">{email}</b> ile giriş yapabilirsiniz.
        </p>
        <Button className="w-full" onClick={() => router.push('/login')}>
          Giriş ekranına git
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-semibold text-foreground">Hoş geldiniz, {displayName} 🌸</h1>
        <p className="text-sm text-muted-foreground">
          Panele girmek için kendi şifrenizi belirleyin. Bu şifreyi yalnızca siz bilirsiniz.
        </p>
        <p className="pt-1 text-xs text-muted-foreground">{email}</p>
      </div>

      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Yeni şifre</span>
          <PasswordInput value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" />
          {kisa ? <span className="block text-xs text-danger">En az 8 karakter olmalı.</span> : null}
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Şifreyi tekrar yazın</span>
          <PasswordInput value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" />
          {uyusmuyor ? <span className="block text-xs text-danger">İki şifre aynı değil.</span> : null}
        </label>
      </div>

      {hata ? <p className="text-sm text-danger">{hata}</p> : null}

      <Button className="w-full" onClick={() => void kaydet()} disabled={!gecerli || busy}>
        {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
        Şifremi belirle
      </Button>
    </div>
  )
}
