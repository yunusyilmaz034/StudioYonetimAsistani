'use server'

import { z } from 'zod'

import { requirePageAccess } from '../auth'
import { loadReservationCalendar, type ReservationCalendarData } from '../reservation-calendar-query'

// The reservation operations screen (Plus Phase 2) switches days without a page navigation, so it
// fetches a day's calendar over an action rather than a route change — reception flips through the
// week fluidly, and yesterday's roster is one keystroke away. Read-only and role-gated exactly like
// the page (`/reservations`): booking and cancelling still go through their own trusted actions.
export async function loadReservationDayAction(dateStr: unknown): Promise<ReservationCalendarData> {
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .parse(dateStr)
  const ctx = await requirePageAccess('/reservations')
  return loadReservationCalendar(ctx, date)
}
