'use client'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { monthHeading, dayHeading, shiftByView, type CalendarView } from './date-utils'

const VIEW_LABEL: Record<CalendarView, string> = { month: 'Ay', week: 'Hafta', day: 'Gün', agenda: 'Ajanda' }

// The shared calendar toolbar: date nav + view switch. State lives in the parent screen
// (URL or local); this just emits changes.
//
// DS v2 hierarchy: the DATE leads — it is the first thing the eye must land on, so it is the
// largest type on the screen and sits first in reading order. The view switch is deliberately
// demoted: small, quiet, on the far side. It is a setting you change occasionally, not the
// thing you read constantly.
export function CalendarToolbar({
  view,
  date,
  today,
  views = ['month', 'week', 'day', 'agenda'],
  onViewChange,
  onDateChange,
}: {
  view: CalendarView
  date: string
  today: string
  views?: readonly CalendarView[]
  onViewChange: (v: CalendarView) => void
  onDateChange: (date: string) => void
}) {
  const heading = view === 'month' ? monthHeading(date) : dayHeading(date)
  const isToday = date === today

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="truncate text-h1 font-semibold capitalize text-foreground">{heading}</h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Önceki" onClick={() => onDateChange(shiftByView(date, -1, view))}>
            <ChevronLeftIcon />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Sonraki" onClick={() => onDateChange(shiftByView(date, 1, view))}>
            <ChevronRightIcon />
          </Button>
          {!isToday ? (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onDateChange(today)}>
              Bugün
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 rounded-lg bg-muted p-0.5">
        {views.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => onViewChange(v)}
            className={`min-h-7 flex-1 rounded-md px-2.5 text-xs transition-colors sm:flex-none ${
              view === v
                ? 'bg-surface font-medium text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
    </div>
  )
}
