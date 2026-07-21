'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowDownCircleIcon, ArrowUpCircleIcon, WalletIcon } from 'lucide-react'
import { toast } from 'sonner'

import { formatKurus, type StoredWallet } from '@studio/core/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { domainErrorMessage } from '@/lib/domain-error'
import { PaytrCheckoutDialog, type PaytrCheckout } from '@/components/paytr-checkout'
import { createWalletTopupPaymentAction } from '@/server/actions/payments'
import { adjustMemberWalletAction, getMemberWalletAction, topUpMemberWalletAction } from '@/server/actions/wallet'

const SOURCES: { id: 'cash' | 'bank_transfer' | 'manual'; label: string }[] = [
  { id: 'cash', label: 'Nakit' },
  { id: 'bank_transfer', label: 'Havale' },
  { id: 'manual', label: 'Fiziksel POS' },
]
const REASONS: { id: 'gift' | 'correction' | 'migration' | 'support'; label: string }[] = [
  { id: 'gift', label: 'Hediye' },
  { id: 'correction', label: 'Düzeltme' },
  { id: 'migration', label: 'Devir' },
  { id: 'support', label: 'Destek' },
]
const dt = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'medium', timeStyle: 'short' })

export function WalletPanel({ memberId, memberPhone = null }: { memberId: string; memberPhone?: string | null }) {
  const [wallet, setWallet] = useState<StoredWallet | null>(null)
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState<'cash' | 'bank_transfer' | 'manual'>('cash')
  const [checkout, setCheckout] = useState<PaytrCheckout | null>(null)
  const [busy, setBusy] = useState(false)
  const [showAdjust, setShowAdjust] = useState(false)
  const [adjAmount, setAdjAmount] = useState('')
  const [adjDir, setAdjDir] = useState<'credit' | 'debit'>('credit')
  const [adjReason, setAdjReason] = useState<'gift' | 'correction' | 'migration' | 'support'>('gift')
  const [adjNote, setAdjNote] = useState('')

  const load = useCallback(() => {
    void getMemberWalletAction({ memberId }).then(setWallet).catch(() => setWallet({ balance: 0, history: [] }))
  }, [memberId])
  useEffect(load, [load])

  const kurusOf = (s: string): number => Math.round(parseFloat(s.replace(',', '.')) * 100)

  async function topUp() {
    const k = kurusOf(amount)
    if (!Number.isFinite(k) || k <= 0) {
      toast.error('Geçerli bir tutar gir.')
      return
    }
    setBusy(true)
    try {
      const res = await topUpMemberWalletAction({ memberId, amountKurus: k, source })
      if (res.ok) {
        setWallet(res.value)
        setAmount('')
        toast.success(`Cüzdana ${formatKurus(k)} yüklendi.`)
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Yükleme yapılamadı.')
    } finally {
      setBusy(false)
    }
  }

  // Load the wallet by PAYTR — Sanal POS (embedded form) or Link (shared). On the verified callback the
  // money credits her balance (source 'online'); the dialog polls and refreshes.
  async function paytrTopUp(flow: 'pos' | 'link') {
    const k = kurusOf(amount)
    if (!Number.isFinite(k) || k <= 0) {
      toast.error('Geçerli bir tutar gir.')
      return
    }
    setBusy(true)
    try {
      const res = await createWalletTopupPaymentAction({ memberId, amountKurus: k, flow })
      if (res.ok) {
        setCheckout({ flow, redirectUrl: res.value.redirectUrl, intentId: res.value.intentId })
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem başlatılamadı.')
    } finally {
      setBusy(false)
    }
  }

  async function adjust() {
    const k = kurusOf(adjAmount)
    if (!Number.isFinite(k) || k <= 0) {
      toast.error('Geçerli bir tutar gir.')
      return
    }
    if (!adjNote.trim()) {
      toast.error('Düzeltme için not zorunlu.')
      return
    }
    setBusy(true)
    try {
      const res = await adjustMemberWalletAction({ memberId, direction: adjDir, amountKurus: k, reason: adjReason, note: adjNote.trim() })
      if (res.ok) {
        setWallet(res.value)
        setAdjAmount('')
        setAdjNote('')
        setShowAdjust(false)
        toast.success('Cüzdan düzeltildi.')
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Düzeltme yapılamadı.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Section title="Cüzdan Bakiyesi" hint="Ön ödemeli bakiye — üye mağazadan bununla alışveriş yapar.">
        <div className="flex items-center gap-3 rounded-xl border bg-gradient-to-br from-accent/10 to-transparent p-5">
          <WalletIcon className="size-8 text-accent" />
          <div>
            <div className="text-h1 font-semibold tabular-nums">{formatKurus(wallet?.balance ?? 0)}</div>
            <div className="text-sm text-muted-foreground">Güncel bakiye</div>
          </div>
        </div>
      </Section>

      <Section title="Bakiye Yükle" hint="Nakit tahsilat kasaya işlenir; havale/fiziksel POS yalnızca bakiyeye yazılır. Sanal POS / Link ile de yükleyebilirsiniz.">
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-32">
              <Input inputMode="decimal" placeholder="Tutar (TL)" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex gap-1">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSource(s.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${source === s.id ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <Button onClick={() => void topUp()} disabled={busy}>Yükle</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void paytrTopUp('pos')} disabled={busy}>Sanal POS ile Yükle</Button>
            <Button variant="outline" size="sm" onClick={() => void paytrTopUp('link')} disabled={busy}>Link ile Yükle</Button>
          </div>
        </div>
      </Section>

      <Section title="Hareketler">
        {wallet && wallet.history.length > 0 ? (
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
          <p className="text-sm text-muted-foreground">Henüz hareket yok.</p>
        )}
      </Section>

      <div>
        <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setShowAdjust((v) => !v)}>
          {showAdjust ? 'Düzeltmeyi gizle' : 'Bakiye düzeltmesi (hediye / düzeltme)'}
        </button>
        {showAdjust ? (
          <div className="mt-3 space-y-2 rounded-xl border p-4">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex gap-1">
                <button type="button" onClick={() => setAdjDir('credit')} className={`rounded-full px-3 py-1.5 text-sm font-medium ${adjDir === 'credit' ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'}`}>Ekle</button>
                <button type="button" onClick={() => setAdjDir('debit')} className={`rounded-full px-3 py-1.5 text-sm font-medium ${adjDir === 'debit' ? 'bg-destructive text-white' : 'bg-muted text-muted-foreground'}`}>Düş</button>
              </div>
              <div className="w-28"><Input inputMode="decimal" placeholder="Tutar (TL)" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} /></div>
              <select value={adjReason} onChange={(e) => setAdjReason(e.target.value as typeof adjReason)} className="rounded-md border bg-background px-2 py-2 text-sm">
                {REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
            <Input placeholder="Not (zorunlu)" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} />
            <Button variant="outline" onClick={() => void adjust()} disabled={busy}>Düzeltmeyi Uygula</Button>
          </div>
        ) : null}
      </div>

      <PaytrCheckoutDialog
        checkout={checkout}
        memberId={memberId}
        memberPhone={memberPhone}
        title="Cüzdana Yükle"
        onPaid={() => {
          setAmount('')
          load()
        }}
        onClose={() => {
          setCheckout(null)
          load()
        }}
      />
    </div>
  )
}
