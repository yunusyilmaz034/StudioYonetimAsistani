'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CopyIcon, LayersIcon, PlusIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import {
  Calendar,
  CalendarToolbar,
  FilterSelect,
  mondayIndex,
  shiftDate,
  timeLabel,
  type CalendarView,
} from '@/components/calendar'
import type { CalendarSession, ScheduleData } from '@/server/schedule-query'

import { DuplicateWeekDialog } from './duplicate-week-dialog'
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

  const selectedLive = useMemo(
    () => (selected ? (data.sessions.find((s) => s.sessionId === selected.sessionId) ?? null) : null),
    [selected, data.sessions],
  )

  // Refresh in place — the session workspace stays open so the result is visible
  // where the action was taken (Single Workspace, UX-1).
  const onMutated = () => router.refresh()

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <Toaster />
      <PageHeader
        title="Ders Ajandası"
        actions={
          <Button className="min-h-11 sm:min-h-0" onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            Yeni Seans
          </Button>
        }
      />

      {/* View switch + date nav (shared) + templates */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CalendarToolbar view={view} date={date} today={today} onViewChange={setView} onDateChange={goDate} />
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setDupOpen(true)}>
            <CopyIcon />
            <span className="hidden sm:inline">Haftayı Tekrarla</span>
          </Button>
          <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
            <LayersIcon />
            <span className="hidden sm:inline">Şablonlar</span>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <FilterSelect label="Ders" value={filters.serviceId} onChange={(v) => setFilters((f) => ({ ...f, serviceId: v }))} options={data.services} />
        <FilterSelect label="Salon" value={filters.roomId} onChange={(v) => setFilters((f) => ({ ...f, roomId: v }))} options={data.rooms} />
        <FilterSelect label="Eğitmen" value={filters.trainerId} onChange={(v) => setFilters((f) => ({ ...f, trainerId: v }))} options={data.staff.map((s) => ({ id: s.id, name: s.name }))} />
        {branches.length > 1 ? (
          <FilterSelect label="Şube" value={filters.branchId} onChange={(v) => setFilters((f) => ({ ...f, branchId: v }))} options={branches} />
        ) : null}
        <FilterSelect
          label="Durum"
          value={filters.status}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          options={Object.entries(STATUS_LABEL).map(([id, name]) => ({ id, name }))}
        />
        {JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) ? (
          <Button variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
            Temizle
          </Button>
        ) : null}
      </div>

      {/* Calendar (shared engine) */}
      <Calendar
        view={view}
        date={date}
        items={visible.map((s) => ({ ...s, id: s.sessionId }))}
        onSelect={(s) => setSelected(s)}
        renderChip={(s) => <SessionChip session={s} />}
        renderRow={(s) => <SessionRow session={s} />}
        emptyLabel="Bu aralıkta planlı seans bulunmuyor."
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

// Pure visual renderers — the shared Calendar wraps each in a selectable button.
function SessionChip({ session }: { session: CalendarSession }) {
  return (
    <span
      className={`flex w-full items-center gap-1 truncate text-xs ${
        session.status === 'cancelled' ? 'text-muted-foreground line-through' : ''
      }`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[session.status] ?? 'bg-muted-foreground'}`} />
      <span className="tabular-nums">{timeLabel(session.startsAt)}</span>
      <span className="truncate">{session.serviceName}</span>
    </span>
  )
}

function SessionRow({ session }: { session: CalendarSession }) {
  const occ = occupancy(session.bookedCount, session.capacity)
  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[session.status] ?? 'bg-muted-foreground'}`} />
        <div className="min-w-0">
          <p className={`truncate font-medium ${session.status === 'cancelled' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
            <span className="tabular-nums">{timeLabel(session.startsAt)}</span> · {session.serviceName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {session.trainerName ?? 'Eğitmen yok'}
            {session.roomName ? ` · ${session.roomName}` : ''}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {session.bookedCount}/{session.capacity}
        </span>
        {session.status === 'cancelled' ? (
          <Badge variant="destructive">İptal</Badge>
        ) : (
          <Badge className={occ.className}>{occ.label}</Badge>
        )}
      </div>
    </div>
  )
}
