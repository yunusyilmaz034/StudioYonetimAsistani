'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SearchIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Toaster } from '@/components/ui/sonner'
import {
  Calendar,
  CalendarToolbar,
  FilterSelect,
  timeLabel,
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
}: {
  data: ReservationCalendarData
  date: string
  today: string
  defaultBranchId: string | null
  initialSessionId?: string | null
}) {
  const router = useRouter()
  const [view, setView] = useState<CalendarView>('month')
  const [memberQuery, setMemberQuery] = useState('')
  const [trainer, setTrainer] = useState(ALL)
  const [service, setService] = useState(ALL)
  const [status, setStatus] = useState(ALL)
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
      if (q) return (data.rosters[s.sessionId] ?? []).some((m) => m.memberName.toLocaleLowerCase('tr').includes(q))
      return true
    })
  }, [data.sessions, data.rosters, memberQuery, trainer, service, status])

  const selectedLive = useMemo(
    () => (selected ? (data.sessions.find((s) => s.sessionId === selected.sessionId) ?? null) : null),
    [selected, data.sessions],
  )

  const filtersActive = memberQuery !== '' || trainer !== ALL || service !== ALL || status !== ALL

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <Toaster />
      <PageHeader title="Rezervasyon Ajandası" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CalendarToolbar view={view} date={date} today={today} onViewChange={setView} onDateChange={goDate} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Üye ara (bu üyenin seansları)…"
            value={memberQuery}
            onChange={(e) => setMemberQuery(e.target.value)}
          />
        </div>
        <FilterSelect label="Eğitmen" value={trainer} onChange={setTrainer} options={data.staff.map((s) => ({ id: s.id, name: s.name }))} />
        <FilterSelect label="Ders" value={service} onChange={setService} options={data.services} />
        <FilterSelect
          label="Durum"
          value={status}
          onChange={setStatus}
          options={[
            { id: 'scheduled', name: 'Planlı' },
            { id: 'completed', name: 'Tamamlandı' },
            { id: 'cancelled', name: 'İptal' },
          ]}
        />
        {filtersActive ? (
          <Button
            variant="ghost"
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
// system's reservation-calendar density.
function SessionChip({ session, roster }: { session: CalendarSession; roster: readonly SessionRosterEntry[] }) {
  const full = session.capacity > 0 && session.bookedCount >= session.capacity
  return (
    <div
      className={`rounded border-l-2 px-1 py-0.5 text-[11px] leading-tight ${
        full ? 'border-danger bg-danger/5' : 'border-primary bg-muted/40'
      } ${session.status === 'cancelled' ? 'opacity-50 line-through' : ''}`}
    >
      <p className="truncate font-medium text-foreground">
        <span className="tabular-nums">{timeLabel(session.startsAt)}</span> {session.serviceName}{' '}
        <span className="tabular-nums text-muted-foreground">
          ({session.bookedCount}/{session.capacity})
        </span>
      </p>
      {roster.slice(0, 6).map((m) => (
        <p key={m.reservationId} className="truncate text-muted-foreground">
          {m.memberName}
        </p>
      ))}
      {roster.length > 6 ? <p className="text-muted-foreground">+{roster.length - 6} kişi</p> : null}
    </div>
  )
}

// Richer row for week/day/agenda + the day popover.
function SessionRow({ session, roster }: { session: CalendarSession; roster: readonly SessionRosterEntry[] }) {
  const occ = occupancy(session.bookedCount, session.capacity)
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[session.status] ?? 'bg-muted-foreground'}`} />
          <p className={`truncate font-medium ${session.status === 'cancelled' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
            <span className="tabular-nums">{timeLabel(session.startsAt)}</span> · {session.serviceName}
            {session.trainerName ? <span className="text-muted-foreground"> · {session.trainerName}</span> : null}
          </p>
        </div>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${session.status === 'cancelled' ? 'bg-muted text-muted-foreground' : occ.className}`}
        >
          {session.bookedCount}/{session.capacity}
        </span>
      </div>
      {roster.length > 0 ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{roster.map((m) => m.memberName).join(' · ')}</p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Rezervasyon yok</p>
      )}
    </div>
  )
}
