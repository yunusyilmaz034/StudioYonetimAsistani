import { redirect } from 'next/navigation'

import { getTenantContext } from '@/server/auth'
import { listMembers } from '@/server/members-query'
import { loadReservationsWindow } from '@/server/reservations-workspace-query'

import { ReservationsScreen, type ReservationView } from './reservations-screen'

const OFFSET_MIN = 180
const DAY_MS = 86_400_000

const dayStartMs = (dateStr: string) => Date.parse(`${dateStr}T00:00:00Z`) - OFFSET_MIN * 60_000
const studioToday = () => new Date(Date.now() + OFFSET_MIN * 60_000).toISOString().slice(0, 10)
const mondayIndex = (dateStr: string) => (new Date(`${dateStr}T00:00:00Z`).getUTCDay() + 6) % 7
const shift = (dateStr: string, days: number) => {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function windowFor(dateStr: string, view: ReservationView): [number, number] {
  if (view === 'week') {
    const start = dayStartMs(shift(dateStr, -mondayIndex(dateStr)))
    return [start, start + 7 * DAY_MS]
  }
  if (view === 'agenda') {
    const start = dayStartMs(dateStr)
    return [start, start + 14 * DAY_MS]
  }
  const start = dayStartMs(dateStr)
  return [start, start + DAY_MS]
}

// Reception's reservation-operations screen (v1.17) — all reservations, reservation-
// first, over the existing booking/cancellation rules.
export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>
}) {
  const ctx = await getTenantContext()
  if (!ctx) {
    redirect('/login')
  }
  const { date, view } = await searchParams
  const today = studioToday()
  const dateStr = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today
  const mode: ReservationView = view === 'week' || view === 'agenda' ? view : 'day'
  const [from, to] = windowFor(dateStr, mode)

  const [data, members] = await Promise.all([
    loadReservationsWindow(ctx, from, to, Date.now()),
    listMembers(ctx),
  ])

  return (
    <ReservationsScreen
      data={data}
      members={members.filter((m) => m.status === 'active').map((m) => ({ id: m.id, fullName: m.fullName, phone: m.phone }))}
      date={dateStr}
      today={today}
      view={mode}
    />
  )
}
