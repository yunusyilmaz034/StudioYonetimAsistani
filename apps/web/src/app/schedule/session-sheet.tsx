'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  cancelSessionAction,
  changeCapacityAction,
  changeRoomAction,
  changeTrainerAction,
} from '@/server/actions/scheduling'
import type { CalendarSession, PickOption, StaffOption } from '@/server/schedule-query'

import { dayHeading, STATUS_LABEL, timeLabel } from './types'

const NONE = '__none__'
type Action = 'trainer' | 'room' | 'capacity' | 'cancel'

export function SessionSheet({
  session,
  rooms,
  staff,
  onClose,
  onMutated,
}: {
  session: CalendarSession | null
  rooms: readonly PickOption[]
  staff: readonly StaffOption[]
  onClose: () => void
  onMutated: () => void
}) {
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [trainerId, setTrainerId] = useState<string>(NONE)
  const [roomId, setRoomId] = useState<string>(NONE)
  const [capacity, setCapacity] = useState<number>(1)
  const [busy, setBusy] = useState(false)

  const editable = session !== null && session.status === 'scheduled' && session.startsAt > Date.now()

  function open(a: Action) {
    if (!session) return
    setReason('')
    setTrainerId(session.trainerId ?? NONE)
    setRoomId(session.roomId ?? NONE)
    setCapacity(session.capacity)
    setAction(a)
  }

  async function submit() {
    if (!session || !action) return
    setBusy(true)
    try {
      const r = reason.trim()
      let res
      if (action === 'trainer') {
        const chosen = trainerId === NONE ? null : (staff.find((s) => s.id === trainerId) ?? null)
        res = await changeTrainerAction({
          sessionId: session.sessionId,
          trainerId: chosen ? chosen.id : null,
          trainerName: chosen ? chosen.name : null,
          reason: r,
        })
      } else if (action === 'room') {
        res = await changeRoomAction({ sessionId: session.sessionId, roomId: roomId === NONE ? null : roomId, reason: r })
      } else if (action === 'capacity') {
        res = await changeCapacityAction({ sessionId: session.sessionId, capacity, reason: r })
      } else {
        res = await cancelSessionAction({ sessionId: session.sessionId, reason: r })
      }
      if (res.ok) {
        toast.success('Kaydedildi.')
        setAction(null)
        onMutated()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı. Lütfen tekrar deneyin.')
    }
    setBusy(false)
  }

  return (
    <>
      <Sheet open={session !== null} onOpenChange={(o) => (o ? null : onClose())}>
        <SheetContent side="right" className="w-full gap-4 overflow-y-auto p-4 sm:max-w-md">
          {session ? (
            <>
              <SheetHeader className="p-0">
                <SheetTitle>{session.serviceName}</SheetTitle>
                <SheetDescription className="capitalize">
                  {dayHeading(new Date(session.startsAt).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }))} ·{' '}
                  {timeLabel(session.startsAt)}–{timeLabel(session.endsAt)}
                </SheetDescription>
              </SheetHeader>

              <dl className="space-y-2 text-sm">
                <Row label="Eğitmen" value={session.trainerName ?? '—'} />
                <Row label="Salon" value={session.roomName ?? '—'} />
                <Row label="Şube" value={session.branchName} />
                <Row label="Kapasite" value={`${session.bookedCount}/${session.capacity} dolu`} />
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Durum</dt>
                  <dd>
                    <Badge variant={session.status === 'cancelled' ? 'destructive' : 'outline'}>
                      {STATUS_LABEL[session.status] ?? session.status}
                    </Badge>
                  </dd>
                </div>
              </dl>

              {editable ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className="min-h-11" onClick={() => open('trainer')}>
                    Eğitmen
                  </Button>
                  <Button variant="outline" className="min-h-11" onClick={() => open('room')}>
                    Salon
                  </Button>
                  <Button variant="outline" className="min-h-11" onClick={() => open('capacity')}>
                    Kapasite
                  </Button>
                  <Button variant="destructive" className="min-h-11" onClick={() => open('cancel')}>
                    Seansı İptal Et
                  </Button>
                </div>
              ) : (
                <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                  Başlamış, tamamlanmış veya iptal edilmiş seans düzenlenemez.
                </p>
              )}
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={action !== null} onOpenChange={(o) => (o ? null : setAction(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === 'trainer'
                ? 'Eğitmen değiştir'
                : action === 'room'
                  ? 'Salon değiştir'
                  : action === 'capacity'
                    ? 'Kapasite düzenle'
                    : 'Seansı iptal et'}
            </DialogTitle>
            <DialogDescription>Bu işlem kayda geçer ve yalnızca başlamamış seansa uygulanır.</DialogDescription>
          </DialogHeader>

          {action === 'trainer' ? (
            <Select value={trainerId} onValueChange={(v) => setTrainerId(v ?? NONE)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Eğitmen yok</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {action === 'room' ? (
            <Select value={roomId} onValueChange={(v) => setRoomId(v ?? NONE)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Salon yok</SelectItem>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                    {r.capacity ? ` (${r.capacity})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {action === 'capacity' ? (
            <Input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
            />
          ) : null}

          <Textarea placeholder="Sebep (zorunlu)" value={reason} onChange={(e) => setReason(e.target.value)} />

          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button
              variant={action === 'cancel' ? 'destructive' : 'default'}
              onClick={submit}
              disabled={busy || reason.trim().length === 0}
            >
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              {action === 'cancel' ? 'Seansı İptal Et' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  )
}
