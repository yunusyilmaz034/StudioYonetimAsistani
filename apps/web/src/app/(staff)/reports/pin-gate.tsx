'use client'

import { useState } from 'react'
import { LockIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { unlockReportsAction } from '@/server/actions/report-pin'

// Raporların önündeki ikinci kapı (owner, 2026-09-30).
//
// Birinci kapı rol: `/reports` zaten yalnızca owner'a açık. Bu kapı ise AÇIK BIRAKILMIŞ OTURUM
// için: makinenin başına geçen kişi owner'ın rolüyle geziyor olabilir. O yüzden burada sorulan şey
// "kimsin" değil, "bunu sen mi açıyorsun".
//
// PIN ekranda hiçbir zaman gösterilmiyor; yanlış PIN'de de neyin yanlış olduğu söylenmiyor —
// "yok mu, yanlış mı" ayrımı denemeyi kolaylaştırır.
export function ReportPinGate({ varsayilan }: { varsayilan: boolean }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (pin.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const res = await unlockReportsAction(pin.trim())
      if (res.ok) {
        // Sunucu bileşenini yeniden çalıştır: kilit çerezi artık var, sayfa raporu döndürecek.
        window.location.reload()
        return
      }
      setError(res.code === 'too_many' ? 'Çok fazla deneme yapıldı. On dakika sonra tekrar deneyin.' : 'PIN doğru değil.')
    } catch {
      setError('Doğrulanamadı. Bağlantınızı kontrol edip tekrar deneyin.')
    }
    setBusy(false)
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6 sm:p-10">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <LockIcon className="size-5" />
        </span>
        <div>
          <h1 className="text-lg font-medium">Raporlar kilitli</h1>
          <p className="text-sm text-muted-foreground">Devam etmek için PIN girin.</p>
        </div>
      </div>

      <Input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        placeholder="PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
      />

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <Button onClick={() => void submit()} disabled={busy || pin.trim() === ''}>
        {busy ? 'Kontrol ediliyor…' : 'Aç'}
      </Button>

      <p className="text-xs text-muted-foreground">
        Kilit on beş dakika açık kalır, sonra yeniden sorar. PIN&apos;i Ayarlar → Genel bölümünden
        değiştirebilirsin.
      </p>

      {/* Açılış PIN'i hiç değiştirilmediyse söylenir — ama DEĞERİ asla. Değiştirilmemiş bir PIN,
          olmayan bir kilittir; bunu sessizce geçmek kilidi kurmuş gibi yapmak olurdu. */}
      {varsayilan ? (
        <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          Bu PIN hiç değiştirilmedi. Ayarlar → Genel bölümünden kendi PIN&apos;ini belirle.
        </p>
      ) : null}
    </main>
  )
}
