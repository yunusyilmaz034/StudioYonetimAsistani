'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { track } from '@/lib/analytics'
import { startPackageCheckoutAction } from '@/server/actions/portal'
import type { MemberBuyableProduct } from '@/server/member-api'

// What she sees, and the one thing it must never get wrong: THE PRICE SHE WILL BE CHARGED.
//
// Paying here is paying by card, so the headline is the card total and the cash price is named
// underneath as the explanation. The studio's wall says 4.200 and this says 4.620 — she should learn
// why here, in one line, rather than find out at the bank.

const CATEGORY_LABEL: Record<string, string> = {
  pilates_group: 'Pilates',
  fitness: 'Fitness',
  private: 'Özel ders',
}
const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR')} ₺`

export function BuyScreen({ items }: { items: readonly MemberBuyableProduct[] }) {
  const [busy, setBusy] = useState<string | null>(null)

  async function buy(item: MemberBuyableProduct) {
    setBusy(item.id)
    try {
      const res = await startPackageCheckoutAction({ productId: item.id })
      if (res.ok && 'redirectUrl' in res.value && res.value.redirectUrl) {
        track('payment_started', { method: 'package_purchase', amount_kurus: item.totalKurus })
        // A full navigation, not a new tab: the payment page owns the screen until it returns, and a
        // popup here is a popup a phone browser eats.
        window.location.href = res.value.redirectUrl as string
        return
      }
      toast.error('Ödeme başlatılamadı. Lütfen tekrar deneyin ya da stüdyoyla iletişime geçin.')
    } catch {
      toast.error('Ödeme başlatılamadı.')
    }
    setBusy(null)
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div>
        <h1 className="text-h1 font-semibold">Paket Al / Yenile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kartınızla ödeyin, paketiniz ödeme onaylanır onaylanmaz tanımlansın.
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Şu anda online alınabilen bir paket yok. Stüdyoyla iletişime geçebilirsiniz.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card className="gap-2">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-h3">
                    <span className="min-w-0 truncate">{item.name}</span>
                    <Badge className="bg-muted text-muted-foreground">
                      {CATEGORY_LABEL[item.category] ?? item.category}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-h1 font-semibold tabular-nums text-foreground">{tl(item.totalKurus)}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.durationDays > 0 ? `${item.durationDays} gün geçerli` : 'Süresiz'}
                      {item.totalKurus !== item.cashKurus
                        ? ` · kart ile · stüdyoda nakit ${tl(item.cashKurus)}`
                        : ''}
                    </p>
                  </div>
                  <Button className="min-h-11" disabled={busy !== null} onClick={() => void buy(item)}>
                    {busy === item.id ? <Loader2Icon className="animate-spin" /> : null} Satın al
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Tek fiyat (owner, 2026-08-06): nakit, havale ve kart aynı tutar. Taksitin vade farkını
          banka/ödeme altyapısı belirler — stüdyo bir oran söylemez, çünkü bir oran koymuyor. */}
      <p className="px-2 text-center text-xs text-muted-foreground">
        Fiyatlar nakit, havale ve kredi kartında aynıdır. Kredi kartına taksit yapabilirsiniz; taksit
        seçeneğine göre vade farkı oluşabilir, net tutarı ödeme ekranında görürsünüz. Ödeme, lisanslı
        ödeme kuruluşu üzerinden alınır.
      </p>
    </main>
  )
}
