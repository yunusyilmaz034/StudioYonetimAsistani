'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckIcon, Loader2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { AttendanceOutcome, ReservationId } from '@studio/core'

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
import { dayHeading, timeLabel } from '@/components/calendar'
import { markAttendanceCommand } from '@/lib/commands'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  getSessionAttendanceAction,
  type AttendanceEntry,
} from '@/server/actions/booking'
import {
  cancelSessionAction,
  changeCapacityAction,
  changeRoomAction,
  changeTrainerAction,
  setSessionNoteAction,
} from '@/server/actions/scheduling'
import { correctReservationAction } from '@/server/actions/reservations'
import type { CalendarSession, PickOption, StaffOption } from '@/server/schedule-query'

import { BookingPanel } from './booking-panel'
import { STATUS_LABEL } from './types'

const NONE = '__none__'
type Manage = 'trainer' | 'room' | 'capacity' | 'cancel'
type Tab = 'info' | 'reservations' | 'attendance' | 'notes'

export function SessionWorkspace({
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
  const [tab, setTab] = useState<Tab>('info')

  // Reset to the first tab whenever a different session opens.
  useEffect(() => {
    setTab('info')
  }, [session?.sessionId])

  return (
    <Sheet open={session !== null} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent side="right" className="w-full gap-4 overflow-y-auto p-4 sm:max-w-2xl">
        {session ? (
          <>
            <SheetHeader className="p-0">
              <SheetTitle>{session.serviceName}</SheetTitle>
              <SheetDescription className="capitalize">
                {dayHeading(new Date(session.startsAt).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }))} ·{' '}
                {timeLabel(session.startsAt)}–{timeLabel(session.endsAt)}
              </SheetDescription>
            </SheetHeader>

            {/* Tabs — desktop tabs / mobile section nav (UX-1). */}
            <div className="flex rounded-lg border border-border p-0.5 text-sm">
              {(
                [
                  ['info', 'Ders Bilgileri'],
                  ['reservations', `Rezervasyonlar (${session.bookedCount})`],
                  ['attendance', 'Yoklama'],
                  ['notes', session.note ? 'Notlar •' : 'Notlar'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`min-h-9 flex-1 rounded-md px-2 font-medium ${
                    tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'info' ? (
              <InfoTab session={session} rooms={rooms} staff={staff} onMutated={onMutated} />
            ) : tab === 'reservations' ? (
              <BookingPanel session={session} onMutated={onMutated} />
            ) : tab === 'attendance' ? (
              <AttendanceTab session={session} onMutated={onMutated} />
            ) : (
              <NotesTab session={session} onMutated={onMutated} />
            )}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

// ── Ders Bilgileri ─────────────────────────────────────────────────────────
function InfoTab({
  session,
  rooms,
  staff,
  onMutated,
}: {
  session: CalendarSession
  rooms: readonly PickOption[]
  staff: readonly StaffOption[]
  onMutated: () => void
}) {
  const [action, setAction] = useState<Manage | null>(null)
  const [reason, setReason] = useState('')
  const [trainerId, setTrainerId] = useState<string>(NONE)
  const [roomId, setRoomId] = useState<string>(NONE)
  const [capacity, setCapacity] = useState<number>(1)
  const [busy, setBusy] = useState(false)

  const editable = session.status === 'scheduled' && session.startsAt > Date.now()

  function open(a: Manage) {
    setReason('')
    setTrainerId(session.trainerId ?? NONE)
    setRoomId(session.roomId ?? NONE)
    setCapacity(session.capacity)
    setAction(a)
  }

  async function submit() {
    if (!action) return
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
    <div className="space-y-4">
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
        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-medium text-foreground">Seans yönetimi</h3>
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
        </div>
      ) : (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          Başlamış, tamamlanmış veya iptal edilmiş seans düzenlenemez.
        </p>
      )}

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
    </div>
  )
}

// ── Yoklama ──────────────────────────────────────────────────────────────────
const OUTCOME_BADGE: Record<string, { label: string; className: string }> = {
  attended: { label: 'Katıldı', className: 'bg-success/10 text-success' },
  no_show: { label: 'Gelmedi', className: 'bg-danger/10 text-danger' },
  booked: { label: 'Bekliyor', className: 'bg-muted text-muted-foreground' },
}

function AttendanceTab({ session, onMutated }: { session: CalendarSession; onMutated: () => void }) {
  const [entries, setEntries] = useState<readonly AttendanceEntry[] | null>(null)
  // Optimistic marks (offline command applies in 1–3 s via the trigger).
  const [marks, setMarks] = useState<Record<string, AttendanceOutcome>>({})
  const [correcting, setCorrecting] = useState<AttendanceEntry | null>(null)

  const load = useCallback(async () => {
    setEntries(null)
    setMarks({})
    try {
      setEntries(await getSessionAttendanceAction({ sessionId: session.sessionId }))
    } catch {
      setEntries([])
      toast.error('Yoklama listesi yüklenemedi.')
    }
  }, [session.sessionId])

  useEffect(() => {
    void load()
  }, [load])

  const effective = (e: AttendanceEntry): string => marks[e.reservationId] ?? e.status
  const notStarted = session.startsAt > Date.now()

  const mark = useCallback(async (reservationId: string, outcome: AttendanceOutcome) => {
    setMarks((prev) => ({ ...prev, [reservationId]: outcome }))
    try {
      await markAttendanceCommand({ reservationId: reservationId as ReservationId, outcome })
    } catch {
      setMarks((prev) => {
        const next = { ...prev }
        delete next[reservationId]
        return next
      })
      toast.error('İşaretlenemedi.')
    }
  }, [])

  const pending = (entries ?? []).filter((e) => effective(e) === 'booked')

  async function markRest() {
    for (const e of pending) void mark(e.reservationId, 'attended')
    toast.success(`${pending.length} kişi katıldı işaretlendi.`)
  }

  if (entries === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
      </p>
    )
  }
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Bu seansta rezervasyon yok.</p>
  }

  const attended = entries.filter((e) => effective(e) === 'attended').length

  return (
    <div className="space-y-3">
      {notStarted ? (
        <p className="rounded-lg bg-warning/10 p-2.5 text-xs text-warning">
          Seans henüz başlamadı. Yoklama ders saatinde alınır.
        </p>
      ) : null}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{attended}</span>/{entries.length} katıldı
        </span>
        {pending.length > 0 ? (
          <Button size="sm" variant="outline" onClick={markRest}>
            Kalanları katıldı işaretle
          </Button>
        ) : null}
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border">
        {entries.map((e) => {
          const st = effective(e)
          const badge = OUTCOME_BADGE[st] ?? { label: st, className: 'bg-muted text-muted-foreground' }
          return (
            <li key={e.reservationId} className="flex items-center justify-between gap-2 p-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{e.memberName}</p>
                <Badge className={`mt-0.5 ${badge.className}`}>{badge.label}</Badge>
              </div>
              {st === 'booked' ? (
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" onClick={() => mark(e.reservationId, 'attended')}>
                    <CheckIcon /> Katıldı
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => mark(e.reservationId, 'no_show')}>
                    <XIcon /> Gelmedi
                  </Button>
                </div>
              ) : marks[e.reservationId] ? (
                <span className="shrink-0 text-xs text-muted-foreground">kaydediliyor…</span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setCorrecting(e)}>
                  Düzelt
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      <CorrectionDialog
        entry={correcting}
        onClose={() => setCorrecting(null)}
        onDone={() => {
          setCorrecting(null)
          void load()
          onMutated()
        }}
      />
    </div>
  )
}

function CorrectionDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: AttendanceEntry | null
  onClose: () => void
  onDone: () => void
}) {
  const [outcome, setOutcome] = useState<AttendanceOutcome>('attended')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (entry) {
      setOutcome(entry.status === 'attended' ? 'no_show' : 'attended')
      setReason('')
    }
  }, [entry])

  async function submit() {
    if (!entry) return
    setBusy(true)
    try {
      const res = await correctReservationAction({ reservationId: entry.reservationId, toOutcome: outcome, reason: reason.trim() })
      if (res.ok) {
        toast.success('Düzeltildi.')
        onDone()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Düzeltme tamamlanamadı.')
    }
    setBusy(false)
  }

  return (
    <Dialog open={entry !== null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yoklama düzelt</DialogTitle>
          <DialogDescription>{entry?.memberName} için katılımı düzelt. Sebep zorunludur ve kayda geçer.</DialogDescription>
        </DialogHeader>
        <Select value={outcome} onValueChange={(v) => setOutcome((v as AttendanceOutcome) ?? 'attended')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="attended">Katıldı</SelectItem>
            <SelectItem value="no_show">Gelmedi</SelectItem>
          </SelectContent>
        </Select>
        <Textarea placeholder="Sebep (zorunlu)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={busy || reason.trim().length === 0}>
            {busy ? <Loader2Icon className="animate-spin" /> : null} Düzelt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Notlar (Ders Notu) ───────────────────────────────────────────────────────
function NotesTab({ session, onMutated }: { session: CalendarSession; onMutated: () => void }) {
  const [text, setText] = useState(session.note?.text ?? '')
  const [visibility, setVisibility] = useState<'staff' | 'members'>(session.note?.visibility ?? 'staff')
  const [busy, setBusy] = useState(false)

  // Re-sync when a different session opens.
  useEffect(() => {
    setText(session.note?.text ?? '')
    setVisibility(session.note?.visibility ?? 'staff')
  }, [session.sessionId, session.note?.text, session.note?.visibility])

  async function save() {
    setBusy(true)
    try {
      const res = await setSessionNoteAction({ sessionId: session.sessionId, text: text.trim(), visibility })
      if (res.ok) {
        toast.success(text.trim() ? 'Ders notu kaydedildi.' : 'Ders notu silindi.')
        onMutated()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('Kaydedilemedi.')
    }
    setBusy(false)
  }

  const dirty = text.trim() !== (session.note?.text ?? '') || visibility !== (session.note?.visibility ?? 'staff')

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">Ders Notu</label>
        <Textarea
          rows={5}
          placeholder="Bu ders hakkında not… (yaylar, ısınma, ekipman vb.)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">Görünürlük</label>
        <Select value={visibility} onValueChange={(v) => setVisibility((v as 'staff' | 'members') ?? 'staff')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="staff">Yalnızca personel</SelectItem>
            <SelectItem value="members">Üyelere açık</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          “Üyelere açık” seçilirse not, üye uygulamasında görünür (v1.20).
        </p>
      </div>
      <Button className="min-h-11 w-full" onClick={save} disabled={busy || !dirty}>
        {busy ? <Loader2Icon className="animate-spin" /> : null} Kaydet
      </Button>
    </div>
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
