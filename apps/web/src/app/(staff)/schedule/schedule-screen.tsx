'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BanIcon, CalendarIcon, CopyIcon, DumbbellIcon, LayersIcon, PlusIcon, UsersIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Metric, MetricStrip } from '@/components/ui/metric'
import { PageHeader } from '@/components/ui/page-header'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Calendar,
  CalendarToolbar,
  dayKey,
  FilterSelect,
  mondayIndex,
  monthGridDays,
  shiftDate,
  timeLabel,
  viewDays,
  type CalendarView,
} from '@/components/calendar'
import { DAY_TYPE_CHIP, DAY_TYPE_LABEL, isClosedType, marksOn } from '@/lib/calendar-days'
import type { CalendarSession, ScheduleData } from '@/server/schedule-query'

import { DuplicateWeekDialog } from './duplicate-week-dialog'
import { RoomNotesBanner } from './room-notes-banner'
import { SessionForm } from './session-form'
import { SessionWorkspace } from './session-workspace'
import { TemplatePanel } from './template-panel'
import { EMPTY_FILTERS, occupancy, passesFilters, STATUS_LABEL, type Filters } from './types'

const STATUS_DOT: Record<string, string> = {
  scheduled: 'bg-primary',
  in_progress: 'bg-info',
  completed: 'bg-success',
  cancelled: 'bg-danger',
}

// Category → a soft cell tint (PF-13). Colour ONLY — no box changes; the calendar's layout is untouched
// (owner rule). The status dot still encodes status, so a cell now reads category (background) AND status
// (dot) at a glance. Colours are the same category hues the domain already uses (globals.css --cat-*).
const CAT_TINT: Record<string, string> = {
  pilates: 'bg-cat-pilates-soft',
  fitness: 'bg-cat-fitness-soft',
  private: 'bg-cat-private-soft',
}

export function ScheduleScreen({
  data,
  date,
  today,
  defaultBranchId,
}: {
  data: ScheduleData
  date: string
  today: string
  defaultBranchId: string | null
}) {
  const router = useRouter()
  const [view, setView] = useState<CalendarView>('month')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selected, setSelected] = useState<CalendarSession | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [dupOpen, setDupOpen] = useState(false)

  // Mobile default view is Agenda (UX-3); desktop keeps Month.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) setView('agenda')
  }, [])

  const goDate = (d: string) => router.push(`/schedule?date=${d}`)

  const branches = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of data.sessions) map.set(s.branchId, s.branchName)
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [data.sessions])

  const visible = useMemo(() => data.sessions.filter((s) => passesFilters(s, filters)), [data.sessions, filters])

  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)

  // The summary must describe exactly what is on screen. The query loads a whole month, so
  // it is scoped to the days the current view actually shows — otherwise Day view would
  // report the month's numbers. Capacity ignores cancelled sessions: a cancelled class has
  // no seats to sell.
  const summary = useMemo(() => {
    const days = new Set(view === 'month' ? monthGridDays(date).days : viewDays(date, view))
    const inView = visible.filter((s) => days.has(dayKey(s.startsAt)))
    const active = inView.filter((s) => s.status !== 'cancelled')
    return {
      group: active.filter((s) => s.category !== 'private').length,
      pt: active.filter((s) => s.category === 'private').length,
      booked: active.reduce((n, s) => n + s.bookedCount, 0),
      capacity: active.reduce((n, s) => n + s.capacity, 0),
      cancelled: inView.length - active.length,
    }
  }, [visible, date, view])

  const selectedLive = useMemo(
    () => (selected ? (data.sessions.find((s) => s.sessionId === selected.sessionId) ?? null) : null),
    [selected, data.sessions],
  )

  // Refresh in place — the session workspace stays open so the result is visible
  // where the action was taken (Single Workspace, UX-1).
  const onMutated = () => router.refresh()

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Ders Ajandası"
        actions={
          <>
            <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
              <LayersIcon />
              <span className="hidden sm:inline">Şablonlar</span>
            </Button>
            <Button variant="outline" onClick={() => setDupOpen(true)}>
              <CopyIcon />
              <span className="hidden sm:inline">Haftayı Tekrarla</span>
            </Button>
            <Button className="min-h-11 sm:min-h-0" onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              Yeni Seans
            </Button>
          </>
        }
      />

      {/* One control surface: date nav + view switch above, filters below. Three separate
          strips of chrome became a single grouped panel (Doc 20 §1: fewer lines). */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="p-3">
          <CalendarToolbar view={view} date={date} today={today} onViewChange={setView} onDateChange={goDate} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 p-3">
          <FilterSelect label="Ders" allLabel="Tüm Dersler" value={filters.serviceId} onChange={(v) => setFilters((f) => ({ ...f, serviceId: v }))} options={data.services} />
          <FilterSelect label="Salon" allLabel="Tüm Salonlar" value={filters.roomId} onChange={(v) => setFilters((f) => ({ ...f, roomId: v }))} options={data.rooms} />
          <FilterSelect label="Eğitmen" allLabel="Tüm Eğitmenler" value={filters.trainerId} onChange={(v) => setFilters((f) => ({ ...f, trainerId: v }))} options={data.staff.map((s) => ({ id: s.id, name: s.name }))} />
          {branches.length > 1 ? (
            <FilterSelect label="Şube" allLabel="Tüm Şubeler" value={filters.branchId} onChange={(v) => setFilters((f) => ({ ...f, branchId: v }))} options={branches} />
          ) : null}
          <FilterSelect
            label="Durum"
            allLabel="Tüm Durumlar"
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={Object.entries(STATUS_LABEL).map(([id, name]) => ({ id, name }))}
          />
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              Temizle
            </Button>
          ) : null}
        </div>
      </div>

      {/* What the owner needs before reading a single cell: how much is on, how full it is,
          and whether anything is cancelled. Derived from the sessions already loaded and
          the filters in force — no extra read. */}
      <MetricStrip>
        <Metric compact label="Grup dersi" value={summary.group} icon={CalendarIcon} />
        <Metric compact label="PT" value={summary.pt} icon={DumbbellIcon} />
        <Metric compact label="Rezervasyon" value={`${summary.booked}/${summary.capacity}`} icon={UsersIcon} />
        <Metric
          compact
          label="İptal"
          value={summary.cancelled}
          icon={BanIcon}
          tone={summary.cancelled > 0 ? 'danger' : 'default'}
        />
      </MetricStrip>

      {/* Active room notes — an operational banner ABOVE the calendar; the grid is untouched. */}
      <RoomNotesBanner branchId={filters.branchId || defaultBranchId} />

      {/* Calendar (shared engine) */}
      <Calendar
        view={view}
        date={date}
        items={visible.map((s) => ({ ...s, id: s.sessionId }))}
        onSelect={(s) => setSelected(s)}
        renderChip={(s) => <SessionChip session={s} />}
        renderRow={(s) => <SessionRow session={s} />}
        emptyLabel="Bu aralıkta planlı seans bulunmuyor."
        groupDaysInCard
        renderDayMark={(d) => {
          const marks = marksOn(data.calendarDays, d)
          if (marks.length === 0) return null
          return (
            <div className="flex flex-wrap gap-1">
              {marks.map((m) => (
                <span
                  key={m.id}
                  title={m.title}
                  className={`truncate rounded-md px-1.5 py-px text-[0.6875rem] font-medium ${DAY_TYPE_CHIP[m.type] ?? 'bg-muted text-muted-foreground'}`}
                >
                  {isClosedType(m.type) ? DAY_TYPE_LABEL[m.type] : m.title}
                </span>
              ))}
            </div>
          )
        }}
      />

      <SessionWorkspace
        session={selectedLive}
        rooms={data.rooms}
        staff={data.staff}
        onClose={() => setSelected(null)}
        onMutated={onMutated}
      />

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full gap-4 overflow-y-auto p-4 sm:max-w-md">
          <SheetHeader className="p-0">
            <SheetTitle>Yeni Seans</SheetTitle>
          </SheetHeader>
          <SessionForm
            data={data}
            defaultBranchId={defaultBranchId}
            defaultDate={date}
            onDone={() => {
              setCreateOpen(false)
              router.refresh()
            }}
          />
        </SheetContent>
      </Sheet>

      <TemplatePanel
        open={templatesOpen}
        data={data}
        defaultBranchId={defaultBranchId}
        onClose={() => setTemplatesOpen(false)}
        onMutated={() => router.refresh()}
      />


      <DuplicateWeekDialog
        open={dupOpen}
        weekStartDate={shiftDate(date, -mondayIndex(date))}
        onClose={() => setDupOpen(false)}
        onMutated={() => router.refresh()}
      />
    </main>
  )
}

