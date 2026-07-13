'use client'

import { useCallback, useEffect, useState } from 'react'
import { BanIcon, CoinsIcon, Loader2Icon, PlusIcon, Undo2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDateTime } from '@/lib/datetime'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  collectAction,
  listDrawersAction,
  memberAccountAction,
  refundAction,
  cancelSaleAction,
  voidPaymentAction,
} from '@/server/actions/finance'

// ── CARİ HESAP (v1.24). ─────────────────────────────────────────────────────────────────────
//
// Every number here is DERIVED from the movements — sales, payments, allocations, refunds. Nothing
// is a stored balance that someone once incremented, which is why it cannot quietly be wrong: only
// a movement can be wrong, and every movement is an event with an actor and a reason.
//
// Partial payment is not a feature on this screen; it is what the model does. Reception types an
// amount, and it settles the oldest debt first.

type Account = Awaited<ReturnType<typeof memberAccountAction>>
type Drawer = Awaited<ReturnType<typeof listDrawersAction>>[number]

const tl = (kurus: number) => `${(kurus / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₺`

const METHOD: Record<string, string> = {
  cash: 'Nakit',
  bank_transfer: 'Havale / EFT',
  credit_card: 'Kredi kartı',
  pos: 'POS',
  online: 'Online',
  gift_card: 'Hediye kartı',
}

const STATUS: Record<string, { label: string; className: string }> = {
  open: { label: 'Açık', className: 'bg-warning/10 text-warning' },
  settled: { label: 'Tahsil edildi', className: 'bg-success/10 text-success' },
  cancelled: { label: 'İptal', className: 'bg-muted text-muted-foreground' },
}

