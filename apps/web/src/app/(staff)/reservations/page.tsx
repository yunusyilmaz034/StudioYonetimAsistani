import { requirePageAccess } from '@/server/auth'
import { loadReservationCalendar } from '@/server/reservation-calendar-query'
import { listBookingMembersAction } from '@/server/actions/booking'
import { studioToday } from '@/components/calendar'

import { ReservationOperationsLive } from './reservation-operations'

// Reservation Operations (Plus Phase 2) — reception's single-surface booking screen. One place to
// see the day's classes, open a roster, and book with a name and Enter; no modal, no navigation.
// It replaces the old dense member-name calendar. The domain is untouched — this loads the same
// `loadReservationCalendar` read and calls the same trusted booking/cancel actions.
export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const ctx = await requirePageAccess('/reservations')
  const { date } = await searchParams
  const today = studioToday()
  const dateStr = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today

  const [data, members] = await Promise.all([
    loadReservationCalendar(ctx, dateStr),
    listBookingMembersAction(),
  ])

  return <ReservationOperationsLive initialData={data} initialDate={dateStr} today={today} members={members} />
}
