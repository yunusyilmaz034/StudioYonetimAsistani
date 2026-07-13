
import { requirePageAccess } from '@/server/auth'
import { listAttendanceDay, studioToday } from '@/server/reservations-query'

import { AttendanceScreen } from './attendance-screen'

// Server component: authenticate, then read the studio's sessions + rosters for one
// day (two reads) and hand them to the client workspace. Attendance is marked on the
// offline /commands path (client), correction through a Server Action — both already
// built (v1.10). This screen only reads and orchestrates.
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const ctx = await requirePageAccess('/attendance')

  const { date } = await searchParams
  const today = studioToday()
  const dateStr = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today
  const sessions = await listAttendanceDay(ctx, dateStr)

  return <AttendanceScreen sessions={sessions} date={dateStr} today={today} />
}
