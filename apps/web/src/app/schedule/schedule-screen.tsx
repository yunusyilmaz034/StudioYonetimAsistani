'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, LayersIcon, PlusIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Toaster } from '@/components/ui/sonner'
import type { CalendarSession, ScheduleData } from '@/server/schedule-query'

import { SessionForm } from './session-form'
import { SessionSheet } from './session-sheet'
import { TemplatePanel } from './template-panel'
import {
  dayHeading,
  dayKey,
  EMPTY_FILTERS,
  mondayIndex,
  monthHeading,
  occupancy,
  passesFilters,
  shiftDate,
  STATUS_LABEL,
  timeLabel,
  WEEKDAYS_TR,
  type Filters,
  type ViewMode,
} from './types'

const STATUS_DOT: Record<string, string> = {
  scheduled: 'bg-primary',
  in_progress: 'bg-info',
  completed: 'bg-success',
  cancelled: 'bg-danger',
}

function shiftByView(dateStr: string, dir: number, mode: ViewMode): string {
  if (mode === 'month') {
    const parts = dateStr.split('-')
    const y = Number(parts[0])
    const m = Number(parts[1])
    const total = y * 12 + (m - 1) + dir
    const ny = Math.floor(total / 12)
    const nm = (total % 12) + 1
    return `${ny}-${String(nm).padStart(2, '0')}-01`
  }
  return shiftDate(dateStr, dir * (mode === 'week' ? 7 : 1))
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
  const [mode, setMode] = useState<ViewMode>('month')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selected, setSelected] = useState<CalendarSession | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)

  // Mobile default view is Agenda (UX-3); desktop keeps Month.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) setMode('agenda')
  }, [])

  const goDate = (d: string) => router.push(`/schedule?date=${d}`)

  const branches = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of data.sessions) map.set(s.branchId, s.branchName)
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [data.sessions])

  const visible = useMemo(() => data.sessions.filter((s) => passesFilters(s, filters)), [data.sessions, filters])

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarSession[]>()
    for (const s of visible) {
      const k = dayKey(s.startsAt)
      const list = map.get(k) ?? []
      list.push(s)
      map.set(k, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.startsAt - b.startsAt)
    return map
  }, [visible])

  const selectedLive = useMemo(
    () => (selected ? (data.sessions.find((s) => s.sessionId === selected.sessionId) ?? null) : null),
    [selected, data.sessions],
  )

  // Refresh in place — the session workspace stays open so the result is visible
  // where the action was taken (Single Workspace, UX-1).
  const onMutated = () => router.refresh()

  const heading = mode === 'month' ? monthHeading(date) : dayHeading(date)

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <Toaster />
      <PageHeader
        title="Takvim"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" render={<Link href="/" />}>
              Ana Sayfa
            </Button>
            <Button className="min-h-11 sm:min-h-0" onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              Yeni Seans
            </Button>
          </div>
        }
      />

      {/* View switch + date nav */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-lg border border-border p-0.5">
          {(['month', 'week', 'day', 'agenda'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`min-h-9 flex-1 rounded-md px-3 text-sm sm:flex-none ${
                mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              {m === 'month' ? 'Ay' : m === 'week' ? 'Hafta' : m === 'day' ? 'Gün' : 'Ajanda'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Önceki" onClick={() => goDate(shiftByView(date, -1, mode))}>
            <ChevronLeftIcon />
          </Button>
          <span className="min-w-40 text-center text-sm font-medium capitalize">{heading}</span>
          <Button variant="outline" size="icon" aria-label="Sonraki" onClick={() => goDate(shiftByView(date, 1, mode))}>
            <ChevronRightIcon />
          </Button>
          <Button variant={date === today ? 'secondary' : 'ghost'} onClick={() => goDate(today)}>
            Bugün
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

      {/* Calendar */}
      {mode === 'month' ? (
        <MonthGrid date={date} byDay={byDay} onSelect={setSelected} />
      ) : (
        <DayList date={date} mode={mode} byDay={byDay} onSelect={setSelected} />
      )}

      <SessionSheet
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
    </main>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: readonly { id: string; name: string }[]
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? 'all')}>
      <SelectTrigger size="sm" className="min-w-32">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}: Tümü</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SessionChip({ session, onSelect }: { session: CalendarSession; onSelect: (s: CalendarSession) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(session)}
      className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-xs hover:bg-muted ${
        session.status === 'cancelled' ? 'text-muted-foreground line-through' : ''
      }`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[session.status] ?? 'bg-muted-foreground'}`} />
      <span className="tabular-nums">{timeLabel(session.startsAt)}</span>
      <span className="truncate">{session.serviceName}</span>
    </button>
  )
}

function MonthGrid({
  date,
  byDay,
  onSelect,
}: {
  date: string
  byDay: Map<string, CalendarSession[]>
  onSelect: (s: CalendarSession) => void
}) {
  const parts = date.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  const first = `${y}-${String(m).padStart(2, '0')}-01`
  const gridStart = shiftDate(first, -mondayIndex(first)) // Monday on/before the 1st
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
  const days = Array.from({ length: 42 }, (_, i) => shiftDate(gridStart, i))

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[42rem] grid-cols-7 gap-px rounded-lg border border-border bg-border">
        {WEEKDAYS_TR.map((w) => (
          <div key={w} className="bg-surface p-2 text-center text-xs font-medium text-muted-foreground">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === `${y}-${String(m).padStart(2, '0')}`
          const list = byDay.get(d) ?? []
          return (
            <div key={d} className={`min-h-24 space-y-0.5 p-1 ${inMonth ? 'bg-surface' : 'bg-background'}`}>
              <div className={`text-right text-xs ${d === today ? 'font-bold text-primary' : 'text-muted-foreground'}`}>
                {Number(d.slice(8, 10))}
              </div>
              {list.slice(0, 4).map((s) => (
                <SessionChip key={s.sessionId} session={s} onSelect={onSelect} />
              ))}
              {list.length > 4 ? <div className="px-1 text-xs text-muted-foreground">+{list.length - 4}</div> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayList({
  date,
  mode,
  byDay,
  onSelect,
}: {
  date: string
  mode: ViewMode
  byDay: Map<string, CalendarSession[]>
  onSelect: (s: CalendarSession) => void
}) {
  // day → the focus day; week → its 7 days; agenda → focus day + next 13 days.
  const start = mode === 'week' ? shiftDate(date, -mondayIndex(date)) : date
  const span = mode === 'day' ? 1 : mode === 'week' ? 7 : 14
  const days = Array.from({ length: span }, (_, i) => shiftDate(start, i)).filter((d) => (byDay.get(d)?.length ?? 0) > 0)

  if (days.length === 0) {
    return <EmptyState icon={CalendarIcon} title="Seans yok" description="Bu aralıkta planlı seans bulunmuyor." />
  }

  return (
    <div className="space-y-4">
      {days.map((d) => (
        <div key={d}>
          <h3 className="mb-2 text-sm font-medium capitalize text-muted-foreground">{dayHeading(d)}</h3>
          <div className="space-y-2">
            {(byDay.get(d) ?? []).map((s) => (
              <SessionRow key={s.sessionId} session={s} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SessionRow({ session, onSelect }: { session: CalendarSession; onSelect: (s: CalendarSession) => void }) {
  const occ = occupancy(session.bookedCount, session.capacity)
  return (
    <button
      type="button"
      onClick={() => onSelect(session)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 text-left"
    >
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
    </button>
  )
}
