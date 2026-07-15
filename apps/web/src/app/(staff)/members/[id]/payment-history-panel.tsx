'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  listMemberPaymentIntentsAction,
  refundPaymentIntentAction,
  type PaymentIntentRow,
} from '@/server/actions/payments'

const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR')} ₺`
const dt = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const STATUS: Record<string, { label: string; cls: string }> = {
  paid: { label: 'Ödendi', cls: 'bg-success/10 text-success' },
  awaiting_payment: { label: 'Bekliyor', cls: 'bg-muted text-muted-foreground' },
  processing: { label: 'İşleniyor', cls: 'bg-muted text-muted-foreground' },
  failed: { label: 'Başarısız', cls: 'bg-danger/10 text-danger' },
  expired: { label: 'Süresi doldu', cls: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'İptal', cls: 'bg-muted text-muted-foreground' },
  refunded: { label: 'İade edildi', cls: 'bg-info/10 text-info' },
  partially_refunded: { label: 'Kısmi iade', cls: 'bg-info/10 text-info' },
  refund_pending: { label: 'İade bekliyor', cls: 'bg-warning/10 text-warning' },
  manual_review: { label: 'İnceleme gerekli', cls: 'bg-warning/10 text-warning' },
}

export function PaymentHistoryPanel({ memberId, isOwner }: { memberId: string; isOwner: boolean }) {
  const [rows, setRows] = useState<readonly PaymentIntentRow[] | null>(null)
  const [refunding, setRefunding] = useState<PaymentIntentRow | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await listMemberPaymentIntentsAction({ memberId }))
    } catch {
      setRows([])
    }
  }, [memberId])

  useEffect(() => {
    void load()
  }, [load])

  if (rows === null) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Yükleniyor…</p>
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Online ödeme kaydı yok.</p>

  return (
    <>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        {rows.map((r) => {
          const s = STATUS[r.status] ?? { label: r.status, cls: 'bg-muted text-muted-foreground' }
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium tabular-nums text-foreground">
                  {tl(r.amountKurus)} <span className="text-xs font-normal text-muted-foreground">· {r.provider.toUpperCase()} · {r.flow === 'link' ? 'Link' : 'POS'}</span>
                </p>
                <p className="text-xs text-muted-foreground">{dt(r.createdAt)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={s.cls}>{s.label}</Badge>
                {isOwner && (r.status === 'paid' || r.status === 'partially_refunded') ? (
                  <Button variant="ghost" size="sm" onClick={() => setRefunding(r)}>
                    İade
                  </Button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
      {refunding ? <RefundDialog row={refunding} onClose={() => setRefunding(null)} onDone={() => { setRefunding(null); void load() }} /> : null}
    </>
  )
}

function RefundDialog({ row, onClose, onDone }: { row: PaymentIntentRow; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(row.amountKurus / 100))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const res = await refundPaymentIntentAction({ intentId: row.id, amountKurus: Math.round(Number(amount) * 100), reason: reason.trim() })
      if (res.ok) {
        toast.success('İade işleme alındı.')
        onDone()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>İade</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            Tutar (TL)
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <Textarea placeholder="Sebep (zorunlu)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button variant="destructive" disabled={busy || reason.trim().length === 0} onClick={() => void submit()}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} İade Et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
