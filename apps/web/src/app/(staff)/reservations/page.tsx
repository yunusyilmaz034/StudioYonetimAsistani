import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { loadReservationCalendar } from '@/server/reservation-calendar-query'
import { studioToday } from '@/components/calendar'

import { ReservationsScreen } from './reservations-screen'

// The Reservation Calendar (v1.19) — reception's dense, member-name reservation
// calendar on the shared calendar engine (Month/Week/Day/Agenda). Clicking a session
// opens the same Session Workspace as the Class Calendar. Booking happens there.
export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; session?: string }>
}) {
  const ctx = await getTenantContext()
  if (!ctx) {
    redirect('/login')
  }
  const { date, session } = await searchParams
  const today = studioToday()
  const dateStr = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today

  const data = await loadReservationCalendar(ctx, dateStr)

  return (
    <ReservationsScreen
      data={data}
      date={dateStr}
      today={today}
      defaultBranchId={ctx.branchIds[0] ?? null}
      initialSessionId={session ?? null}
    />
  )
}
