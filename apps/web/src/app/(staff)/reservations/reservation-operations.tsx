'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRightIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
  PlusIcon,
  RepeatIcon,
  SearchIcon,
  UserRoundIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import type { RecurringPlan, RecurringSkipReason } from '@studio/core'

import { domainErrorMessage } from '@/lib/domain-error'
import {
  applyRecurringAction,
  bookReservationAction,
  cancelReservationAction,
  listMoveTargetsAction,
  moveReservationAction,
  previewRecurringAction,
  type MoveTarget,
} from '@/server/actions/reservations'
import { loadReservationDayAction } from '@/server/actions/reservation-day'
import {
  joinWaitlistAction,
  leaveWaitlistAction,
  listWaitlistAction,
  promoteWaitlistAction,
  type WaitlistRow,
} from '@/server/actions/waitlist'
import type { CalendarSession } from '@/server/schedule-query'
import type { ReservationCalendarData } from '@/server/reservation-calendar-query'
import { FillBar } from '@/components/ui/chart'
import { cn } from '@/lib/utils'

// ── Reservation Operations (Plus Phase 2, Doc 32 §2) ─────────────────────────────────────────────
//
// One surface, no modals, no page transitions. Reception picks a class on the left, and the roster +
// an inline "add member" search open on the right. Booking is: click a class (or ↑/↓), type a name,
// Enter. Everything is keyboard-reachable; the calendar flips days without a navigation. Premium and
// readable — the domain is untouched; this only calls the existing trusted actions.

export interface BookingMember {
  readonly id: string
  readonly fullName: string
  readonly phone: string
}

// The write/read surface, injected so the dev preview can run the whole screen on mock data with no
// session. The live wrapper below binds the real Server Actions.
export interface ReservationOps {
  loadDay(date: string): Promise<ReservationCalendarData>
  book(sessionId: string, memberId: string): Promise<{ ok: boolean; error?: string }>
  cancel(reservationId: string): Promise<{ ok: boolean; error?: string }>
  moveTargets(reservationId: string): Promise<readonly MoveTarget[]>
  // `needsReason` ⇔ the member is past their cancellation window, so a staff move must record WHY
  // (I: `reason_required`). The picker then asks for it and retries — never a silent override.
  move(
    reservationId: string,
    targetSessionId: string,
    reason: string | null,
  ): Promise<{ ok: boolean; error?: string; needsReason?: boolean }>
  listWaitlist(sessionId: string): Promise<readonly WaitlistRow[]>
  joinWaitlist(sessionId: string, memberId: string): Promise<{ ok: boolean; error?: string }>
  leaveWaitlist(entryId: string): Promise<{ ok: boolean; error?: string }>
  promoteWaitlist(entryId: string): Promise<{ ok: boolean; error?: string }>
  previewRecurring(sessionId: string, memberId: string, weeks: number): Promise<RecurringPlan | null>
  applyRecurring(
    sessionId: string,
    memberId: string,
    weeks: number,
  ): Promise<{ ok: boolean; error?: string; booked?: number; failed?: number }>
}

const CAT: Record<string, { text: string; dot: string; soft: string; label: string }> = {
  pilates_group: { text: 'text-cat-pilates', dot: 'bg-cat-pilates', soft: 'bg-cat-pilates-soft', label: 'Pilates' },
  fitness: { text: 'text-cat-fitness', dot: 'bg-cat-fitness', soft: 'bg-cat-fitness-soft', label: 'Fitness' },
  private: { text: 'text-cat-private', dot: 'bg-cat-private', soft: 'bg-cat-private-soft', label: 'Özel' },
}
const catOf = (c: string) => CAT[c] ?? { text: 'text-muted-foreground', dot: 'bg-muted-foreground', soft: 'bg-muted', label: c }

const hhmm = (ms: number) =>
  new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).format(ms)
const longDate = (dateStr: string) =>
  new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' }).format(
    new Date(`${dateStr}T12:00:00Z`),
  )
