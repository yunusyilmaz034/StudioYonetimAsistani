'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArmchairIcon, CalendarIcon, CircleCheckIcon, LayersIcon, SearchIcon, UsersIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Metric, MetricStrip } from '@/components/ui/metric'
import { PageHeader } from '@/components/ui/page-header'
import Link from 'next/link'
import {
  Calendar,
  CalendarToolbar,
  dayKey,
  FilterSelect,
  monthGridDays,
  timeLabel,
  viewDays,
  type CalendarView,
} from '@/components/calendar'
import type { CalendarSession } from '@/server/schedule-query'
import type { ReservationCalendarData, SessionRosterEntry } from '@/server/reservation-calendar-query'

import { SessionWorkspace } from '../schedule/session-workspace'
import { occupancy } from '../schedule/types'

const ALL = 'all'
const STATUS_DOT: Record<string, string> = {
  scheduled: 'bg-primary',
  in_progress: 'bg-info',
  completed: 'bg-success',
  cancelled: 'bg-danger',
}

export function ReservationsScreen({
  data,
  date,
  today,
  initialSessionId = null,
  showCancelledDefault = false,
}: {
  data: ReservationCalendarData
  date: string
  today: string
  defaultBranchId: string | null
  initialSessionId?: string | null
  // Seeds the "İptalleri göster" toggle from the studio setting (default off); re-entering resets it.
  showCancelledDefault?: boolean
}) {
  const router = useRouter()
  const [view, setView] = useState<CalendarView>('month')
  const [memberQuery, setMemberQuery] = useState('')
  const [trainer, setTrainer] = useState(ALL)
  const [service, setService] = useState(ALL)
  const [status, setStatus] = useState(ALL)
  const [showCancelled, setShowCancelled] = useState(showCancelledDefault)
  const [selected, setSelected] = useState<CalendarSession | null>(null)

  // Mobile default is Agenda (UX-3); desktop keeps Month.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) setView('agenda')
  }, [])

  // Re-open the session workspace when returning from a member drill-through
  // (?session=<id> is restored by the browser's back navigation).
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (initialSessionId) {
      const s = data.sessions.find((x) => x.sessionId === initialSessionId)
      if (s) setSelected(s)
    }
  }, [initialSessionId, data.sessions])

  // Keep the open session in the URL (no refetch) so a member drill-through + back
  // restores the calendar date AND the open session context.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams()
    params.set('date', date)
    if (selected) params.set('session', selected.sessionId)
    window.history.replaceState(window.history.state, '', `/reservations?${params.toString()}`)
  }, [selected, date])

  const goDate = (d: string) => router.push(`/reservations?date=${d}`)
  const rosterOf = (id: string): readonly SessionRosterEntry[] => data.rosters[id] ?? []

  const visible = useMemo(() => {
    const q = memberQuery.trim().toLocaleLowerCase('tr')
    return data.sessions.filter((s) => {
      if (trainer !== ALL && s.trainerId !== trainer) return false
      if (service !== ALL && s.serviceId !== service) return false
      if (status !== ALL && s.status !== status) return false
      // Hide cancelled by default; the toggle (or an explicit status=İptal) reveals them.
      if (s.status === 'cancelled' && !showCancelled && status !== 'cancelled') return false
      if (q) return (data.rosters[s.sessionId] ?? []).some((m) => m.memberName.toLocaleLowerCase('tr').includes(q))
      return true
    })
  }, [data.sessions, data.rosters, memberQuery, trainer, service, status, showCancelled])

  const selectedLive = useMemo(
    () => (selected ? (data.sessions.find((s) => s.sessionId === selected.sessionId) ?? null) : null),
    [selected, data.sessions],
  )

  const filtersActive = memberQuery !== '' || trainer !== ALL || service !== ALL || status !== ALL

  // Scoped to the days the current view actually shows — the query loads a month, so an
  // unscoped summary would report the month's numbers while Day view is on screen. Capacity
  // ignores cancelled sessions: a cancelled class has no seats to fill.
  const summary = useMemo(() => {
    const days = new Set(view === 'month' ? monthGridDays(date).days : viewDays(date, view))
    const inView = visible.filter((s) => days.has(dayKey(s.startsAt)))
    const active = inView.filter((s) => s.status !== 'cancelled')
    const booked = active.reduce((n, s) => n + s.bookedCount, 0)
    const capacity = active.reduce((n, s) => n + s.capacity, 0)
    return {
      sessions: active.length,
      booked,
      free: Math.max(0, capacity - booked),
      full: active.filter((s) => s.capacity > 0 && s.bookedCount >= s.capacity).length,
    }
  }, [visible, date, view])

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Rezervasyon Ajandası"
        actions={
          <Button variant="outline" render={<Link href="/reservations/bulk" />}>
            <LayersIcon />
            <span className="hidden sm:inline">Toplu İşlemler</span>
          </Button>
        }
      />

      {/* One control surface: date nav + view switch above, search + filters below. */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="p-3">
          <CalendarToolbar view={view} date={date} today={today} onViewChange={setView} onDateChange={goDate} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 p-3">
          <div className="relative min-w-52 flex-1">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Üye ara (bu üyenin seansları)…"
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
            />
          </div>
          <FilterSelect label="Eğitmen" allLabel="Tüm Eğitmenler" value={trainer} onChange={setTrainer} options={data.staff.map((s) => ({ id: s.id, name: s.name }))} />
          <FilterSelect label="Ders" allLabel="Tüm Dersler" value={service} onChange={setService} options={data.services} />
          <FilterSelect
            label="Durum"
            allLabel="Tüm Durumlar"
            value={status}
            onChange={setStatus}
            options={[
              { id: 'scheduled', name: 'Planlı' },
              { id: 'completed', name: 'Tamamlandı' },
              { id: 'cancelled', name: 'İptal' },
            ]}
          />
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)}
              className="size-4 accent-primary"
            />
            İptalleri göster
          </label>
          {filtersActive ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMemberQuery('')
                setTrainer(ALL)
                setService(ALL)
                setStatus(ALL)
              }}
            >
              Temizle
            </Button>
          ) : null}
        </div>
      </div>

      {/* This calendar answers one question before any cell is read: how much of what we are
          running is actually sold. Derived from the sessions already loaded — no extra read. */}
      <MetricStrip>
        <Metric compact label="Seans" value={summary.sessions} icon={CalendarIcon} />
        <Metric compact label="Rezervasyon" value={summary.booked} icon={UsersIcon} />
        <Metric compact label="Boş yer" value={summary.free} icon={ArmchairIcon} />
        <Metric compact label="Dolu seans" value={summary.full} icon={CircleCheckIcon} tone={summary.full > 0 ? 'success' : 'default'} />
      </MetricStrip>

      {/* Calendar (shared engine) — dense cells with member names */}
      <Calendar
        view={view}
        date={date}
        items={visible.map((s) => ({ ...s, id: s.sessionId }))}
        onSelect={(s) => setSelected(s)}
        monthCellMax={2}
        renderChip={(s) => <SessionChip session={s} roster={rosterOf(s.sessionId)} />}
        renderRow={(s) => <SessionRow session={s} roster={rosterOf(s.sessionId)} />}
        emptyLabel="Bu aralıkta seans bulunmuyor."
        groupDaysInCard
      />

      <SessionWorkspace
        session={selectedLive}
        rooms={data.rooms}
        staff={data.staff}
        onClose={() => setSelected(null)}
        onMutated={() => router.refresh()}
      />
    </main>
  )
}