export function AccountPanel({
  memberId,
  branchId,
  isOwner,
}: {
  memberId: string
  branchId: string
  isOwner: boolean
}) {
  const [account, setAccount] = useState<Account | null>(null)
  const [drawers, setDrawers] = useState<readonly Drawer[]>([])
  const [collecting, setCollecting] = useState(false)
  const [cancelling, setCancelling] = useState<{ id: string; lines: readonly string[] } | null>(null)
  const [voiding, setVoiding] = useState<{ id: string; amount: number } | null>(null)
  const [refunding, setRefunding] = useState<{ id: string; amount: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const [a, d] = await Promise.all([memberAccountAction({ memberId }), listDrawersAction()])
      setAccount(a)
      setDrawers(d)
    } catch {
      toast.error('Cari hesap okunamadı. Sayfayı yenileyin.')
    }
  }, [memberId])

  useEffect(() => {
    void load()
  }, [load])

  if (account === null) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" /> Cari hesap yükleniyor…
      </p>
    )
  }

  const owes = account.balanceKurus > 0

  return (
    <section className="space-y-5">
      {/* The three numbers the owner asked for, and they are three different questions. */}
      <div className="grid grid-cols-3 gap-3">
        <Figure label="Toplam satış" value={tl(account.totalSoldKurus)} />
        <Figure label="Toplam tahsilat" value={tl(account.totalPaidKurus)} tone="success" />
        <Figure
          label={owes ? 'Açık bakiye' : 'Alacaklı'}
          value={tl(Math.abs(account.balanceKurus))}
          tone={owes ? 'danger' : 'default'}
        />
      </div>

      {account.unallocatedKurus > 0 ? (
        <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-sm text-info">
          Üyenin {tl(account.unallocatedKurus)} tutarında mahsup edilmemiş ödemesi var — yeni satışta
          otomatik kullanılabilir.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setCollecting(true)}>
          <PlusIcon />
          Tahsilat Al
        </Button>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Satışlar</h3>
        {account.sales.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz satış yok.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {account.sales.map((s) => (
              <li key={s.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-foreground">
                    {s.lines.join(', ')}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge className={STATUS[s.status]?.className ?? ''}>{STATUS[s.status]?.label}</Badge>
                    {/* A sale is never deleted; it is CANCELLED, with a reason, as a compensating
                        event (#9). The action existed and no screen called it, so a sale entered in
                        error could not be undone by anybody (Alpha Review). Owner only. */}
                    {isOwner && s.status !== 'cancelled' ? (
                      <Button variant="ghost" size="sm" onClick={() => setCancelling(s)}>
                        İptal
                      </Button>
                    ) : null}
                  </div>
                </div>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {formatDateTime(s.soldAt)} · {tl(s.total)}
                  {s.discountTotal > 0 ? ` (${tl(s.discountTotal)} indirim)` : ''} · ödenen {tl(s.paid)}
                  {s.total - s.paid > 0 && s.status !== 'cancelled' ? (
                    <span className="text-danger"> · kalan {tl(s.total - s.paid)}</span>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Tahsilatlar</h3>
        {account.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz tahsilat yok.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {account.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p
                    className={`truncate text-sm font-medium ${p.voided ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                  >
                    {tl(p.amount)} · {METHOD[p.method] ?? p.method}
                  </p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(p.receivedAt)}
                    {p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
                {/* A payment is NEVER edited (I-31). The owner may void it — with a reason — or
                    refund it; both are movements of their own. */}
                {isOwner && !p.voided ? (
                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="İade"
                      onClick={() => setRefunding({ id: p.id, amount: p.amount })}
                    >
                      <Undo2Icon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="İptal (void)"
                      onClick={() => setVoiding({ id: p.id, amount: p.amount })}
                    >
                      <BanIcon />
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {account.plans.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Ödeme planları</h3>
          {account.plans.map((pl) => (
            <ul key={pl.id} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {pl.instalments.map((i) => (
                <li key={i.seq} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{i.seq}. taksit</span>
                  <span className="tabular-nums text-foreground">{tl(i.amount)}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(i.dueAt).slice(0, 10)}
                  </span>
                  <Badge className={i.status === 'paid' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}>
                    {i.status === 'paid' ? 'Ödendi' : 'Bekliyor'}
                  </Badge>
                </li>
              ))}
            </ul>
          ))}
        </div>
      ) : null}

      <CollectDialog
        open={collecting}
        memberId={memberId}
        branchId={branchId}
        drawers={drawers}
        suggested={Math.max(0, account.balanceKurus)}
        onClose={() => setCollecting(false)}
        onDone={() => {
          setCollecting(false)
          void load()
        }}
      />

      <ReasonDialog
        open={cancelling !== null}
        title="Satışı iptal et"
        description={`${cancelling ? cancelling.lines.join(', ') : ''} satışı iptal edilecek. Kayıt silinmez — iptal de bir harekettir. Paketin kredileri geri alınmaz; gerekirse paketi ayrıca iptal edin.`}
        confirmLabel="Satışı iptal et"
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          const res = await cancelSaleAction({ saleId: cancelling!.id, reason })
          if (res.ok) {
            toast.success('Satış iptal edildi.')
            setCancelling(null)
            void load()
          } else {
            toast.error(domainErrorMessage(res.error))
          }
        }}
      />

      <ReasonDialog
        open={voiding !== null}
        title="Tahsilatı iptal et (void)"
        description={`${voiding ? tl(voiding.amount) : ''} tutarındaki tahsilat iptal edilecek. Kayıt silinmez — iptal de bir harekettir.`}
        confirmLabel="İptal et"
        onClose={() => setVoiding(null)}
        onConfirm={async (reason) => {
          const res = await voidPaymentAction({ paymentId: voiding!.id, reason })
          if (res.ok) {
            toast.success('Tahsilat iptal edildi.')
            setVoiding(null)
            void load()
          } else {
            toast.error(domainErrorMessage(res.error))
          }
        }}
      />

      <ReasonDialog
        open={refunding !== null}
        title="İade"
        description={`${refunding ? tl(refunding.amount) : ''} tutarındaki tahsilat üyeye iade edilecek.`}
        confirmLabel="İade et"
        onClose={() => setRefunding(null)}
        onConfirm={async (reason) => {
          const res = await refundAction({
            paymentId: refunding!.id,
            amountKurus: refunding!.amount,
            reason,
          })
          if (res.ok) {
            toast.success('İade kaydedildi.')
            setRefunding(null)
            void load()
          } else {
            toast.error(domainErrorMessage(res.error))
          }
        }}
      />
    </section>
  )
}

function Figure({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'success' | 'danger'
}) {
  const cls = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-foreground'
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-h2 font-semibold tabular-nums ${cls}`}>{value}</p>
    </div>
  )
}

function CollectDialog({
  open,
  memberId,
  branchId,
  drawers,
  suggested,
  onClose,
  onDone,
}: {
  open: boolean
  memberId: string
  branchId: string
  drawers: readonly Drawer[]
  suggested: number
  onClose: () => void
  onDone: () => void
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setAmount(suggested > 0 ? String(suggested / 100) : '')
      const openDrawer = drawers.find((d) => d.status === 'open' && d.kind === 'cash')
      setDrawerId(openDrawer?.id ?? null)
      setNote('')
    }
  }, [open, suggested, drawers])

  const needsDrawer = method === 'cash' || method === 'pos'
  const openDrawers = drawers.filter((d) => d.status === 'open')

  async function submit() {
    setBusy(true)
    try {
      const res = await collectAction({
        memberId,
        branchId,
        amountKurus: Math.round(Number(amount.replace(',', '.')) * 100),
        method,
        drawerId: needsDrawer ? drawerId : null,
        note: note.trim() || null,
      })
      if (res.ok) {
        toast.success(
          res.value.unallocated > 0
            ? `Tahsilat alındı. ${tl(res.value.unallocated)} üyenin alacağı olarak duruyor.`
            : 'Tahsilat alındı ve borca mahsup edildi.',
        )
        onDone()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Tahsilat kaydedilemedi.')
    }
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tahsilat al</DialogTitle>
          <DialogDescription>
            Tutar en eski borçtan başlayarak mahsup edilir. Kısmi ödeme kabul edilir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            type="text"
            inputMode="decimal"
            placeholder="Tutar (₺)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
          <Select value={method} onValueChange={(v) => setMethod(v ?? 'cash')}>
            <SelectTrigger>
              <SelectValue>{(v: unknown) => METHOD[String(v)] ?? 'Yöntem'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(METHOD).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {needsDrawer ? (
            openDrawers.length === 0 ? (
              <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
                Açık kasa yok. Nakit/POS tahsilatı için önce Kasa ekranından kasayı açın.
              </p>
            ) : (
              <Select value={drawerId ?? ''} onValueChange={(v) => setDrawerId(v)}>
                <SelectTrigger>
                  <SelectValue>
                    {(v: unknown) => openDrawers.find((d) => d.id === v)?.name ?? 'Kasa seçin'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {openDrawers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          ) : null}

          <Input placeholder="Açıklama (opsiyonel)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={busy || !amount || (needsDrawer && !drawerId)}>
            {busy ? <Loader2Icon className="animate-spin" /> : <CoinsIcon />}
            Tahsil Et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// A discretionary money movement always carries a reason (I-36). The dialog cannot be confirmed
// without one — not as a validation nicety, but because the domain refuses.
function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Gerekçe (zorunlu)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={busy || reason.trim() === ''}
            onClick={async () => {
              setBusy(true)
              await onConfirm(reason.trim())
              setBusy(false)
            }}
          >
            {busy ? <Loader2Icon className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
