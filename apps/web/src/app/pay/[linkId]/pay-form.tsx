'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createCollectionCheckoutAction } from '@/server/actions/payments'

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

const REASON_TR: Record<string, string> = {
  invalid_phone: 'Geçerli bir cep telefonu girin (05xx xxx xx xx).',
  not_configured: 'Ödeme sistemi şu an kullanılamıyor. Lütfen stüdyoyla iletişime geçin.',
  unavailable: 'Bu ödeme linki artık geçerli değil.',
  checkout_failed: 'Ödeme başlatılamadı. Lütfen tekrar deneyin.',
  rate_limited: 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.',
}

export function PayForm({
  studioId,
  linkId,
  label,
  amountKurus,
  maxInstallments,
}: {
  studioId: string
  linkId: string
  label: string
  amountKurus: number
  maxInstallments: number
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)

  async function pay() {
    if (name.trim().length < 2) return void toast.error('Ad soyad girin.')
    setBusy(true)
    try {
      const res = await createCollectionCheckoutAction({ studioId, linkId, buyerName: name.trim(), buyerPhone: phone })
      if (res.ok) {
        window.location.href = res.redirectUrl // → PAYTR
      } else {
        toast.error(REASON_TR[res.reason] ?? 'Ödeme başlatılamadı.')
        setBusy(false)
      }
    } catch {
      toast.error('Bir hata oluştu. Lütfen tekrar deneyin.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold tabular-nums text-foreground">{tl(amountKurus)}</p>
        {maxInstallments > 1 ? (
          <p className="text-xs text-muted-foreground">{maxInstallments} taksite kadar</p>
        ) : null}
      </div>

      <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-center text-xs leading-relaxed text-muted-foreground">
        Üyelik <span className="font-medium text-foreground">kimin adına</span> alınacaksa onun ad-soyad ve telefon
        bilgisini girin. Burası henüz ödeme sayfası değildir; bilgileri aldıktan sonra sizi güvenli ödeme sayfasına
        yönlendireceğiz.
      </div>

      <div className="space-y-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ad Soyad" autoComplete="name" />
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Telefon (05xx xxx xx xx)"
          inputMode="tel"
          autoComplete="tel"
        />
      </div>

      <Button className="min-h-12 w-full text-base" onClick={() => void pay()} disabled={busy}>
        {busy ? <Loader2Icon className="animate-spin" /> : null}
        {tl(amountKurus)} Öde
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Ödeme PAYTR güvenli altyapısı üzerinden alınır. Kart bilgileriniz bizde saklanmaz.
      </p>
    </div>
  )
}
