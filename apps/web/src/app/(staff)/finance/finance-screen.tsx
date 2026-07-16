'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangleIcon, LockIcon, LockOpenIcon, Loader2Icon } from 'lucide-react'
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
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { formatDateTime } from '@/lib/datetime'
import { domainErrorMessage } from '@/lib/domain-error'
import { closeDrawerAction, listDrawersAction, openDrawerAction } from '@/server/actions/finance'

// GÜN SONU. The discrepancy is a RECORDED FACT — a day-end that quietly makes the numbers agree is
// not a control, it is a cover-up, and the owner is precisely the person that control exists for.
// The domain refuses to close a drawer with a difference and no explanation; this screen simply
// tells the truth about that.

type Drawer = Awaited<ReturnType<typeof listDrawersAction>>[number]
const tl = (k: number) => `${(k / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₺`

export function FinanceScreen({ isOwner }: { isOwner: boolean }) {
  const [drawers, setDrawers] = useState<readonly Drawer[] | null>(null)
  const [opening, setOpening] = useState<Drawer | null>(null)
  const [closing, setClosing] = useState<Drawer | null>(null)

  const load = useCallback(async () => {
    try {
      setDrawers(await listDrawersAction())
    } catch {
      // Without this the kasa sits on "Yükleniyor…" forever and reception has no idea why the till
      // will not open (Alpha Review).
      toast.error('Kasa okunamadı. Sayfayı yenileyin.')
      setDrawers([])
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Kasa" description="Kasa açılış / kapanış ve gün sonu sayımı" />

      <Section title="Kasalar">
        {drawers === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
          </p>
        ) : drawers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tanımlı kasa yok. Kasalar şube bazlıdır ve stüdyo kurulumunda tanımlanır.
          </p>
        ) : (
          <ul className="space-y-3">
            {drawers.map((d) => (
              <li key={d.id} className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    {d.name}
                    <Badge className="bg-muted text-muted-foreground">{d.kind === 'cash' ? 'Nakit' : 'POS'}</Badge>
                    <Badge
                      className={d.status === 'open' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}
                    >
                      {d.status === 'open' ? 'Açık' : 'Kapalı'}
                    </Badge>
                    {d.active ? null : <Badge className="bg-muted text-muted-foreground">Arşivli</Badge>}
                  </p>
                  {d.status === 'open' ? (
                    <Button size="sm" variant="outline" onClick={() => setClosing(d)}>
                      <LockIcon />
                      Gün Sonu
                    </Button>
                  ) : d.active ? (
                    <Button size="sm" onClick={() => setOpening(d)}>
                      <LockOpenIcon />
                      Kasayı Aç
                    </Button>
                  ) : null}
                </div>

                {d.status === 'open' ? (
                  <p className="text-sm tabular-nums text-muted-foreground">
                    Açılış {tl(d.openingFloat)} · beklenen{' '}
                    <span className="font-medium text-foreground">{tl(d.expected)}</span>
                    {d.openedAt ? ` · ${formatDateTime(d.openedAt)}` : ''}
                  </p>
                ) : d.closedAt ? (
                  <p className="text-sm tabular-nums text-muted-foreground">
                    Son kapanış {formatDateTime(d.closedAt)} · sayılan {tl(d.counted ?? 0)}
                    {d.discrepancy !== null && d.discrepancy !== 0 ? (
                      <span className="ml-1 text-danger">
                        · fark {d.discrepancy > 0 ? '+' : ''}
                        {tl(d.discrepancy)}
                      </span>
                    ) : (
                      <span className="ml-1 text-success">· fark yok</span>
                    )}
                  </p>
                ) : null}

                {d.closeNote ? (
                  <p className="flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    {d.closeNote}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Open */}
      <AmountDialog
        open={opening !== null}
        title="Kasayı aç"
        description="Kasada mevcut olan açılış bakiyesini girin."
        label="Açılış bakiyesi (₺)"
        confirmLabel="Aç"
        requireNote={false}
        onClose={() => setOpening(null)}
        onConfirm={async (amountKurus) => {
          const res = await openDrawerAction({ drawerId: opening!.id, openingFloatKurus: amountKurus })
          if (res.ok) {
            toast.success('Kasa açıldı.')
            setOpening(null)
            void load()
          } else {
            toast.error(domainErrorMessage(res.error))
          }
        }}
      />

      {/* Day-end */}
      <AmountDialog
        open={closing !== null}
        title="Gün sonu"
        description={`Beklenen tutar ${closing ? tl(closing.expected) : ''}. Kasada SAYDIĞINIZ tutarı girin — fark varsa kaydedilir, gizlenmez.`}
        label="Sayılan tutar (₺)"
        confirmLabel="Kasayı Kapat"
        requireNote
        expected={closing?.expected ?? 0}
        onClose={() => setClosing(null)}
        onConfirm={async (countedKurus, note) => {
          const res = await closeDrawerAction({
            drawerId: closing!.id,
            countedKurus,
            note: note?.trim() ? note.trim() : null,
          })
          if (res.ok) {
            toast.success(
              res.value.discrepancy === 0
                ? 'Kasa kapatıldı. Fark yok.'
                : `Kasa kapatıldı. Fark: ${tl(res.value.discrepancy)} — kayda geçti.`,
            )
            setClosing(null)
            void load()
          } else {
            toast.error(domainErrorMessage(res.error))
          }
        }}
      />

      {!isOwner ? null : (
        <p className="text-xs text-muted-foreground">
          Kasa farkları Denetim Kaydı’nda ayrı bir hareket olarak görünür.
        </p>
      )}
    </main>
  )
}

function AmountDialog({
  open,
  title,
  description,
  label,
  confirmLabel,
  requireNote,
  expected = 0,
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  label: string
  confirmLabel: string
  requireNote: boolean
  expected?: number
  onClose: () => void
  onConfirm: (amountKurus: number, note?: string) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setAmount('')
      setNote('')
    }
  }, [open])

  const kurus = Math.round(Number(amount.replace(',', '.')) * 100)
  const diff = Number.isFinite(kurus) ? kurus - expected : 0
  // A difference demands an explanation — the domain refuses without one, so the button does too.
  const needsNote = requireNote && diff !== 0 && amount !== ''

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Input
          type="text"
          inputMode="decimal"
          placeholder={label}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />

        {needsNote ? (
          <>
            <p className={`text-sm font-medium ${diff > 0 ? 'text-info' : 'text-danger'}`}>
              {diff > 0 ? 'Kasa fazlası' : 'Kasa açığı'}: {tl(Math.abs(diff))}
            </p>
            <Input
              placeholder="Fark açıklaması (zorunlu)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            disabled={busy || amount === '' || !Number.isFinite(kurus) || (needsNote && note.trim() === '')}
            onClick={async () => {
              setBusy(true)
              await onConfirm(kurus, note)
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
