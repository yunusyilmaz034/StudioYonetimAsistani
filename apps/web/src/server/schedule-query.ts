import {
  FirestoreIdentityRepository,
  FirestoreSchedulingRepository,
  instant,
  type ClassSessionStatus,
  type TenantContext,
} from '@studio/core'

import { adminDb } from './firebase-admin'

// Server-only reads for the scheduling workspace. AD-52: +180 for the Türkiye studio
// (a per-studio IANA timezone arrives later, seamless). Range computation only.
const STUDIO_UTC_OFFSET_MIN = 180
const DAY_MS = 86_400_000

export interface CalendarSession {
  readonly sessionId: string
  readonly serviceId: string
  readonly serviceName: string
  readonly roomId: string | null
  readonly roomName: string | null
  readonly trainerId: string | null
  readonly trainerName: string | null
  readonly branchId: string
  readonly branchName: string
  readonly category: string
  readonly startsAt: number
  readonly endsAt: number
  readonly capacity: number
  readonly bookedCount: number
  readonly status: ClassSessionStatus
  // For the booking panel's late-cancellation warning (from the session's policy snapshot).
  readonly cancellationWindowHours: number
  readonly lateCancellationConsumesCredit: boolean
  // The class note (Ders Notu), if set.
  readonly note: { readonly text: string; readonly visibility: 'staff' | 'members' } | null
}

export interface PickOption {
  readonly id: string
  readonly name: string
  readonly branchId?: string
  readonly capacity?: number
}
export interface StaffOption {
  readonly id: string
  readonly name: string
  readonly role: string
}
export interface TemplateView {
  readonly id: string
  readonly serviceId: string
  readonly serviceName: string
  readonly roomId: string | null
  readonly trainerId: string | null
  readonly branchId: string
  readonly dayOfWeek: number
  readonly startTime: string
  readonly durationMinutes: number
  readonly capacity: number
  readonly validFrom: string
  readonly validUntil: string
  readonly active: boolean
}

export interface ScheduleData {
  readonly sessions: readonly CalendarSession[]
  readonly services: readonly PickOption[]
  readonly rooms: readonly PickOption[]
  readonly staff: readonly StaffOption[]
  readonly templates: readonly TemplateView[]
}

export function studioToday(): string {
  return new Date(Date.now() + STUDIO_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 10)
}

// A UTC-ms window covering the month of `dateStr`, widened by a week each side so a
// week/day view spanning a month boundary still has its sessions. Exported so the
// Reservation Calendar can load reservations over the exact same window.
export function scheduleWindow(dateStr: string): [number, number] {
  const parts = dateStr.split('-')
  const y = Number(parts[0])
  const m = Number(parts[1])
  const localMidnightUtc = (yy: number, mm: number) =>
    Date.parse(`${yy}-${String(mm).padStart(2, '0')}-01T00:00:00Z`) - STUDIO_UTC_OFFSET_MIN * 60_000
  const start = localMidnightUtc(y, m) - 7 * DAY_MS
  const nextY = m === 12 ? y + 1 : y
  const nextM = m === 12 ? 1 : m + 1
  const end = localMidnightUtc(nextY, nextM) + 7 * DAY_MS
  return [start, end]
}

export async function loadSchedule(ctx: TenantContext, dateStr: string): Promise<ScheduleData> {
  const db = adminDb()
  const sched = new FirestoreSchedulingRepository(db)
  const [fromMs, toMs] = scheduleWindow(dateStr)

  const [sessions, services, rooms, templates, staff] = await Promise.all([
    sched.listSessionsForDay(ctx, instant(fromMs), instant(toMs)),
    sched.listServices(ctx),
    sched.listRooms(ctx),
    sched.listTemplates(ctx),
    new FirestoreIdentityRepository(db).listStaff(ctx),
  ])

  return {
    sessions: sessions.map((s) => ({
      sessionId: s.id,
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      roomId: s.roomId,
      roomName: s.roomName,
      trainerId: s.trainerId,
      trainerName: s.trainerName,
      branchId: s.branchId,
      branchName: s.branchName,
      category: s.category,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      capacity: s.capacity,
      bookedCount: s.bookedCount,
      status: s.status,
      cancellationWindowHours: s.policySnapshot.cancellationWindowHours,
      lateCancellationConsumesCredit: s.policySnapshot.lateCancellationConsumesCredit,
      note: s.note ? { text: s.note.text, visibility: s.note.visibility } : null,
    })),
    services: services
      .filter((s) => s.active)
      .map((s) => ({ id: s.id, name: s.name })),
    rooms: rooms
      .filter((r) => r.active)
      .map((r) => ({ id: r.id, name: r.name, branchId: r.branchId, capacity: r.capacity })),
    staff: staff.filter((m) => m.active).map((m) => ({ id: m.id, name: m.displayName, role: m.role })),
    templates: templates.map((t) => ({
      id: t.id,
      serviceId: t.serviceId,
      serviceName: services.find((s) => s.id === t.serviceId)?.name ?? '—',
      roomId: t.roomId,
      trainerId: t.trainerId,
      branchId: t.branchId,
      dayOfWeek: t.dayOfWeek,
      startTime: t.startTime,
      durationMinutes: t.durationMinutes,
      capacity: t.capacity,
      validFrom: t.validFrom,
      validUntil: t.validUntil,
      active: t.active,
    })),
  }
}
