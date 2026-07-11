'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { CalendarIcon } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'

import {
  dayHeading,
  dayKey,
  isInMonth,
  monthGridDays,
  studioToday,
  viewDays,
  WEEKDAYS_TR,
  type CalendarView,
} from './date-utils'

// The shared calendar engine. Data-agnostic: it groups items by studio-local day and
// renders Month / Week / Day / Agenda, with an interactive "+N etkinlik" day popover for
// month cells that overflow. The Class Calendar and the Reservation Calendar both drive
// it — each supplies its own item shape and two renderers (a compact month chip and a
// rich row); click handling and the popover live here.

export interface CalendarItem {
  readonly id: string
  readonly startsAt: number
}

interface CalendarProps<T extends CalendarItem> {
  view: CalendarView
  date: string // focus date 'YYYY-MM-DD'
  items: readonly T[]
  onSelect: (item: T) => void
  renderChip: (item: T) => ReactNode // compact, for month cells + overflow count
  renderRow: (item: T) => ReactNode // rich, for week/day/agenda + the day popover
  monthCellMax?: number // chips shown in a month cell before "+N" (default 4)
  emptyLabel?: string
}

export function Calendar<T extends CalendarItem>({
  view,
  date,
  items,
  onSelect,
  renderChip,
  renderRow,
  monthCellMax = 4,
  emptyLabel = 'Bu aralıkta kayıt yok.',
}: CalendarProps<T>) {
  const byDay = useMemo(() => {
    const map = new Map<string, T[]>()
    for (const it of items) {
      const k = dayKey(it.startsAt)
      const list = map.get(k) ?? []
      list.push(it)
      map.set(k, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.startsAt - b.startsAt)
    return map
  }, [items])

  if (view === 'month') {
    return (
      <MonthGrid
        date={date}
        byDay={byDay}
        onSelect={onSelect}
        renderChip={renderChip}
        renderRow={renderRow}
        monthCellMax={monthCellMax}
      />
    )
  }
  return <DayList date={date} view={view} byDay={byDay} onSelect={onSelect} renderRow={renderRow} emptyLabel={emptyLabel} />
}

function MonthGrid<T extends CalendarItem>({
  date,
  byDay,
  onSelect,
  renderChip,
  renderRow,
  monthCellMax,
}: {
  date: string
  byDay: Map<string, T[]>
  onSelect: (item: T) => void
  renderChip: (item: T) => ReactNode
  renderRow: (item: T) => ReactNode
  monthCellMax: number
}) {
  const { days, year, month } = monthGridDays(date)
  const today = studioToday()
  const [popoverDay, setPopoverDay] = useState<string | null>(null)

  return (
    <>
      <div className="overflow-x-auto">
        <div className="grid min-w-[42rem] grid-cols-7 gap-px rounded-lg border border-border bg-border">
          {WEEKDAYS_TR.map((w) => (
            <div key={w} className="bg-surface p-2 text-center text-xs font-medium text-muted-foreground">
              {w}
            </div>
          ))}
          {days.map((d) => {
            const list = byDay.get(d) ?? []
            const overflow = list.length - monthCellMax
            return (
              <div key={d} className={`min-h-24 space-y-0.5 p-1 ${isInMonth(d, year, month) ? 'bg-surface' : 'bg-background'}`}>
                <div className={`text-right text-xs ${d === today ? 'font-bold text-primary' : 'text-muted-foreground'}`}>
                  {Number(d.slice(8, 10))}
                </div>
                {list.slice(0, monthCellMax).map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => onSelect(it)}
                    className="block w-full rounded px-1 py-0.5 text-left hover:bg-muted"
                  >
                    {renderChip(it)}
                  </button>
                ))}
                {overflow > 0 ? (
                  <button
                    type="button"
                    onClick={() => setPopoverDay(d)}
                    className="w-full rounded px-1 py-0.5 text-left text-xs font-medium text-primary hover:bg-muted"
                  >
                    +{overflow} etkinlik
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      {/* "+N etkinlik" day popover — a wide, readable panel over the calendar. */}
      <Dialog open={popoverDay !== null} onOpenChange={(o) => (o ? null : setPopoverDay(null))}>
        <DialogContent className="max-h-[80vh] gap-3 overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="capitalize">{popoverDay ? dayHeading(popoverDay) : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {(popoverDay ? (byDay.get(popoverDay) ?? []) : []).map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => {
                  setPopoverDay(null)
                  onSelect(it)
                }}
                className="block w-full text-left"
              >
                {renderRow(it)}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DayList<T extends CalendarItem>({
  date,
  view,
  byDay,
  onSelect,
  renderRow,
  emptyLabel,
}: {
  date: string
  view: CalendarView
  byDay: Map<string, T[]>
  onSelect: (item: T) => void
  renderRow: (item: T) => ReactNode
  emptyLabel: string
}) {
  const days = viewDays(date, view).filter((d) => (byDay.get(d)?.length ?? 0) > 0)

  if (days.length === 0) {
    return <EmptyState icon={CalendarIcon} title="Kayıt yok" description={emptyLabel} />
  }

  return (
    <div className="space-y-4">
      {days.map((d) => (
        <div key={d}>
          <h3 className="mb-2 text-sm font-medium capitalize text-muted-foreground">{dayHeading(d)}</h3>
          <div className="space-y-2">
            {(byDay.get(d) ?? []).map((it) => (
              <button key={it.id} type="button" onClick={() => onSelect(it)} className="block w-full text-left">
                {renderRow(it)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
