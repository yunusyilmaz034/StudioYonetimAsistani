'use server'

import {
  CalendarDayTypes,
  FirestoreCalendarRepository,
  importHolidays,
  markCalendarDay,
  removeCalendarDay,
  type CalendarDayType,
  type LocalDate,
  type StudioCalendarDay,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'
import { turkeyHolidayProvider, yearsWithReligiousHolidays } from '../holidays/turkey-provider'
import { calendarDeps } from '../operations-query'

// D23 — the Studio Calendar. It writes INFORMATION and nothing else: no session is cancelled, no
// credit moves, no package is extended by anything in this file. That is D21, and it only runs
// when the owner presses its own button.

// Marking the studio closed is a studio-level decision → owner. Reception may read the calendar
// (it changes what they see on the schedule) but not redraw the studio's year.
const OWNER = ['owner', 'platform_admin'] as const
const READ = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const time = z.string().regex(/^\d{2}:\d{2}$/)

export interface CalendarDayView {
  readonly id: string
  readonly dateFrom: string
  readonly dateTo: string
  readonly timeFrom: string | null
  readonly timeTo: string | null
  readonly type: CalendarDayType
  readonly title: string
  readonly note: string | null
  readonly source: 'manual' | 'provider'
}

const toView = (d: StudioCalendarDay): CalendarDayView => ({
  id: d.id,
  dateFrom: d.dateFrom,
  dateTo: d.dateTo,
  timeFrom: d.timeFrom,
  timeTo: d.timeTo,
  type: d.type,
  title: d.title,
  note: d.note,
  source: d.source,
})

export async function listCalendarDaysAction(input: unknown): Promise<readonly CalendarDayView[]> {
  const p = z.object({ from: date, to: date }).parse(input)
  const ctx = await requireTenantContext(READ)
  const days = await new FirestoreCalendarRepository(adminDb()).listDays(
    ctx,
    p.from as LocalDate,
    p.to as LocalDate,
  )
  return days.map(toView)
}

export async function markCalendarDayAction(input: unknown) {
  const p = z
    .object({
      dateFrom: date,
      dateTo: date,
      timeFrom: time.nullable().optional(),
      timeTo: time.nullable().optional(),
      type: z.enum(CalendarDayTypes),
      title: z.string().min(1),
      note: z.string().nullable().optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  return markCalendarDay(calendarDeps(), ctx, {
    dateFrom: p.dateFrom as LocalDate,
    dateTo: p.dateTo as LocalDate,
    timeFrom: p.timeFrom ?? null,
    timeTo: p.timeTo ?? null,
    type: p.type,
    title: p.title,
    note: p.note ?? null,
  })
}

export async function removeCalendarDayAction(input: unknown) {
  const p = z.object({ id: z.string().min(1) }).parse(input)
  return removeCalendarDay(calendarDeps(), await requireTenantContext(OWNER), p.id)
}

// D23.1 — import from the PROVIDER (a port; this one is the Turkish adapter). The days are
// snapshotted into our calendar: if the source later changes its answer, our history does not
// move. Manual days are never overwritten — the owner's edits outrank the source.
export async function importHolidaysAction(input: unknown) {
  const p = z.object({ year: z.number().int().min(2024).max(2035) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const res = await importHolidays(calendarDeps(), ctx, turkeyHolidayProvider, {
    country: 'TR',
    year: p.year,
  })
  if (!res.ok) return res
  return {
    ok: true as const,
    value: {
      ...res.value,
      // Honest about what the adapter can and cannot know: the religious holidays follow the
      // lunar calendar and are announced, not computed. A year outside the table imports the
      // fixed holidays only — and says so, rather than guessing.
      religiousIncluded: yearsWithReligiousHolidays.includes(p.year),
    },
  }
}