const addDays = (dateStr: string, n: number): string => {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const digits = (s: string) => s.replace(/\D/g, '')

// ── the live wrapper: binds the real actions. Used by the /reservations page. ────────────────────
export function ReservationOperationsLive(props: {
  initialData: ReservationCalendarData
  initialDate: string
  today: string
  members: readonly BookingMember[]
}) {
  const ops: ReservationOps = useMemo(
    () => ({
      loadDay: (d) => loadReservationDayAction(d),
      book: async (sessionId, memberId) => {
        const r = await bookReservationAction({ sessionId, memberId })
        return r.ok ? { ok: true } : { ok: false, error: domainErrorMessage(r.error) }
      },
      cancel: async (reservationId) => {
        const r = await cancelReservationAction({ reservationId })
        return r.ok ? { ok: true } : { ok: false, error: domainErrorMessage(r.error) }
      },
      moveTargets: (reservationId) => listMoveTargetsAction({ reservationId, nowMs: Date.now() }),
      move: async (reservationId, targetSessionId, reason) => {
        const r = await moveReservationAction({ reservationId, targetSessionId, overrideReason: reason })
        if (r.ok) return { ok: true }
        if (r.error.code === 'reason_required') return { ok: false, needsReason: true }
        return { ok: false, error: domainErrorMessage(r.error) }
      },
      listWaitlist: (sessionId) => listWaitlistAction({ sessionId }),
      joinWaitlist: async (sessionId, memberId) => {
        const r = await joinWaitlistAction({ sessionId, memberId })
        return r.ok ? { ok: true } : { ok: false, error: domainErrorMessage(r.error) }
      },
      leaveWaitlist: async (entryId) => {
        const r = await leaveWaitlistAction({ entryId })
        return r.ok ? { ok: true } : { ok: false, error: domainErrorMessage(r.error) }
      },
      promoteWaitlist: async (entryId) => {
        const r = await promoteWaitlistAction({ entryId })
        return r.ok ? { ok: true } : { ok: false, error: domainErrorMessage(r.error) }
      },
      previewRecurring: (sessionId, memberId, weeks) =>
        previewRecurringAction({ sessionId, memberId, weeks, skipDates: [] }),
      applyRecurring: async (sessionId, memberId, weeks) => {
        const r = await applyRecurringAction({ sessionId, memberId, weeks, skipDates: [] })
        return r.ok
          ? { ok: true, booked: r.value.booked, failed: r.value.failed }
          : { ok: false, error: domainErrorMessage(r.error) }
      },
    }),
    [],
  )
  return <ReservationOperations {...props} ops={ops} />
}

export function ReservationOperations({
  initialData,
  initialDate,
  today,
  members,
  ops,
}: {
  initialData: ReservationCalendarData
  initialDate: string
  today: string
  members: readonly BookingMember[]
  ops: ReservationOps
}) {
  const [date, setDate] = useState(initialDate)
  const [data, setData] = useState(initialData)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Sessions of the day, in time order; cancelled ones sink to the bottom, dimmed.
  const sessions = useMemo(
    () =>
      [...data.sessions].sort((a, b) => {
        const ca = a.status === 'cancelled' ? 1 : 0
        const cb = b.status === 'cancelled' ? 1 : 0
        return ca - cb || a.startsAt - b.startsAt
      }),
    [data.sessions],
  )
  const selected = sessions.find((s) => s.sessionId === selectedId) ?? null

  const goDay = useCallback(
    async (next: string) => {
      setLoading(true)
      setSelectedId(null)
      try {
        const fresh = await ops.loadDay(next)
        setData(fresh)
        setDate(next)
      } catch {
        toast.error('Gün yüklenemedi.')
      } finally {
        setLoading(false)
      }
    },
    [ops],
  )

  const refresh = useCallback(async () => {
    try {
      setData(await ops.loadDay(date))
    } catch {
      /* a failed refresh leaves the last-known day on screen; the next action retries */
    }
  }, [ops, date])

  // ← / → flip days when focus is not in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') void goDay(addDays(date, -1))
      else if (e.key === 'ArrowRight') void goDay(addDays(date, 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [date, goDay])

  const pick = useCallback((id: string) => {
    setSelectedId(id)
    setTimeout(() => searchRef.current?.focus(), 30)
  }, [])

  return (
    <main className="mx-auto flex h-[100dvh] max-w-[1600px] flex-col p-4 sm:p-6 lg:p-8">
      {/* ── header: date nav ──────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3 pb-5">
        <div>
          <p className="text-sm text-muted-foreground">
            {date === today ? 'Bugün' : addDays(today, 1) === date ? 'Yarın' : addDays(today, -1) === date ? 'Dün' : 'Rezervasyon'}
          </p>
          <h1 className="font-heading text-display font-medium text-foreground capitalize">{longDate(date)}</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <NavBtn onClick={() => void goDay(addDays(date, -1))} aria-label="Önceki gün">
            <ChevronLeftIcon className="size-4" />
          </NavBtn>
          <button
            type="button"
            onClick={() => void goDay(today)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40"
          >
            <CalendarDaysIcon className="size-4" />
            Bugün
          </button>
          <NavBtn onClick={() => void goDay(addDays(date, 1))} aria-label="Sonraki gün">
            <ChevronRightIcon className="size-4" />
          </NavBtn>
        </div>
      </header>

      {/* ── two-pane operations surface ───────────────────────────────── */}
      <div className={cn('grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_400px]', loading && 'opacity-60')}>
        {/* LEFT — the day's classes */}
        <section className="min-h-0 overflow-y-auto pr-1">
          {sessions.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
              <CalendarDaysIcon className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Bu gün için ders yok.</p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {sessions.map((s) => (
                <ClassCard
                  key={s.sessionId}
                  s={s}
                  booked={data.rosters[s.sessionId]?.length ?? s.bookedCount}
                  selected={s.sessionId === selectedId}
                  onSelect={() => pick(s.sessionId)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* RIGHT — the selected class: roster + inline booking */}
        <aside className="min-h-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {selected ? (
            <RosterPanel
              key={selected.sessionId}
              session={selected}
              roster={data.rosters[selected.sessionId] ?? []}
              members={members}
              ops={ops}
              searchRef={searchRef}
              onChanged={refresh}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <UserRoundIcon className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Bir ders seç — katılanlar ve hızlı rezervasyon burada açılır.</p>
              <p className="text-xs text-muted-foreground/70">↑ ↓ ders · ← → gün · ⌘K üye ara</p>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}

function NavBtn({ children, onClick, ...rest }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      className="grid size-9 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      {children}
    </button>
  )
}

function ClassCard({
  s,
  booked,
  selected,
  onSelect,
}: {
  s: CalendarSession
  booked: number
  selected: boolean
  onSelect: () => void
}) {
  const cat = catOf(s.category)
  const cancelled = s.status === 'cancelled'
  const full = booked >= s.capacity
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={cn(
          'w-full rounded-xl border bg-card p-4 text-left shadow-sm transition-all',
          cancelled && 'opacity-55',
          selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/40 hover:shadow-md',
        )}
      >
        <div className="flex items-start gap-4">
          <div className="flex w-16 shrink-0 flex-col items-start">
            <span className="font-heading text-h1 font-medium tabular-nums text-foreground">{hhmm(s.startsAt)}</span>
            <span className={cn('mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-medium', cat.soft, cat.text)}>
              <span className={cn('size-1.5 rounded-full', cat.dot)} />
              {cat.label}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium text-foreground">
                {s.serviceName}
                {cancelled ? <span className="ml-2 text-xs font-normal text-danger">İptal</span> : null}
              </span>
              <span className={cn('shrink-0 text-sm font-medium tabular-nums', full ? 'text-gold' : 'text-muted-foreground')}>
                {booked}/{s.capacity}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {s.trainerName ?? 'Eğitmen atanmadı'}
              {s.roomName ? ` · ${s.roomName}` : ''}
            </p>
            <FillBar value={booked} max={s.capacity} className="mt-2.5" />
          </div>
        </div>
      </button>
    </li>
  )
}

const SKIP_LABEL: Record<RecurringSkipReason, string> = {
  no_session: 'O hafta ders yok',
  session_cancelled: 'Ders iptal',
  session_full: 'Ders dolu',
  session_in_past: 'Geçmiş',
  already_booked: 'Zaten kayıtlı',
  no_eligible_entitlement: 'Uygun paket yok',
  calendar_day: 'Tatil / kapalı',
}

function RecurringPicker({
  sessionId,
  memberId,
  name,
  ops,
  onCancel,
  onDone,
}: {
  sessionId: string
  memberId: string
  name: string
  ops: ReservationOps
  onCancel: () => void
  onDone: () => Promise<void>
}) {
  const [weeks, setWeeks] = useState(8)
  const [plan, setPlan] = useState<RecurringPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    void ops.previewRecurring(sessionId, memberId, weeks).then((p) => {
      if (live) {
        setPlan(p)
        setLoading(false)
      }
    })
    return () => {
      live = false
    }
  }, [ops, sessionId, memberId, weeks])

  const apply = async () => {
    setBusy(true)
    const r = await ops.applyRecurring(sessionId, memberId, weeks)
    setBusy(false)
    if (r.ok) {
      toast.success(`${r.booked ?? 0} rezervasyon oluşturuldu${r.failed ? `, ${r.failed} atlandı` : ''}.`)
      await onDone()
    } else {
      toast.error(r.error ?? 'Sabit rezervasyon oluşturulamadı.')
    }
  }

  const toBook = plan?.toBook.length ?? 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Geri"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        <span className="text-sm text-foreground">
          <span className="font-medium">{name}</span> · her hafta aynı saat
        </span>
      </div>

      <div className="border-b border-border p-3">
        <p className="mb-2 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">Kaç hafta?</p>
        <div className="flex gap-1.5">
          {[4, 8, 12].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeeks(w)}
              className={cn(
                'flex-1 rounded-lg border py-1.5 text-sm font-medium transition-colors',
                weeks === w ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:border-primary/40',
              )}
            >
              {w} hafta
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading || !plan ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Hesaplanıyor…</p>
        ) : (
          <>
            <p className="text-sm text-foreground">
              <span className="font-heading text-h1 font-medium text-primary">{toBook}</span> hafta rezervasyon yapılacak.
            </p>
            {plan.skipped.length > 0 ? (
              <div className="mt-3">
                <p className="mb-1.5 text-xs text-muted-foreground">Atlanan {plan.skipped.length} hafta:</p>
                <ul className="space-y-1">
                  {plan.skipped.map((s, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
                      <span className="tabular-nums text-muted-foreground">{s.date}</span>
                      <span className="text-muted-foreground">{SKIP_LABEL[s.reason]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="border-t border-border p-3">
        <button
          type="button"
          disabled={busy || loading || toBook === 0}
          onClick={() => void apply()}
          className="h-10 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {busy ? 'Oluşturuluyor…' : toBook > 0 ? `${toBook} rezervasyon oluştur` : 'Uygun hafta yok'}
        </button>
      </div>
    </div>
  )
}

function WaitlistPanel({
  sessionId,
  capacity,
  members,
  bookedIds,
  ops,
  onChanged,
}: {
  sessionId: string
  capacity: number
  members: readonly BookingMember[]
  bookedIds: ReadonlySet<string>
  ops: ReservationOps
  onChanged: () => Promise<void>
}) {
  const [rows, setRows] = useState<readonly WaitlistRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setRows(await ops.listWaitlist(sessionId))
  }, [ops, sessionId])
  useEffect(() => {
    void load()
  }, [load])

  const waitingIds = useMemo(() => new Set((rows ?? []).map((r) => r.memberId)), [rows])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const qd = digits(q)
    return members
      .filter((m) => !bookedIds.has(m.id) && !waitingIds.has(m.id))
      .filter((m) => m.fullName.toLowerCase().includes(q) || (qd.length >= 3 && digits(m.phone).includes(qd)))
      .slice(0, 5)
  }, [query, members, bookedIds, waitingIds])

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (r.ok) {
      toast.success(okMsg)
      await load()
      await onChanged()
    } else {
      toast.error(r.error ?? 'İşlem başarısız.')
    }
  }

  const waiting = (rows ?? []).filter((r) => r.status === 'waiting')

  return (
    <div className="border-b border-border">
      <div className="flex items-center gap-2 bg-gold-soft px-4 py-2.5 text-xs font-medium text-gold">
        <span className="size-1.5 rounded-full bg-gold" />
        Ders dolu ({capacity}/{capacity}) · Bekleme listesi{waiting.length ? ` · ${waiting.length}` : ''}
      </div>
      <div className="p-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary">
          <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={busy}
            placeholder="Bekleme listesine üye ekle…"
            className="h-9 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
            aria-label="Bekleme listesine ekle"
          />
        </div>
        {matches.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() => ops.joinWaitlist(sessionId, m.id), `${m.fullName} bekleme listesine eklendi.`).then(
                      () => setQuery(''),
                    )
                  }
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <span className="truncate">{m.fullName}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{m.phone}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {waiting.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {waiting.map((w) => (
              <li key={w.entryId} className="group/w flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-muted">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gold-soft text-[0.7rem] font-semibold text-gold tabular-nums">
                  {w.position}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{w.memberName}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => ops.promoteWaitlist(w.entryId), `${w.memberName} rezervasyona alındı.`)}
                  title="Rezervasyona al (yer açıldıysa)"
                  className="rounded-md px-2 py-1 text-xs font-medium text-primary opacity-0 transition-all hover:bg-primary-soft group-hover/w:opacity-100 disabled:opacity-50"
                >
                  Al
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => ops.leaveWaitlist(w.entryId), `${w.memberName} listeden çıkarıldı.`)}
                  aria-label={`${w.memberName} bekleme listesinden çıkar`}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover/w:opacity-100 disabled:opacity-50"
                >
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : rows !== null ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Bekleyen yok.</p>
        ) : null}
      </div>
    </div>
  )
}

