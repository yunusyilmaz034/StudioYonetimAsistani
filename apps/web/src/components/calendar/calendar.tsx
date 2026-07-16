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
  // Opt-in (DS v2): a day's rows sit on ONE card instead of each row carrying its own
  // border. Fewer rules, clearer grouping — but only correct once the screen's `renderRow`
  // is itself borderless, so each calendar opts in as it is redesigned.
  groupDaysInCard?: boolean
  // D23 — an optional marker for a day (a holiday, a closure). The engine stays data-agnostic:
  // it renders whatever the screen hands back, and knows nothing about what a holiday IS.
  renderDayMark?: (dayKey: string) => ReactNode
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
  groupDaysInCard = false,
  renderDayMark,
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
        groupDaysInCard={groupDaysInCard}
        renderDayMark={renderDayMark}
      />
    )
  }
  return (
    <DayList
      date={date}
      view={view}
      byDay={byDay}
      onSelect={onSelect}
      renderRow={renderRow}
      emptyLabel={emptyLabel}
      groupDaysInCard={groupDaysInCard}
      renderDayMark={renderDayMark}
    />
  )
}

function MonthGrid<T extends CalendarItem>({
  date,
  byDay,
  onSelect,
  renderChip,
  renderRow,
  monthCellMax,
  groupDaysInCard,
  renderDayMark,
}: {
  date: string
  byDay: Map<string, T[]>
  onSelect: (item: T) => void
  renderChip: (item: T) => ReactNode
  renderRow: (item: T) => ReactNode
  monthCellMax: number
  groupDaysInCard: boolean
  renderDayMark: ((dayKey: string) => ReactNode) | undefined
}) {
  const { days, year, month } = monthGridDays(date)
  const today = studioToday()
  const [popoverDay, setPopoverDay] = useState<string | null>(null)

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border shadow-sm">
        <div className="grid min-w-[42rem] grid-cols-7 gap-px bg-border">
          {WEEKDAYS_TR.map((w) => (
            <div key={w} className="bg-surface py-2 text-center text-xs font-medium text-muted-foreground">
              {w}
            </div>
          ))}
          {days.map((d) => {
            const list = byDay.get(d) ?? []
            const overflow = list.length - monthCellMax
            const inMonth = isInMonth(d, year, month)
            const isToday = d === today
            const isFocus = d === date && !isToday // the date being navigated to
            return (
              <div
                key={d}
                className={`relative min-h-32 space-y-1 rounded-md px-1.5 py-2 transition-[transform,box-shadow,background-color] duration-150 hover:z-20 hover:scale-[1.05] hover:bg-card hover:shadow-xl hover:ring-1 hover:ring-border ${
                  isToday
                    ? 'bg-primary-soft/50'
                    : isFocus
                      ? 'bg-primary-soft/25'
                      : inMonth
                        ? 'bg-surface'
                        : 'bg-background'
                }`}
              >
                {/* D23 — the day's mark. It is a BACKGROUND fact: it must not compete with the
                    `today` and `selected` treatments, which stay the strongest marks on screen. */}
                {renderDayMark ? renderDayMark(d) : null}
                {/* One emphasis language for the day number: today is the strongest, the focused
                    day the same shape a step quieter, everything else recedes. */}
                <div className="flex justify-end pb-0.5">
                  <span
                    className={`grid size-5.5 place-items-center rounded-md text-xs tabular-nums ${
                      isToday
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : isFocus
                          ? 'bg-primary-soft font-semibold text-primary'
                          : inMonth
                            ? 'text-muted-foreground'
                            : 'text-muted-foreground/50'
                    }`}
                  >
                    {Number(d.slice(8, 10))}
                  </span>
                </div>
                {/* Padding is kept tight horizontally on purpose: every pixel not spent on the
                    chip's frame is a character of the class name that survives truncation. */}
                {list.slice(0, monthCellMax).map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => onSelect(it)}
                    className="block w-full rounded-md px-1 py-1 text-left leading-[1.45] transition-colors hover:bg-primary-soft/70"
                  >
                    {renderChip(it)}
                  </button>
                ))}
                {overflow > 0 ? (
                  <button
                    type="button"
                    onClick={() => setPopoverDay(d)}
                    className="w-full rounded-md px-1 py-1 text-left text-xs font-medium text-primary transition-colors hover:bg-primary-soft/70"
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
          <div
            className={
              groupDaysInCard
                ? 'divide-y divide-border overflow-hidden rounded-xl border border-border bg-card'
                : 'space-y-2'
            }
          >
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
  groupDaysInCard,
  renderDayMark,
}: {
  date: string
  view: CalendarView
  byDay: Map<string, T[]>
  onSelect: (item: T) => void
  renderRow: (item: T) => ReactNode
  emptyLabel: string
  groupDaysInCard: boolean
  renderDayMark: ((dayKey: string) => ReactNode) | undefined
}) {
  const days = viewDays(date, view).filter((d) => (byDay.get(d)?.length ?? 0) > 0)
  const today = studioToday()

  if (days.length === 0) {
    return <EmptyState icon={CalendarIcon} title="Kayıt yok" description={emptyLabel} />
  }

  return (
    <div className="space-y-5">
      {days.map((d) => {
        const list = byDay.get(d) ?? []
        const rows = list.map((it) => (
          <button key={it.id} type="button" onClick={() => onSelect(it)} className="block w-full text-left">
            {renderRow(it)}
          </button>
        ))
        return (
          <div key={d} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className={`text-h3 font-semibold capitalize ${d === today ? 'text-primary' : 'text-foreground'}`}>
                {dayHeading(d)}
              </h3>
              <span className="text-xs tabular-nums text-muted-foreground">{list.length}</span>
              {renderDayMark ? renderDayMark(d) : null}
            </div>
            {groupDaysInCard ? (
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                {rows}
              </div>
            ) : (
              <div className="space-y-2">{rows}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
