
import { requirePageAccess } from '@/server/auth'
import { getStudioSettingsAction } from '@/server/actions/settings'
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
  const ctx = await requirePageAccess('/reservations')
  const { date, session } = await searchParams
  const today = studioToday()
  const dateStr = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today

  const [data, settings] = await Promise.all([loadReservationCalendar(ctx, dateStr), getStudioSettingsAction()])

  return (
    <ReservationsScreen
      data={data}
      date={dateStr}
      today={today}
      defaultBranchId={ctx.branchIds[0] ?? null}
      initialSessionId={session ?? null}
      // OR-24 keeps backdating at the desk; trainers hold the rest of this screen (2026-08-03). Drawing
      // a button that the server will refuse is the fault we spent today removing, so it is not drawn.
      canBackdate={ctx.role !== 'trainer'}
      showCancelledDefault={Boolean(settings?.showCancelledSessions)}
    />
  )
}
