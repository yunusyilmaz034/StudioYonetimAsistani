import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { listCalendarDaysAction } from '@/server/actions/calendar'

import { CalendarScreen } from './calendar-screen'

// D23 — the Studio Calendar. Information only: nothing on this screen cancels a class or moves a
// credit. The one bridge to D21 is an explicit button, and it opens a PREVIEW.
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const ctx = await getTenantContext()
  if (!ctx) redirect('/login')

  const { year } = await searchParams
  const y = year && /^\d{4}$/.test(year) ? Number(year) : new Date().getFullYear()
  const days = await listCalendarDaysAction({ from: `${y}-01-01`, to: `${y}-12-31` })

  return <CalendarScreen year={y} days={days} canEdit={ctx.role === 'owner'} />
}
