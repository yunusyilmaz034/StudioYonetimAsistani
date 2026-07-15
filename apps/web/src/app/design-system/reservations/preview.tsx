'use client'

import { useMemo, useRef } from 'react'

import type { Instant } from '@studio/core' // type-only: a runtime import would drag core's node deps into the client

import type { CalendarSession } from '@/server/schedule-query'
import type { ReservationCalendarData, SessionRosterEntry } from '@/server/reservation-calendar-query'
import {
  ReservationOperations,
  type BookingMember,
  type ReservationOps,
} from '@/app/(staff)/reservations/reservation-operations'

// A DEV-ONLY, interactive preview of the reservation operations screen (Doc 32 §2) on mock data:
// booking and cancelling really work here (against an in-memory day), so the flow can be FELT without
// a login or a database. Illustrative data only.

const DATE = '2026-07-15'
const at = (hhmmUtc: string) => Date.parse(`${DATE}T${hhmmUtc}:00Z`) // Istanbul = UTC+3

const base = (over: Partial<CalendarSession> & Pick<CalendarSession, 'sessionId' | 'serviceName' | 'category' | 'startsAt' | 'capacity'>): CalendarSession => ({
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
  base({ sessionId: 's1', serviceName: 'Reformer Pilates', category: 'pilates_group', startsAt: at('06:00'), capacity: 8, trainerName: 'Işıl Hoca' }),
  base({ sessionId: 's2', serviceName: 'Reformer Pilates', category: 'pilates_group', startsAt: at('07:00'), capacity: 8, trainerName: 'Reyhan Hoca' }),
  base({ sessionId: 's3', serviceName: 'Düet Pilates', category: 'pilates_group', startsAt: at('09:00'), capacity: 2, roomName: 'Düet Salonu', trainerName: 'Buse Hoca' }),
  base({ sessionId: 's4', serviceName: 'PT', category: 'private', startsAt: at('11:00'), capacity: 1, roomName: 'Özel PT Salonu', trainerName: 'Işıl Hoca' }),
  base({ sessionId: 's5', serviceName: 'Reformer Pilates', category: 'pilates_group', startsAt: at('15:00'), capacity: 8, trainerName: 'Reyhan Hoca' }),
  base({ sessionId: 's6', serviceName: 'Reformer Pilates', category: 'pilates_group', startsAt: at('16:00'), capacity: 8, trainerName: 'Buse Hoca' }),
]

const NAMES = [
  'Ayşe Yıldız', 'Merve Kaya', 'Zeynep Demir', 'Elif Şahin', 'Selin Arslan', 'Deniz Aydın',
  'Ceren Öztürk', 'Buse Çelik', 'İrem Koç', 'Gizem Yalçın', 'Ela Doğan', 'Naz Kurt',
]

const MEMBERS: BookingMember[] = NAMES.map((fullName, i) => ({
  id: `m${i}`,
  fullName,
  phone: `+90 53${i} ${100 + i} ${20 + i} ${10 + i}`,
}))

const roster = (names: readonly string[]): SessionRosterEntry[] =>
  names.map((n) => {
    const m = MEMBERS.find((x) => x.fullName === n)!
    return { reservationId: `r-${m.id}`, memberId: m.id, memberName: m.fullName, status: 'booked' }
  })

const INITIAL_ROSTERS: Record<string, SessionRosterEntry[]> = {
  s1: roster(['Ayşe Yıldız', 'Merve Kaya', 'Zeynep Demir', 'Elif Şahin', 'Selin Arslan', 'Deniz Aydın']),
  s2: roster(['Ceren Öztürk', 'Buse Çelik', 'İrem Koç', 'Gizem Yalçın', 'Ela Doğan', 'Naz Kurt', 'Ayşe Yıldız', 'Merve Kaya']),
  s3: roster(['Zeynep Demir', 'Elif Şahin']),
  s4: roster(['Selin Arslan']),
  s5: roster(['Deniz Aydın', 'Ceren Öztürk', 'Buse Çelik']),
  s6: [],
}

export function ReservationPreview() {
  // A mutable in-memory day so book/cancel actually change the roster in the preview.
  const store = useRef<Record<string, SessionRosterEntry[]>>(
    Object.fromEntries(Object.entries(INITIAL_ROSTERS).map(([k, v]) => [k, [...v]])),
  )
  // A parallel in-memory waitlist for the full-class flow (s2 starts full at 8/8).
  const wl = useRef<Record<string, { entryId: string; memberId: string; memberName: string }[]>>({
    s2: [{ entryId: 'w-s2-m2', memberId: 'm2', memberName: 'Zeynep Demir' }],
  })

  const initial: ReservationCalendarData = useMemo(
    () => ({
      sessions: SESSIONS,
      services: [],
      rooms: [],
      staff: [],
      templates: [],
      calendarDays: [],
      rosters: store.current,
    }),
    [],
  )

  const ops: ReservationOps = useMemo(
    () => ({
      loadDay: async () => ({
        sessions: SESSIONS,
        services: [],
        rooms: [],
        staff: [],
        templates: [],
        calendarDays: [],
        rosters: Object.fromEntries(Object.entries(store.current).map(([k, v]) => [k, [...v]])),
      }),
      book: async (sessionId, memberId) => {
        const m = MEMBERS.find((x) => x.id === memberId)
        if (!m) return { ok: false, error: 'Üye bulunamadı.' }
        ;(store.current[sessionId] ??= []).push({
          reservationId: `r-new-${sessionId}-${memberId}`,
          memberId,
          memberName: m.fullName,
          status: 'booked',
        })
        return { ok: true }
      },
      cancel: async (reservationId) => {
        for (const k of Object.keys(store.current)) {
          store.current[k] = store.current[k]!.filter((r) => r.reservationId !== reservationId)
        }
        return { ok: true }
      },
      moveTargets: async () =>
        SESSIONS.filter((s) => (store.current[s.sessionId]?.length ?? 0) < s.capacity).map((s) => ({
          sessionId: s.sessionId,
          serviceName: s.serviceName,
          trainerName: s.trainerName,
          roomName: s.roomName,
          startsAt: s.startsAt,
          capacity: s.capacity,
          bookedCount: store.current[s.sessionId]?.length ?? 0,
        })),
      move: async (reservationId, targetSessionId) => {
        let moved: SessionRosterEntry | undefined
        for (const k of Object.keys(store.current)) {
          const hit = store.current[k]!.find((r) => r.reservationId === reservationId)
          if (hit) {
            moved = hit
            store.current[k] = store.current[k]!.filter((r) => r.reservationId !== reservationId)
          }
        }
        if (moved) (store.current[targetSessionId] ??= []).push(moved)
        return { ok: true }
      },
      listWaitlist: async (sessionId) =>
        (wl.current[sessionId] ?? []).map((e, i) => ({
          entryId: e.entryId,
          memberId: e.memberId,
          memberName: e.memberName,
          phoneLast4: '0000',
          status: 'waiting',
          joinedAt: 0,
          position: i + 1,
        })),
      joinWaitlist: async (sessionId, memberId) => {
        const m = MEMBERS.find((x) => x.id === memberId)
        if (!m) return { ok: false, error: 'Üye bulunamadı.' }
        ;(wl.current[sessionId] ??= []).push({ entryId: `w-${sessionId}-${memberId}`, memberId, memberName: m.fullName })
        return { ok: true }
      },
      leaveWaitlist: async (entryId) => {
        for (const k of Object.keys(wl.current)) wl.current[k] = wl.current[k]!.filter((e) => e.entryId !== entryId)
        return { ok: true }
      },
      promoteWaitlist: async (entryId) => {
        for (const sid of Object.keys(wl.current)) {
          const entry = wl.current[sid]!.find((e) => e.entryId === entryId)
          if (!entry) continue
          const cap = SESSIONS.find((s) => s.sessionId === sid)?.capacity ?? 0
          if ((store.current[sid]?.length ?? 0) >= cap) {
            return { ok: false, error: 'Ders hâlâ dolu — sıradaki yerini korudu.' }
          }
          // A seat is open — promotion books her, exactly like the real promoteFromWaitlist.
          ;(store.current[sid] ??= []).push({
            reservationId: `r-promoted-${entry.memberId}`,
            memberId: entry.memberId,
            memberName: entry.memberName,
            status: 'booked',
          })
          wl.current[sid] = wl.current[sid]!.filter((e) => e.entryId !== entryId)
          return { ok: true }
        }
        return { ok: false, error: 'Bulunamadı.' }
      },
      previewRecurring: async (_sessionId, _memberId, weeks) => ({
        toBook: Array.from({ length: Math.max(0, weeks - 2) }, (_, i) => ({
          weekOffset: i + 1,
          date: `2026-07-${String(15 + (i + 1) * 7).padStart(2, '0')}`,
          sessionId: 's1',
          startsAt: at('06:00') as unknown as Instant,
          entitlementId: 'e1',
          entitlementName: 'Reformer 8 Ders',
        })),
        skipped: [
          { weekOffset: 3, date: '2026-07-29', sessionId: null, reason: 'no_session' as const },
          { weekOffset: 5, date: '2026-08-12', sessionId: 's1', reason: 'session_full' as const },
        ],
      }),
      applyRecurring: async (_sessionId, _memberId, weeks) => ({ ok: true, booked: Math.max(0, weeks - 2), failed: 0 }),
    }),
    [],
  )

  return (
    <div className="bg-background">
      <ReservationOperations initialData={initial} initialDate={DATE} today={DATE} members={MEMBERS} ops={ops} />
    </div>
  )
}
