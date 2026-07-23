import type { CalendarSession } from '@/server/schedule-query'

// Class-calendar-specific filter + status + occupancy helpers. The generic calendar
// date helpers (dayKey, timeLabel, headings, weekday tables, view math) now live in
// `@/components/calendar` and are shared with the Reservation Calendar.

export interface Filters {
  serviceId: string
  roomId: string
  trainerId: string
  branchId: string
  status: string
  // Whether cancelled sessions are shown. Seeded from the studio setting (default off) and toggled per
  // visit; a cancelled class is noise on the board unless you deliberately ask for it.
  showCancelled: boolean
}

export const EMPTY_FILTERS: Filters = {
  serviceId: 'all',
  roomId: 'all',
  trainerId: 'all',
  branchId: 'all',
  status: 'all',
  showCancelled: false,
}

export function passesFilters(s: CalendarSession, f: Filters): boolean {
  if (f.serviceId !== 'all' && s.serviceId !== f.serviceId) return false
  if (f.roomId !== 'all' && s.roomId !== f.roomId) return false
  if (f.trainerId !== 'all' && s.trainerId !== f.trainerId) return false
  if (f.branchId !== 'all' && s.branchId !== f.branchId) return false
  if (f.status !== 'all' && s.status !== f.status) return false
  // Hide cancelled unless the toggle is on OR the user explicitly filtered to cancelled.
  if (s.status === 'cancelled' && !f.showCancelled && f.status !== 'cancelled') return false
  return true
}

export const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Planlı',
  in_progress: 'Devam ediyor',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
}

// Visual occupancy state only — never a real waitlist. "Dolmak üzere" = last 2 seats
// or ≥80% full.
export function occupancy(booked: number, capacity: number): { label: string; className: string } {
  if (capacity > 0 && booked >= capacity) return { label: 'Dolu', className: 'bg-danger/10 text-danger' }
  if (capacity > 0 && (capacity - booked <= 2 || booked / capacity >= 0.8)) {
    return { label: 'Dolmak üzere', className: 'bg-warning/10 text-warning' }
  }
  return { label: 'Uygun', className: 'bg-success/10 text-success' }
}
