'use client'

import { useEffect, useState } from 'react'
import { ArrowRightLeftIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

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
import { dayHeading, timeLabel } from '@/components/calendar'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  listMoveTargetsAction,
  moveReservationAction,
  type MoveTarget,
} from '@/server/actions/reservations'

// D19 — move a member to another class. Not a cancellation and not a new booking: the same
// credit, still held, pointed at a different session. Inside the free-move window it is one
// click; past it, reception must write down why — and that reason lands in the event.
export function MoveReservationDialog({
  open,
  reservationId,
  memberName,
  fromStartsAt,
  cancellationWindowHours,
  onClose,
  onMoved,
}: {
  open: boolean
  reservationId: string | null
  memberName: string
  fromStartsAt: number
  cancellationWindowHours: number
  onClose: () => void
  onMoved: () => void
}) {
  const [targets, setTargets] = useState<readonly MoveTarget[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !reservationId) return
    setTargets(null)
    setPicked(null)
    setReason('')
    void listMoveTargetsAction({ reservationId, nowMs: Date.now() })
      .then(setTargets)
      .catch(() => setTargets([]))
  }, [open, reservationId])

  // The free-move window IS the free-cancellation window (Doc 22 §3).
  const hoursUntil = (fromStartsAt - Date.now()) / 3_600_000
  const late = hoursUntil < cancellationWindowHours

  async function move() {
    if (!reservationId || !picked) return
    setBusy(true)
    try {
      const res = await moveReservationAction({
        reservationId,
        targetSessionId: picked,
        overrideReason: late ? reason.trim() : null,
      })
      if (res.ok) {
        toast.success('Rezervasyon taşındı. Kredi aynı pakette, hâlâ ayrılmış durumda.')
        onMoved()
        onClose()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Taşıma tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[85vh] gap-3 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rezervasyonu taşı</DialogTitle>
          <DialogDescription>
            {memberName} başka bir seansa taşınır. Kredi tüketilmez, iptal olarak sayılmaz.
          </DialogDescription>
        </DialogHeader>

        {late ? (
          <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
            <p className="text-sm font-medium text-warning">
              Ücretsiz değiştirme süresi doldu ({cancellationWindowHours} saat).
            </p>
            <p className="text-sm text-muted-foreground">
              Yine de taşıyabilirsiniz — gerekçe kayda geçer.
            </p>
            <Input
              placeholder="Gerekçe (zorunlu)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : null}

        {targets === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Uygun seanslar aranıyor…
          </p>
        ) : targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Önümüzdeki 4 haftada aynı dersten uygun (boş kontenjanlı) bir seans yok.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {targets.map((t) => (
              <li key={t.sessionId}>
                <button
                  type="button"
                  onClick={() => setPicked(t.sessionId)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    picked === t.sessionId ? 'bg-primary-soft' : 'hover:bg-primary-soft/40'
                  }`}
                >
                  <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                    {timeLabel(t.startsAt)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{t.serviceName}</span>
                    <span className="block truncate text-xs capitalize text-muted-foreground">
                      {dayHeading(new Date(t.startsAt + 180 * 60_000).toISOString().slice(0, 10))}
                      {t.trainerName ? ` · ${t.trainerName}` : ''}
                      {t.roomName ? ` · ${t.roomName}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {t.bookedCount}/{t.capacity}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={move} disabled={busy || !picked || (late && reason.trim().length === 0)}>
            {busy ? <Loader2Icon className="animate-spin" /> : <ArrowRightLeftIcon />}
            Taşı
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