// Pure visual renderers — the shared Calendar wraps each in a selectable button. Rows are
// deliberately borderless: the Calendar groups a day's rows onto one card (groupDaysInCard),
// so a border here would nest a box inside a box.
function SessionChip({ session }: { session: CalendarSession }) {
  const cancelled = session.status === 'cancelled'
  return (
    // A tighter gap and a 1px-smaller face buy several more characters of the class name
    // before it truncates — in a month cell that is the difference between reading it and not.
    // A cancelled session STAYS on the calendar (it reconciles with the "İPTAL" counter and is an
    // honest record), but it is faded well back so it never competes with a live class next to it —
    // colour/opacity only, the calendar's layout is untouched (owner rule).
    <span
      className={`flex w-full items-center gap-1 truncate rounded text-[0.6875rem] ${
        cancelled ? 'text-muted-foreground line-through opacity-50' : `text-foreground ${CAT_TINT[session.category] ?? ''}`
      }`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[session.status] ?? 'bg-muted-foreground'}`} />
      <span className="shrink-0 font-medium tabular-nums text-muted-foreground">{timeLabel(session.startsAt)}</span>
      <span className="truncate font-medium">{session.serviceName}</span>
      {session.category === 'private' ? <PtTag /> : null}
    </span>
  )
}

function SessionRow({ session }: { session: CalendarSession }) {
  const occ = occupancy(session.bookedCount, session.capacity)
  const cancelled = session.status === 'cancelled'
  return (
    <div
      className={`flex w-full items-center gap-3 px-3 py-3 transition-colors hover:bg-primary-soft/40 ${
        cancelled ? '' : (CAT_TINT[session.category] ?? '')
      }`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[session.status] ?? 'bg-muted-foreground'}`} />
      <span className={`shrink-0 text-sm font-medium tabular-nums ${cancelled ? 'text-muted-foreground' : 'text-foreground'}`}>
        {timeLabel(session.startsAt)}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1.5 truncate text-sm font-medium ${cancelled ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
          <span className="truncate">{session.serviceName}</span>
          {session.category === 'private' ? <PtTag /> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {session.trainerName ?? 'Eğitmen yok'}
          {session.roomName ? ` · ${session.roomName}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {session.bookedCount}/{session.capacity}
        </span>
        {cancelled ? <Badge variant="destructive">İptal</Badge> : <Badge className={occ.className}>{occ.label}</Badge>}
      </div>
    </div>
  )
}

// Group classes and PT must never blur together on the class calendar (owner, v1.20).
function PtTag() {
  return (
    <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[0.6875rem] font-medium text-muted-foreground">
      PT
    </span>
  )
}
