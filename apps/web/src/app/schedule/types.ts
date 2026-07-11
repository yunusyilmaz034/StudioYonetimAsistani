import type { CalendarSession } from '@/server/schedule-query'

export type ViewMode = 'month' | 'week' | 'day' | 'agenda'

export interface Filters {
  serviceId: string
  roomId: string
  trainerId: string
  branchId: string
  status: string
}

export const EMPTY_FILTERS: Filters = {
  serviceId: 'all',
  roomId: 'all',
  trainerId: 'all',
  branchId: 'all',
  status: 'all',
}

const TZ = 'Europe/Istanbul'

// A studio-local 'YYYY-MM-DD' key for grouping sessions by day (en-CA formats ISO).
export function dayKey(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ })
}

export function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
}

export function dayHeading(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function monthHeading(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
}

export function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const WEEKDAYS_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
export const WEEKDAYS_TR_LONG = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']

// Monday-based weekday index (0=Mon) for a 'YYYY-MM-DD'.
export function mondayIndex(dateStr: string): number {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay() // 0=Sun
  return (dow + 6) % 7
}

export function passesFilters(s: CalendarSession, f: Filters): boolean {
  if (f.serviceId !== 'all' && s.serviceId !== f.serviceId) return false
  if (f.roomId !== 'all' && s.roomId !== f.roomId) return false
  if (f.trainerId !== 'all' && s.trainerId !== f.trainerId) return false
  if (f.branchId !== 'all' && s.branchId !== f.branchId) return false
  if (f.status !== 'all' && s.status !== f.status) return false
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