// Dense month-cell block: header (time · service · occupancy) + member names — the old
// system's reservation-calendar density, kept. The accent rail carries the one signal that
// matters here (full vs. still sellable); everything else stays quiet so six names remain
// readable in a cell.
function SessionChip({ session, roster }: { session: CalendarSession; roster: readonly SessionRosterEntry[] }) {
  const full = session.capacity > 0 && session.bookedCount >= session.capacity
  const cancelled = session.status === 'cancelled'
  return (
    <div
      className={`rounded-md border-l-2 px-1 py-1 text-[11px] leading-[1.5] ${
        full ? 'border-danger bg-danger/5' : 'border-primary bg-primary-soft/40'
      } ${cancelled ? 'opacity-50 line-through' : ''}`}
    >
      <p className="flex items-center gap-1 truncate font-medium text-foreground">
        <span className="shrink-0 tabular-nums">{timeLabel(session.startsAt)}</span>
        <span className="truncate">{session.serviceName}</span>
        <span className={`shrink-0 tabular-nums ${full ? 'text-danger' : 'text-muted-foreground'}`}>
          {session.bookedCount}/{session.capacity}
        </span>
      </p>
      {/* The names ARE the content of this calendar — they read a step darker than a caption,
          without competing with the session line above them. */}
      {roster.slice(0, 6).map((m) => (
        <p key={m.reservationId} className="truncate text-foreground/70">
          {m.memberName}
        </p>
      ))}
      {roster.length > 6 ? <p className="font-medium text-primary">+{roster.length - 6} kişi</p> : null}
    </div>
  )
}

// Richer row for week/day/agenda + the day popover. Borderless: the Calendar groups a day's
// rows onto one card (groupDaysInCard).
function SessionRow({ session, roster }: { session: CalendarSession; roster: readonly SessionRosterEntry[] }) {
  const occ = occupancy(session.bookedCount, session.capacity)
  const cancelled = session.status === 'cancelled'
  return (
    <div className="px-3 py-3 transition-colors hover:bg-primary-soft/40">
      <div className="flex items-center gap-3">
        <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[session.status] ?? 'bg-muted-foreground'}`} />
        <span className={`shrink-0 text-sm font-medium tabular-nums ${cancelled ? 'text-muted-foreground' : 'text-foreground'}`}>
          {timeLabel(session.startsAt)}
        </span>
        <p className={`min-w-0 flex-1 truncate text-sm font-medium ${cancelled ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
          {session.serviceName}
          {session.trainerName ? <span className="font-normal text-muted-foreground"> · {session.trainerName}</span> : null}
        </p>
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums ${
            cancelled ? 'bg-muted text-muted-foreground' : occ.className
          }`}
        >
          {session.bookedCount}/{session.capacity}
        </span>
      </div>
      <p className={`mt-1 line-clamp-2 pl-6 text-xs ${roster.length > 0 ? 'text-foreground/70' : 'text-muted-foreground'}`}>
        {roster.length > 0 ? roster.map((m) => m.memberName).join(' · ') : 'Rezervasyon yok'}
      </p>
    </div>
  )
}
