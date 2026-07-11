'use client'

import { useState } from 'react'
import { CheckIcon, Loader2Icon, PencilIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { AttendanceOutcome } from '@studio/core'

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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import { correctReservationAction } from '@/server/actions/reservations'
import type { RosterEntry, SessionView } from '@/server/reservations-query'

import type { Marks } from './types'

const OUTCOME_LABEL: Record<AttendanceOutcome, string> = {
  attended: 'Katıldı',
  no_show: 'Gelmedi',
}

function resolvedBadge(status: RosterEntry['status'], source: RosterEntry['attendanceSource']) {
  const auto = source === 'system_default' ? ' (oto)' : ''
  if (status === 'attended') return { label: `Katıldı${auto}`, className: 'bg-success/10 text-success' }
  if (status === 'no_show') return { label: `Gelmedi${auto}`, className: 'bg-danger/10 text-danger' }
  return { label: status, className: 'bg-muted text-muted-foreground' }
}

export function RosterSheet({
  session,
  marks,
  bulkBusy,
  onClose,
  onMark,
  onBulk,
  onCorrected,
  timeLabel,
}: {
  session: SessionView | null
  marks: Marks
  bulkBusy: boolean
  onClose: () => void
  onMark: (reservationId: string, outcome: AttendanceOutcome) => void
  onBulk: (session: SessionView) => void
  onCorrected: (reservationId: string) => void
  timeLabel: (ms: number) => string
}) {
  const [correcting, setCorrecting] = useState<RosterEntry | null>(null)
  const [corrOutcome, setCorrOutcome] = useState<AttendanceOutcome>('no_show')
  const [corrReason, setCorrReason] = useState('')
  const [corrBusy, setCorrBusy] = useState(false)

  function openCorrection(entry: RosterEntry) {
    // Default the target to the opposite of the current outcome — the likely intent.
    setCorrOutcome(entry.status === 'attended' ? 'no_show' : 'attended')
    setCorrReason('')
    setCorrecting(entry)
  }

  async function submitCorrection() {
    if (!correcting) return
    setCorrBusy(true)
    try {
      const res = await correctReservationAction({
        reservationId: correcting.reservationId,
        toOutcome: corrOutcome,
        reason: corrReason.trim(),
      })
      if (res.ok) {
        onCorrected(correcting.reservationId)
        toast.success('Düzeltme kaydedildi.')
        setCorrecting(null)
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Düzeltme kaydedilemedi. Lütfen tekrar deneyin.')
    }
    setCorrBusy(false)
  }

  const pending = session
    ? session.roster.filter((e) => (marks[e.reservationId] ?? e.status) === 'booked')
    : []

  return (
    <>
      <Sheet open={session !== null} onOpenChange={(o) => (o ? null : onClose())}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
          {session ? (
            <>
              <SheetHeader className="border-b border-border p-4">
                <SheetTitle className="flex items-center gap-2">
                  <span className="tabular-nums">{timeLabel(session.startsAt)}</span>
                  {session.serviceName}
                </SheetTitle>
                <SheetDescription>
                  {session.trainerName ?? 'Eğitmen yok'} · {session.roster.length}/{session.capacity} kişi
                  {session.roomName ? ` · ${session.roomName}` : ''}
                </SheetDescription>
                {pending.length > 0 ? (
                  <Button
                    className="mt-2 min-h-11 w-full"
                    disabled={bulkBusy}
                    onClick={() => onBulk(session)}
                  >
                    {bulkBusy ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
                    Kalan {pending.length} kişiyi katıldı işaretle
                  </Button>
                ) : null}
              </SheetHeader>

              {session.roster.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Bu seansta rezervasyon yok.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {session.roster.map((entry) => {
                    const optimistic = marks[entry.reservationId]
                    const serverResolved = entry.status === 'attended' || entry.status === 'no_show'
                    return (
                      <li key={entry.reservationId} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{entry.memberName}</p>
                          <p className="text-xs text-muted-foreground">···{entry.phoneLast4}</p>
                        </div>

                        {entry.status === 'booked' && !optimistic ? (
                          // One tap = attended; the second action = no-show (UX-9).
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-11"
                              aria-label={`${entry.memberName} gelmedi`}
                              onClick={() => onMark(entry.reservationId, 'no_show')}
                            >
                              <XIcon />
                            </Button>
                            <Button
                              className="min-h-11 gap-1.5"
                              aria-label={`${entry.memberName} katıldı`}
                              onClick={() => onMark(entry.reservationId, 'attended')}
                            >
                              <CheckIcon />
                              Katıldı
                            </Button>
                          </div>
                        ) : !serverResolved && optimistic ? (
                          // Optimistically marked, the command not yet applied — show the
                          // outcome, but no correction until the server confirms it.
                          <div className="flex shrink-0 items-center gap-2">
                            {(() => {
                              const b = resolvedBadge(optimistic, null)
                              return <Badge className={b.className}>{b.label}</Badge>
                            })()}
                            <span className="text-xs text-muted-foreground">işleniyor…</span>
                          </div>
                        ) : (
                          // Server-resolved — correctable (a separate flow, mandatory reason).
                          <div className="flex shrink-0 items-center gap-2">
                            {(() => {
                              const b = resolvedBadge(entry.status, entry.attendanceSource)
                              return <Badge className={b.className}>{b.label}</Badge>
                            })()}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${entry.memberName} düzelt`}
                              onClick={() => openCorrection(entry)}
                            >
                              <PencilIcon />
                            </Button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Correction is always a separate flow with a mandatory reason (UX-9, AD-22). */}
      <Dialog open={correcting !== null} onOpenChange={(o) => (o ? null : setCorrecting(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yoklamayı düzelt</DialogTitle>
            <DialogDescription>
              {correcting?.memberName} için sonucu değiştir. Bu işlem kayda geçer ve krediyi etkileyebilir.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            {(['attended', 'no_show'] as const).map((o) => (
              <Button
                key={o}
                variant={corrOutcome === o ? 'default' : 'outline'}
                className="min-h-11"
                onClick={() => setCorrOutcome(o)}
              >
                {OUTCOME_LABEL[o]}
              </Button>
            ))}
          </div>

          <Textarea
            placeholder="Sebep (zorunlu)"
            value={corrReason}
            onChange={(e) => setCorrReason(e.target.value)}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrecting(null)} disabled={corrBusy}>
              Vazgeç
            </Button>
            <Button onClick={submitCorrection} disabled={corrBusy || corrReason.trim().length === 0}>
              {corrBusy ? <Loader2Icon className="animate-spin" /> : null}
              Düzeltmeyi Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
