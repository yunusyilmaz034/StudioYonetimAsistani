'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarCheckIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { AttendanceOutcome, ReservationId } from '@studio/core'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Metric, MetricStrip } from '@/components/ui/metric'
import { PageHeader } from '@/components/ui/page-header'
import { Toaster } from '@/components/ui/sonner'
import { markAttendanceCommand } from '@/lib/commands'
import type { RosterEntry, SessionView } from '@/server/reservations-query'

import { RosterSheet } from './roster-sheet'
import type { Marks } from './types'

// Effective status = the optimistic mark if one exists, else the server status.
function effectiveStatus(entry: RosterEntry, marks: Marks): RosterEntry['status'] {
  return marks[entry.reservationId] ?? entry.status
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function humanDate(dateStr: string, today: string): string {
  if (dateStr === today) return 'Bugün'
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  })
}

function attendedCount(session: SessionView, marks: Marks): number {
  return session.roster.filter((e) => effectiveStatus(e, marks) === 'attended').length
}

function pendingCount(session: SessionView, marks: Marks): number {
  return session.roster.filter((e) => effectiveStatus(e, marks) === 'booked').length
}

export function AttendanceScreen({
  sessions,
  date,
  today,
}: {
  sessions: readonly SessionView[]
  date: string
  today: string
}) {
  const router = useRouter()
  const [marks, setMarks] = useState<Marks>({})
  const [selected, setSelected] = useState<SessionView | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  const goDate = (d: string) => router.push(`/attendance?date=${d}`)

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
      toast.error('İşaretlenemedi. Bağlantıyı kontrol edin.')
    }
  }, [])

  const bulkAttend = useCallback(async (session: SessionView) => {
    const pending = session.roster.filter((e) => (marks[e.reservationId] ?? e.status) === 'booked')
    if (pending.length === 0) return
    setBulkBusy(true)
    setMarks((prev) => {
      const next = { ...prev }
      for (const e of pending) next[e.reservationId] = 'attended'
      return next
    })
    const results = await Promise.allSettled(
      pending.map((e) => markAttendanceCommand({ reservationId: e.reservationId as ReservationId, outcome: 'attended' })),
    )
    const failedIds = pending.filter((_, i) => results[i]?.status === 'rejected').map((e) => e.reservationId)
    if (failedIds.length > 0) {
      setMarks((prev) => {
        const next = { ...prev }
        for (const id of failedIds) delete next[id]
        return next
      })
      toast.error(`${failedIds.length} üye işaretlenemedi.`)
    } else {
      toast.success(`${pending.length} üye katıldı işaretlendi.`)
    }
    setBulkBusy(false)
  }, [marks])

  // A correction is server-side and synchronous — re-read, and drop any optimistic
  // mark for that reservation so the fresh server state is authoritative.
  const onCorrected = useCallback((reservationId: string) => {
    setMarks((prev) => {
      const next = { ...prev }
      delete next[reservationId]
      return next
    })
    router.refresh()
  }, [router])

  // Keep the open sheet's data in sync with the latest server props after a refresh.
  const selectedLive = useMemo(
    () => (selected ? (sessions.find((s) => s.sessionId === selected.sessionId) ?? null) : null),
    [selected, sessions],
  )

  // This screen exists to answer one question — how much of the day is still unmarked — so
  // the day's totals lead, before any session row is read. Derived from the sessions already
  // loaded, optimistic marks included.
  const totals = useMemo(() => {
    const live = sessions.filter((s) => s.status !== 'cancelled')
    let attended = 0
    let pending = 0
    let booked = 0
    for (const s of live) {
      attended += attendedCount(s, marks)
      pending += pendingCount(s, marks)
      booked += s.roster.length
    }
    return { sessions: live.length, booked, attended, pending }
  }, [sessions, marks])

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6 lg:p-8">
      <Toaster />
      <PageHeader title="Yoklama" />

      {/* One control surface, same language as the calendars: the day leads, the nav is quiet. */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm">
        <h2 className="min-w-0 flex-1 truncate text-h1 font-semibold capitalize text-foreground">
          {humanDate(date, today)}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Önceki gün" onClick={() => goDate(shiftDate(date, -1))}>
            <ChevronLeftIcon />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Sonraki gün" onClick={() => goDate(shiftDate(date, 1))}>
            <ChevronRightIcon />
          </Button>
          {date !== today ? (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => goDate(today)}>
              Bugün
            </Button>
          ) : null}
        </div>
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          icon={CalendarCheckIcon}
          title="Bu gün için seans yok"
          description="Başka bir güne geçin."
        />
      ) : (
        <>
          <MetricStrip>
            <Metric compact label="Seans" value={totals.sessions} icon={CalendarCheckIcon} />
            <Metric compact label="Rezervasyon" value={totals.booked} icon={UsersIcon} />
            <Metric compact label="Katıldı" value={totals.attended} icon={CheckIcon} tone={totals.attended > 0 ? 'success' : 'default'} />
            <Metric compact label="Bekleyen" value={totals.pending} icon={ClockIcon} tone={totals.pending > 0 ? 'warning' : 'default'} />
          </MetricStrip>

          {/* Mobile: one card, rows inside — not a stack of boxes. */}
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm md:hidden">
            {sessions.map((s) => (
              <SessionCard key={s.sessionId} session={s} marks={marks} onOpen={() => setSelected(s)} timeLabel={timeLabel} />
            ))}
          </div>

          {/* Desktop: dense table on one surface. */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-4 py-2.5 text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">Saat</th>
                  <th className="px-4 py-2.5 text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">Ders</th>
                  <th className="px-4 py-2.5 text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">Eğitmen</th>
                  <th className="px-4 py-2.5 text-[0.6875rem] font-medium tracking-wide uppercase text-muted-foreground">Katıldı</th>
                  {/* Fixed width: the status vocabulary will grow (Boş / Devam Ediyor /
                      Tamamlandı / İptal) and a wider label must not reflow the row. */}
                  <th className="w-36 px-4 py-2.5 text-[0.6875rem] font-medium tracking-wide whitespace-nowrap uppercase text-muted-foreground">
                    Durum
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sessions.map((s) => {
                  const attended = attendedCount(s, marks)
                  const pending = pendingCount(s, marks)
                  return (
                    <tr
                      key={s.sessionId}
                      onClick={() => setSelected(s)}
                      className="cursor-pointer transition-colors hover:bg-primary-soft/40"
                    >
                      <td className="px-4 py-3 font-medium tabular-nums text-foreground">{timeLabel(s.startsAt)}</td>
                      <td className="px-4 py-3 font-medium text-foreground">{s.serviceName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{s.trainerName ?? '—'}</td>
                      <td className="px-4 py-3 tabular-nums">
                        <span className="font-medium text-foreground">
                          {attended}/{s.roster.length}
                        </span>
                        <span className="text-muted-foreground"> · {s.roster.length}/{s.capacity} dolu</span>
                      </td>
                      <td className="w-36 px-4 py-3 whitespace-nowrap">
                        {s.status === 'cancelled' ? (
                          <Badge variant="destructive">İptal</Badge>
                        ) : pending > 0 ? (
                          <Badge className="bg-warning/10 text-warning">{pending} kaldı</Badge>
                        ) : s.roster.length > 0 ? (
                          <Badge className="bg-success/10 text-success">Tamam</Badge>
                        ) : (
                          <span className="text-muted-foreground">Boş</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <RosterSheet
        session={selectedLive}
        marks={marks}
        bulkBusy={bulkBusy}
        onClose={() => setSelected(null)}
        onMark={mark}
        onBulk={bulkAttend}
        onCorrected={onCorrected}
        timeLabel={timeLabel}
      />
    </main>
  )
}

function SessionCard({
  session,
  marks,
  onOpen,
  timeLabel,
}: {
  session: SessionView
  marks: Marks
  onOpen: () => void
  timeLabel: (ms: number) => string
}) {
  const attended = attendedCount(session, marks)
  const pending = pendingCount(session, marks)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-primary-soft/40"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="shrink-0 tabular-nums">{timeLabel(session.startsAt)}</span>
          <span className="truncate">{session.serviceName}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {session.trainerName ?? 'Eğitmen yok'} · {session.roster.length}/{session.capacity} kişi
        </p>
      </div>
      <div className="shrink-0 text-right">
        {session.status === 'cancelled' ? (
          <Badge variant="destructive">İptal</Badge>
        ) : pending > 0 ? (
          <Badge className="bg-warning/10 text-warning">{pending} kaldı</Badge>
        ) : (
          <Badge className="bg-success/10 text-success">{attended} katıldı</Badge>
        )}
      </div>
    </button>
  )
}
