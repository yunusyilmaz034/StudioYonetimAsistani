
import { requirePageAccess } from '@/server/auth'
import { getStudioSettingsAction } from '@/server/actions/settings'
import { loadSchedule, studioToday } from '@/server/schedule-query'

import { ScheduleScreen } from './schedule-screen'

// Server component: authenticate, then read the scheduling workspace data for the
// month around the focus date — sessions + the service/room/staff/template lists the
// pickers need. All mutations go through Server Actions (owner + reception, AD-51).
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const ctx = await requirePageAccess('/schedule')

  const { date } = await searchParams
  const today = studioToday()
  const dateStr = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today
  const [data, settings] = await Promise.all([loadSchedule(ctx, dateStr), getStudioSettingsAction()])

  return (
    <ScheduleScreen
      data={data}
      date={dateStr}
      today={today}
      defaultBranchId={ctx.branchIds[0] ?? null}
      showCancelledDefault={Boolean(settings?.showCancelledSessions)}
    />
  )
}
