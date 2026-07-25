'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createPublicMembershipCheckoutAction } from '@/server/actions/payments'

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

const REASON_TR: Record<string, string> = {
  invalid_phone: 'Geçerli bir cep telefonu girin (05xx xxx xx xx).',
  kvkk_required: 'Devam etmek için KVKK aydınlatma metnini onaylayın.',
  not_configured: 'Ödeme sistemi şu an kullanılamıyor. Lütfen stüdyoyla iletişime geçin.',
  unavailable: 'Bu paket şu anda satışta değil.',
  checkout_failed: 'Ödeme başlatılamadı. Lütfen tekrar deneyin.',
  rate_limited: 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.',
}

export interface UyelikItem {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly durationDays: number
  readonly totalKurus: number
}

export function UyelikForm({
  studioId,
  items,
  initialProductId,
}: {
  studioId: string
  items: readonly UyelikItem[]
  // The marketing site links straight to a package (`?p=`). An unknown id falls back to the first —
  // a stale link from an old post must still land on a working page, never on an empty one.
  initialProductId?: string
}) {
  const [productId, setProductId] = useState(
    (initialProductId && items.some((i) => i.id === initialProductId) ? initialProductId : items[0]?.id) ?? '',
  )
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [kvkk, setKvkk] = useState(false)
  const [busy, setBusy] = useState(false)

  const selected = items.find((i) => i.id === productId) ?? items[0]

  async function pay() {
    if (!selected) return
    if (name.trim().length < 2) return void toast.error('Ad soyad girin.')
    if (!kvkk) return void toast.error('KVKK aydınlatma metnini onaylayın.')
    setBusy(true)
    try {
      const res = await createPublicMembershipCheckoutAction({
        studioId,
        productId: selected.id,
        buyerName: name.trim(),
        buyerPhone: phone,
        buyerEmail: email.trim(),
        kvkkConsent: kvkk,
      })
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
      {/* Package picker — a tappable list; the selected one is highlighted. */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Paketini seç</p>
        {items.map((it) => {
          const active = it.id === productId
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => setProductId(it.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${
                active ? 'border-primary bg-primary-soft/50' : 'border-border hover:bg-muted/50'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{it.name}</span>
                {it.description ? <span className="block truncate text-xs text-muted-foreground">{it.description}</span> : null}
                <span className="block text-xs text-muted-foreground">{it.durationDays} gün geçerli</span>
              </span>
              <span className="shrink-0 text-base font-semibold tabular-nums text-foreground">{tl(it.totalKurus)}</span>
            </button>
          )
        })}
      </div>

      {/* Buyer details */}
      <div className="space-y-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ad Soyad" autoComplete="name" />
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Telefon (05xx xxx xx xx)"
          inputMode="tel"
          autoComplete="tel"
        />
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-posta (opsiyonel)" inputMode="email" autoComplete="email" />
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={kvkk} onChange={(e) => setKvkk(e.target.checked)} />
        <span>
          <a href="/gizlilik" target="_blank" rel="noopener" className="font-medium text-primary underline">
            KVKK aydınlatma metnini
          </a>{' '}
          okudum, kişisel verilerimin üyelik işlemleri için işlenmesini onaylıyorum.
        </span>
      </label>

      <Button className="min-h-12 w-full text-base" onClick={() => void pay()} disabled={busy || !selected}>
        {busy ? <Loader2Icon className="animate-spin" /> : null}
        {selected ? `${tl(selected.totalKurus)} Öde` : 'Öde'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Ödeme sonrası üyeliğin hemen aktif olur; giriş bağlantısını WhatsApp&apos;tan göndeririz.
      </p>
    </div>
  )
}
