'use client'

import { useState } from 'react'
import { ArrowDownCircleIcon, ArrowUpCircleIcon, ShoppingBagIcon, WalletIcon } from 'lucide-react'
import { toast } from 'sonner'

import { formatKurus, type RetailItem, type StoredWallet } from '@studio/core/client'
import { Button } from '@/components/ui/button'
import { track } from '@/lib/analytics'
import { portalBuyFromWalletAction, portalWalletTopupAction } from '@/server/actions/wallet'

const TOPUPS = [10000, 25000, 50000] // 100 / 250 / 500 ₺
const dt = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'medium', timeStyle: 'short' })

export function PortalWalletScreen({ wallet: initial, store }: { wallet: StoredWallet; store: RetailItem[] }) {
  const [wallet, setWallet] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)

  async function topup(amountKurus: number) {
    setBusy(`top-${amountKurus}`)
    try {
      const res = await portalWalletTopupAction({ amountKurus })
      if (res.ok) {
        track('wallet_topup', { amount_kurus: amountKurus })
        track('payment_started', { method: 'wallet_topup', amount_kurus: amountKurus })
        window.location.assign(res.value.redirectUrl)
      } else toast.error('Yükleme başlatılamadı.')
    } catch {
      toast.error('Yükleme başlatılamadı.')
    } finally {
      setBusy(null)
    }
  }

  async function buy(item: RetailItem) {
    if (wallet.balance < item.priceInKurus) {
      toast.error('Bakiyen yetersiz. Önce yükleme yap.')
      return
    }
    setBusy(`buy-${item.id}`)
    try {
      const res = await portalBuyFromWalletAction({ productId: item.id, quantity: 1 })
      if (res.ok) {
        setWallet(res.value)
        track('wallet_purchase', { product_id: item.id })
        toast.success(`${item.name} alındı.`)
      } else {
        const code = (res.error as { code?: string })?.code
        toast.error(code === 'retail_out_of_stock' ? 'Ürün tükenmiş.' : code === 'wallet_insufficient' ? 'Bakiyen yetersiz.' : 'İşlem tamamlanamadı.')
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div className="rounded-2xl bg-gradient-to-br from-accent to-accent/70 p-6 text-accent-foreground shadow-sm">
        <div className="flex items-center gap-2 text-sm opacity-90"><WalletIcon className="size-4" /> Cüzdan Bakiyen</div>
        <div className="mt-1 text-4xl font-semibold tabular-nums">{formatKurus(wallet.balance)}</div>
        <div className="mt-4 flex gap-2">
          {TOPUPS.map((a) => (
            <button
              key={a}
              type="button"
              disabled={busy === `top-${a}`}
              onClick={() => void topup(a)}
              className="flex-1 rounded-lg border border-white/30 bg-white/15 py-2 text-sm font-semibold backdrop-blur transition-colors hover:bg-white/25 disabled:opacity-50"
            >
              +{(a / 100).toLocaleString('tr-TR')} ₺
            </button>
          ))}
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Mağaza</h2>
        {store.length > 0 ? (
          <ul className="space-y-2">
            {store.map((item) => (
              <li key={item.id} className="flex items-center gap-3 rounded-xl border p-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-accent/10 text-accent"><ShoppingBagIcon className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.name}</div>
                  <div className="text-sm text-muted-foreground">{formatKurus(item.priceInKurus)}{item.stock !== null && item.stock <= 5 ? ` · son ${item.stock}` : ''}</div>
                </div>
                <Button size="sm" disabled={busy === `buy-${item.id}` || wallet.balance < item.priceInKurus} onClick={() => void buy(item)}>Al</Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Şu an satışta ürün yok.</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Hareketler</h2>
        {wallet.history.length > 0 ? (
          <ul className="divide-y rounded-xl border">
            {wallet.history.map((h) => {
              const isIn = h.direction === 'in'
              return (
                <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                  {isIn ? <ArrowDownCircleIcon className="size-5 text-emerald-600" /> : <ArrowUpCircleIcon className="size-5 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{h.label}</div>
                    <div className="text-xs text-muted-foreground">{dt(h.at)}</div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className={`text-sm font-semibold ${isIn ? 'text-emerald-600' : ''}`}>{isIn ? '+' : '−'}{formatKurus(h.amount)}</div>
                    <div className="text-xs text-muted-foreground">{formatKurus(h.balanceAfter)}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Henüz hareket yok. Cüzdanına para yükleyerek başla.</p>
        )}
      </section>
    </div>
  )
}
