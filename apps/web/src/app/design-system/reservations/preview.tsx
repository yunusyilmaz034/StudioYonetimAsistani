'use client'

import type { CalendarSession } from '@/server/schedule-query'
import type { ReservationCalendarData, SessionRosterEntry } from '@/server/reservation-calendar-query'
import { ReservationsScreen } from '@/app/(staff)/reservations/reservations-screen'

// DEV-ONLY — the RESTORED calendar reservation agenda (owner: keep the old layout, only the colours
// change) rendered on mock data, so the new palette can be seen on the real calendar without a login.
// Opening a session would call server actions (they need a session); the calendar GRID is what this
// preview is for. Illustrative data only.

const DATE = '2026-07-15'
const at = (hhmmUtc: string, d = DATE) => Date.parse(`${d}T${hhmmUtc}:00Z`)

const base = (
  over: Partial<CalendarSession> & Pick<CalendarSession, 'sessionId' | 'serviceName' | 'category' | 'startsAt' | 'capacity'>,
): CalendarSession => ({
  serviceId: 'svc',
  roomId: 'room',
  roomName: 'Reformer Salonu',
  trainerId: 't1',
  trainerName: 'Işıl Hoca',
  branchId: 'b1',
  branchName: 'Mutlukent',
  assignedMemberId: null,
  assignedMemberName: null,
  endsAt: over.startsAt + 50 * 60_000,
  bookedCount: 0,
  status: 'scheduled',
  cancellationWindowHours: 6,
  cancellationWindowSource: 'studio',
  lateCancellationConsumesCredit: true,
  note: null,
  ...over,
})

const SESSIONS: CalendarSession[] = [
  base({ sessionId: 's1', serviceName: 'Reformer Pilates', category: 'pilates_group', startsAt: at('06:00'), capacity: 8, bookedCount: 6 }),
  base({ sessionId: 's2', serviceName: 'Reformer Pilates', category: 'pilates_group', startsAt: at('07:00'), capacity: 8, bookedCount: 8, trainerName: 'Reyhan Hoca' }),
  base({ sessionId: 's3', serviceName: 'Düet Pilates', category: 'pilates_group', startsAt: at('09:00'), capacity: 2, bookedCount: 2, roomName: 'Düet Salonu', trainerName: 'Buse Hoca' }),
  base({ sessionId: 's4', serviceName: 'PT', category: 'private', startsAt: at('11:00'), capacity: 1, bookedCount: 1, roomName: 'Özel PT Salonu' }),
  base({ sessionId: 's5', serviceName: 'Reformer Pilates', category: 'pilates_group', startsAt: at('15:00'), capacity: 8, bookedCount: 3, trainerName: 'Reyhan Hoca' }),
  base({ sessionId: 's6', serviceName: 'Reformer Pilates', category: 'pilates_group', startsAt: at('16:00'), capacity: 8, bookedCount: 5, trainerName: 'Buse Hoca' }),
  base({ sessionId: 'w1', serviceName: 'Reformer Pilates', category: 'pilates_group', startsAt: at('06:00', '2026-07-13'), capacity: 8, bookedCount: 7 }),
  base({ sessionId: 'w2', serviceName: 'Reformer Pilates', category: 'pilates_group', startsAt: at('07:00', '2026-07-14'), capacity: 8, bookedCount: 8, trainerName: 'Reyhan Hoca' }),
  base({ sessionId: 'w3', serviceName: 'Reformer Pilates', category: 'pilates_group', startsAt: at('06:00', '2026-07-16'), capacity: 8, bookedCount: 4 }),
  base({ sessionId: 'w4', serviceName: 'PT', category: 'private', startsAt: at('14:00', '2026-07-17'), capacity: 1, bookedCount: 1, roomName: 'Özel PT Salonu' }),
]

const roster = (sid: string, names: readonly string[]): SessionRosterEntry[] =>
  names.map((memberName, i) => ({ reservationId: `${sid}-${i}`, memberId: `m-${sid}-${i}`, memberName, status: 'booked' }))

const ROSTERS: Record<string, readonly SessionRosterEntry[]> = {
  s1: roster('s1', ['Ayşe Yıldız', 'Merve Kaya', 'Zeynep Demir', 'Elif Şahin', 'Selin Arslan', 'Deniz Aydın']),
  s2: roster('s2', ['Ceren Öztürk', 'Buse Çelik', 'İrem Koç', 'Gizem Yalçın', 'Ela Doğan', 'Naz Kurt', 'Ayşe Yıldız', 'Merve Kaya']),
  s3: roster('s3', ['Zeynep Demir', 'Elif Şahin']),
  s4: roster('s4', ['Selin Arslan']),
  s5: roster('s5', ['Deniz Aydın', 'Ceren Öztürk', 'Buse Çelik']),
}

const MOCK: ReservationCalendarData = {
  sessions: SESSIONS,
  services: [],
  rooms: [],
  staff: [],
  templates: [],
  calendarDays: [],
  rosters: ROSTERS,
}

export function ReservationCalendarPreview() {
  return <ReservationsScreen data={MOCK} date={DATE} today={DATE} defaultBranchId="b1" initialSessionId={null} />
}
