'use client'

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { monthHeading, dayHeading, shiftByView, type CalendarView } from './date-utils'

const VIEW_LABEL: Record<CalendarView, string> = { month: 'Ay', week: 'Hafta', day: 'Gün', agenda: 'Ajanda' }

// The shared calendar toolbar: view switch (Ay/Hafta/Gün/Ajanda) + prev/next/today.
// State lives in the parent screen (URL or local); this just emits changes.
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
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex rounded-lg border border-border p-0.5">
        {views.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onViewChange(v)}
            className={`min-h-9 flex-1 rounded-md px-3 text-sm sm:flex-none ${
              view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
            }`}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Önceki" onClick={() => onDateChange(shiftByView(date, -1, view))}>
          <ChevronLeftIcon />
        </Button>
        <span className="min-w-40 text-center text-sm font-medium capitalize">{heading}</span>
        <Button variant="outline" size="icon" aria-label="Sonraki" onClick={() => onDateChange(shiftByView(date, 1, view))}>
          <ChevronRightIcon />
        </Button>
        <Button variant={date === today ? 'secondary' : 'ghost'} onClick={() => onDateChange(today)}>
          Bugün
        </Button>
      </div>
    </div>
  )
}
