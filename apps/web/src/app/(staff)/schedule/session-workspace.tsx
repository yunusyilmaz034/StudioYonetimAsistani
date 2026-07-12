'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckIcon, DoorOpenIcon, Loader2Icon, UserIcon, UsersIcon, XIcon } from 'lucide-react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { dayHeading, timeLabel } from '@/components/calendar'
import { markAttendanceCommand } from '@/lib/commands'
import { domainErrorMessage } from '@/lib/domain-error'
import {
  getSessionAttendanceAction,
  type AttendanceEntry,
  type BookingMember,
} from '@/server/actions/booking'
import {
  assignSessionMemberAction,
  listEligibleMembersForServiceAction,
  cancelSessionAction,
  changeCapacityAction,
  changeRoomAction,
  changeTrainerAction,
  setSessionNoteAction,
} from '@/server/actions/scheduling'
import { correctReservationAction } from '@/server/actions/reservations'
import type { CalendarSession, PickOption, StaffOption } from '@/server/schedule-query'

import { BookingPanel } from './booking-panel'
import { WaitlistPanel } from './waitlist-panel'
import { STATUS_LABEL } from './types'

const NONE = '__none__'
// D14 — where the session's stamped cancellation window came from.
const WINDOW_SOURCE: Record<string, string> = {
  session: 'bu seansa özel',
  service: 'ders varsayılanı',
  studio: 'stüdyo varsayılanı',
}
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
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {session ? (
          <>
            {/* The header answers the questions you open a session to ask — when, who, where,
                how full — so the common case needs no tab click at all. */}
            <SheetHeader className="border-b border-border bg-surface p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="flex items-center gap-2 text-h1">
                    <span className="truncate">{session.serviceName}</span>
                    {session.category === 'private' ? (
                      <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[0.6875rem] font-medium text-muted-foreground">
                        PT
                      </span>
                    ) : null}
                  </SheetTitle>
                  <SheetDescription className="capitalize">
                    {dayHeading(new Date(session.startsAt).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }))} ·{' '}
                    {timeLabel(session.startsAt)}–{timeLabel(session.endsAt)}
                  </SheetDescription>
                </div>
                <Badge
                  variant={session.status === 'cancelled' ? 'destructive' : 'outline'}
                  className="shrink-0 capitalize"
                >
                  {STATUS_LABEL[session.status] ?? session.status}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <UserIcon className="size-3.5" />
                  {session.trainerName ?? 'Eğitmen yok'}
                </span>
                <span className="flex items-center gap-1.5">
                  <DoorOpenIcon className="size-3.5" />
                  {session.roomName ?? 'Salon yok'}
                </span>
                <span className="flex items-center gap-1.5">
                  <UsersIcon className="size-3.5" />
                  <span className="font-medium tabular-nums text-foreground">
                    {session.bookedCount}/{session.capacity}
                  </span>
                  dolu
                </span>
              </div>
            </SheetHeader>

            {/* Tabs — desktop tabs / mobile section nav (UX-1), on the house Tabs (DS v2). */}
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4 p-4 sm:p-5">
              <TabsList className="w-full">
                <TabsTrigger value="info">Bilgiler</TabsTrigger>
                <TabsTrigger value="reservations">
                  Rezervasyon
                  <span className="tabular-nums opacity-70">{session.bookedCount}</span>
                </TabsTrigger>
                <TabsTrigger value="attendance">Yoklama</TabsTrigger>
                <TabsTrigger value="notes">
                  Notlar
                  {session.note ? <span className="size-1.5 rounded-full bg-primary" /> : null}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="info">
                <InfoTab session={session} rooms={rooms} staff={staff} onMutated={onMutated} />
              </TabsContent>
              <TabsContent value="reservations">
                {/* D20 — the queue lives with the roster, in the same workspace (UX-1): the seat
                    that opens and the person who takes it are one decision. */}
                <div className="space-y-6">
                  <BookingPanel session={session} onMutated={onMutated} />
                  <WaitlistPanel
                    sessionId={session.sessionId}
                    full={session.bookedCount >= session.capacity && session.status === 'scheduled'}
                    onMutated={onMutated}
                  />
                </div>
              </TabsContent>
              <TabsContent value="attendance">
                <AttendanceTab session={session} onMutated={onMutated} />
              </TabsContent>
              <TabsContent value="notes">
                <NotesTab session={session} onMutated={onMutated} />
              </TabsContent>
            </Tabs>
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
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-card p-4 text-sm shadow-xs">
        <Row label="Eğitmen" value={session.trainerName ?? '—'} />
        <Row label="Salon" value={session.roomName ?? '—'} />
        <Row label="Şube" value={session.branchName} />
        <Row label="Kapasite" value={`${session.bookedCount}/${session.capacity} dolu`} />
        {/* D14 — the window this session was CREATED under, and which level answered. Changing
            a default later does not reach back here; that is the whole point. */}
        <Row
          label="İptal süresi"
          value={`${session.cancellationWindowHours} saat · ${WINDOW_SOURCE[session.cancellationWindowSource]}`}
        />
      </dl>

      {/* D13 — PT ownership. A private session is OPEN by default: any member with a PT package
          sees it and may book it. Assigning it RESERVES it for one member — she alone sees it
          and she alone may be booked into it. Ownership is independent of capacity. */}
      {session.category === 'private' ? (
        <PtAssignment session={session} editable={editable} onMutated={onMutated} />
      ) : null}

      {editable ? (
        <div className="space-y-2">
          <h3 className="text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">
            Seans yönetimi
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" className="min-h-11" onClick={() => open('trainer')}>
              Eğitmen
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => open('room')}>
              Salon
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => open('capacity')}>
              Kapasite
            </Button>
          </div>
          {/* Destructive action kept apart from the routine edits — it is not one of them. */}
          <Button variant="destructive" className="min-h-11 w-full" onClick={() => open('cancel')}>
            Seansı İptal Et
          </Button>
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

          {/* Select.Value renders the raw value unless told otherwise — without these the
              trigger would show an id ('__none__', a staff id) instead of a name. */}
          {action === 'trainer' ? (
            <Select value={trainerId} onValueChange={(v) => setTrainerId(v ?? NONE)}>
              <SelectTrigger>
                <SelectValue>
                  {(v: unknown) =>
                    typeof v === 'string' && v !== NONE
                      ? (staff.find((s) => s.id === v)?.name ?? 'Eğitmen yok')
                      : 'Eğitmen yok'
                  }
                </SelectValue>
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
                <SelectValue>
                  {(v: unknown) =>
                    typeof v === 'string' && v !== NONE
                      ? (rooms.find((r) => r.id === v)?.name ?? 'Salon yok')
                      : 'Salon yok'
                  }
                </SelectValue>
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

// ── PT ataması (D13) ─────────────────────────────────────────────────────────
function PtAssignment({
  session,
  editable,
  onMutated,
}: {
  session: CalendarSession
  editable: boolean
  onMutated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<readonly BookingMember[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  // D13 — only members who could actually book THIS slot: same core predicate as the booking
  // decider, scoped to this session's service and start time.
  async function openPicker() {
    setQuery('')
    setOpen(true)
    if (members === null) {
      try {
        setMembers(
          await listEligibleMembersForServiceAction({
            serviceId: session.serviceId,
            startsAt: session.startsAt,
          }),
        )
      } catch {
        setMembers([])
        toast.error('Üye listesi yüklenemedi.')
      }
    }
  }

  async function assign(memberId: string | null) {
    setBusy(true)
    try {
      const res = await assignSessionMemberAction({ sessionId: session.sessionId, memberId })
      if (res.ok) {
        toast.success(memberId ? 'Seans üyeye atandı.' : 'Atama kaldırıldı.')
        setOpen(false)
        onMutated()
      } else {
        toast.error(domainErrorMessage(res.error))
      }
    } catch {
      toast.error('İşlem tamamlanamadı.')
    }
    setBusy(false)
  }

  const q = query.trim().toLocaleLowerCase('tr')
  const filtered = (members ?? []).filter(
    (m) => q === '' || m.fullName.toLocaleLowerCase('tr').includes(q) || m.phone.includes(q),
  )

  return (
    <div className="space-y-2">
      <h3 className="text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">PT ataması</h3>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-xs">
        <div className="min-w-0">
          {session.assignedMemberName ? (
            <>
              <p className="truncate text-sm font-medium text-foreground">{session.assignedMemberName}</p>
              <p className="text-xs text-muted-foreground">
                Bu seans yalnızca bu üyeye ayrılmış. Başka üye göremez ve rezerve edemez.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground">Açık PT slotu</p>
              <p className="text-xs text-muted-foreground">
                PT paketi olan tüm üyeler görebilir ve kapasite dahilinde rezerve edebilir.
              </p>
            </>
          )}
        </div>
        {editable ? (
          <div className="flex shrink-0 gap-2">
            {session.assignedMemberId ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => assign(null)}>
                Kaldır
              </Button>
            ) : null}
            <Button variant="outline" size="sm" disabled={busy} onClick={openPicker}>
              {session.assignedMemberId ? 'Değiştir' : 'Üyeye Ayır'}
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={(o) => (o ? null : setOpen(false))}>
        <DialogContent className="max-h-[80vh] gap-3 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>PT seansını üyeye ata</DialogTitle>
            <DialogDescription>
              Seans yalnızca bu üyeye ayrılır: sadece o görür ve sadece o rezerve edilebilir.
              Atamayı kaldırırsanız seans yeniden açık PT slotuna döner.
            </DialogDescription>
          </DialogHeader>
          <Input placeholder="Üye ara…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          {members === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Yükleniyor…
            </p>
          ) : (
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {filtered.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => assign(m.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-primary-soft/40 disabled:opacity-50"
                  >
                    <span className="truncate font-medium text-foreground">{m.fullName}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{m.phone}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 ? (
                <li className="px-3 py-2.5 text-sm text-muted-foreground">
                  {members.length === 0
                    ? 'Bu PT hizmetini kapsayan aktif pakete sahip üye bulunamadı.'
                    : 'Eşleşen üye yok.'}
                </li>
              ) : null}
            </ul>
          )}
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

      {/* Progress leads: taking attendance is a countdown to zero pending, and the bulk
          action sits next to the number it changes. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-h2 font-semibold tabular-nums text-foreground">
            {attended}
            <span className="text-sm font-normal text-muted-foreground">/{entries.length} katıldı</span>
          </p>
          {pending.length > 0 ? (
            <p className="text-xs text-muted-foreground">{pending.length} kişi bekliyor</p>
          ) : null}
        </div>
        {pending.length > 0 ? (
          <Button size="sm" variant="outline" className="shrink-0" onClick={markRest}>
            Kalanları katıldı işaretle
          </Button>
        ) : null}
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        {entries.map((e) => {
          const st = effective(e)
          const badge = OUTCOME_BADGE[st] ?? { label: st, className: 'bg-muted text-muted-foreground' }
          return (
            <li key={e.reservationId} className="flex items-center justify-between gap-2 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground">{e.memberName}</p>
                {st !== 'booked' ? <Badge className={`shrink-0 ${badge.className}`}>{badge.label}</Badge> : null}
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
            <SelectValue>{(v: unknown) => (v === 'no_show' ? 'Gelmedi' : 'Katıldı')}</SelectValue>
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
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">Ders Notu</label>
        <Textarea
          rows={5}
          placeholder="Bu ders hakkında not… (yaylar, ısınma, ekipman vb.)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">Görünürlük</label>
        <Select value={visibility} onValueChange={(v) => setVisibility((v as 'staff' | 'members') ?? 'staff')}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v: unknown) => (v === 'members' ? 'Üyelere açık' : 'Yalnızca personel')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="staff">Yalnızca personel</SelectItem>
            <SelectItem value="members">Üyelere açık</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          “Üyelere açık” seçilirse not, üye uygulamasında görünür (v1.21).
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
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-foreground">{value}</dd>
    </div>
  )
}