function MovePicker({
  reservationId,
  name,
  ops,
  onCancel,
  onDone,
}: {
  reservationId: string
  name: string
  ops: ReservationOps
  onCancel: () => void
  onDone: () => Promise<void>
}) {
  const [targets, setTargets] = useState<readonly MoveTarget[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [needReason, setNeedReason] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    let live = true
    void ops.moveTargets(reservationId).then((t) => {
      if (live) setTargets(t)
    })
    return () => {
      live = false
    }
  }, [ops, reservationId])

  const doMove = async (targetSessionId: string) => {
    if (needReason && reason.trim().length === 0) {
      toast.error('İptal penceresi geçti — bir sebep gir.')
      return
    }
    setBusy(true)
    const r = await ops.move(reservationId, targetSessionId, needReason ? reason.trim() : null)
    setBusy(false)
    if (r.ok) {
      toast.success(`${name} taşındı.`)
      await onDone()
    } else if (r.needsReason) {
      setNeedReason(true)
      toast.error('İptal penceresi geçti — devam etmek için sebep gerekli.')
    } else {
      toast.error(r.error ?? 'Taşınamadı.')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Geri"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        <span className="text-sm text-foreground">
          <span className="font-medium">{name}</span> nereye taşınsın?
        </span>
      </div>

      {needReason ? (
        <div className="border-b border-border p-3">
          <label className="mb-1 block text-[0.7rem] font-medium tracking-wide text-warning uppercase">
            Sebep gerekli (iptal penceresi geçti)
          </label>
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ör. üye rahatsızlandı, telefonla istedi…"
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-3 focus:ring-ring/40"
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {targets === null ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Uygun dersler yükleniyor…</p>
        ) : targets.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Taşınacak uygun ders yok.</p>
        ) : (
          <ul className="space-y-1">
            {targets.map((t) => {
              const full = t.bookedCount >= t.capacity
              return (
                <li key={t.sessionId}>
                  <button
                    type="button"
                    disabled={busy || full}
                    onClick={() => void doMove(t.sessionId)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary-soft/30 disabled:opacity-50"
                  >
                    <span className="font-heading text-sm font-medium tabular-nums text-foreground">
                      {new Intl.DateTimeFormat('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Europe/Istanbul',
                      }).format(t.startsAt)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{t.serviceName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {t.trainerName ?? 'Eğitmen yok'}
                        {t.roomName ? ` · ${t.roomName}` : ''}
                      </span>
                    </span>
                    <span className={cn('shrink-0 text-xs tabular-nums', full ? 'text-gold' : 'text-muted-foreground')}>
                      {t.bookedCount}/{t.capacity}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function RosterPanel({
  session,
  roster,
  members,
  ops,
  searchRef,
  onChanged,
}: {
  session: CalendarSession
  roster: ReservationCalendarData['rosters'][string]
  members: readonly BookingMember[]
  ops: ReservationOps
  searchRef: React.RefObject<HTMLInputElement | null>
  onChanged: () => Promise<void>
}) {
  const cat = catOf(session.category)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState<{ reservationId: string; name: string } | null>(null)
  const [recurring, setRecurring] = useState<{ memberId: string; name: string } | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const bookedIds = useMemo(() => new Set(roster.map((r) => r.memberId)), [roster])
  const full = roster.length >= session.capacity

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const qd = digits(q)
    return members
      .filter((m) => !bookedIds.has(m.id))
      .filter((m) => m.fullName.toLowerCase().includes(q) || (qd.length >= 3 && digits(m.phone).includes(qd)))
      .slice(0, 6)
  }, [query, members, bookedIds])

  useEffect(() => setActive(0), [query])

  const book = async (memberId: string) => {
    setBusy(true)
    const r = await ops.book(session.sessionId, memberId)
    setBusy(false)
    if (r.ok) {
      toast.success('Rezervasyon oluşturuldu.')
      setQuery('')
      await onChanged()
      searchRef.current?.focus()
    } else {
      toast.error(r.error ?? 'Rezervasyon oluşturulamadı.')
    }
  }

  const cancel = async (reservationId: string, name: string) => {
    setBusy(true)
    const r = await ops.cancel(reservationId)
    setBusy(false)
    if (r.ok) {
      toast.success(`${name} iptal edildi.`)
      await onChanged()
    } else {
      toast.error(r.error ?? 'İptal edilemedi.')
    }
  }

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (matches.length ? (a + 1) % matches.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (matches.length ? (a - 1 + matches.length) % matches.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const m = matches[active]
      if (m && !busy) void book(m.id)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <span className="font-heading text-h1 font-medium tabular-nums text-foreground">{hhmm(session.startsAt)}</span>
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-medium', cat.soft, cat.text)}>
            <span className={cn('size-1.5 rounded-full', cat.dot)} />
            {cat.label}
          </span>
        </div>
        <p className="mt-1 font-medium text-foreground">{session.serviceName}</p>
        <p className="text-xs text-muted-foreground">
          {session.trainerName ?? 'Eğitmen atanmadı'}
          {session.roomName ? ` · ${session.roomName}` : ''} · {roster.length}/{session.capacity} dolu
        </p>
      </div>

      {moving ? (
        <MovePicker
          reservationId={moving.reservationId}
          name={moving.name}
          ops={ops}
          onCancel={() => setMoving(null)}
          onDone={async () => {
            setMoving(null)
            await onChanged()
          }}
        />
      ) : recurring ? (
        <RecurringPicker
          sessionId={session.sessionId}
          memberId={recurring.memberId}
          name={recurring.name}
          ops={ops}
          onCancel={() => setRecurring(null)}
          onDone={async () => {
            setRecurring(null)
            await onChanged()
          }}
        />
      ) : (
        <>
          {/* inline booking */}
      {session.status === 'cancelled' ? (
        <div className="border-b border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">Bu ders iptal edildi.</div>
      ) : full ? (
        <WaitlistPanel
          sessionId={session.sessionId}
          capacity={session.capacity}
          members={members}
          bookedIds={bookedIds}
          ops={ops}
          onChanged={onChanged}
        />
      ) : (
        <div className="border-b border-border p-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/40">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              disabled={busy}
              placeholder="Üye ekle — isim veya telefon…"
              className="h-10 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
              aria-label="Üye ekle"
            />
          </div>
          {matches.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5">
              {matches.map((m, i) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onMouseMove={() => setActive(i)}
                    onClick={() => void book(m.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors disabled:opacity-50',
                      i === active ? 'bg-primary-soft text-primary' : 'hover:bg-muted',
                    )}
                  >
                    <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-[0.7rem] font-semibold', i === active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                      {m.fullName.slice(0, 2).toLocaleUpperCase('tr')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{m.fullName}</span>
                      <span className={cn('block truncate text-xs', i === active ? 'text-primary/70' : 'text-muted-foreground')}>{m.phone}</span>
                    </span>
                    {i === active ? <CornerDownLeftIcon className="size-3.5 shrink-0 opacity-70" /> : <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                  </button>
                </li>
              ))}
            </ul>
          ) : query.trim().length >= 2 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">Uygun üye yok.</p>
          ) : null}
        </div>
      )}

      {/* roster */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {roster.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Henüz rezervasyon yok.</p>
        ) : (
          <ul className="space-y-0.5">
            {roster.map((r) => (
              <li
                key={r.reservationId}
                className="group/row flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-muted"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[0.7rem] font-semibold text-primary">
                  {r.memberName.slice(0, 2).toLocaleUpperCase('tr')}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.memberName}</span>
                {confirmId === r.reservationId ? (
                  // Inline confirm — no popup (Doc 32 §2). Cancelling moves a credit, so it is never
                  // one stray click away.
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">İptal edilsin mi?</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setConfirmId(null)
                        void cancel(r.reservationId, r.memberName)
                      }}
                      className="rounded-md bg-danger/10 px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/20 disabled:opacity-50"
                    >
                      Evet, iptal et
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                    >
                      Vazgeç
                    </button>
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRecurring({ memberId: r.memberId, name: r.memberName })}
                      aria-label={`${r.memberName} için sabit rezervasyon`}
                      title="Her hafta tekrarla (sabit rezervasyon)"
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-primary-soft hover:text-primary focus-visible:opacity-100 group-hover/row:opacity-100 disabled:opacity-50"
                    >
                      <RepeatIcon className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setMoving({ reservationId: r.reservationId, name: r.memberName })}
                      aria-label={`${r.memberName} rezervasyonunu taşı`}
                      title="Başka bir derse taşı"
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-primary-soft hover:text-primary focus-visible:opacity-100 group-hover/row:opacity-100 disabled:opacity-50"
                    >
                      <ArrowLeftRightIcon className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmId(r.reservationId)}
                      aria-label={`${r.memberName} rezervasyonunu iptal et`}
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover/row:opacity-100 disabled:opacity-50"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
          </div>
        </>
      )}
    </div>
  )
}
