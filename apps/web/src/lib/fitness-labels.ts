import type { OccupancyLevel } from '@studio/core'

// Shared TR labels + tones for the fitness read layer (Plus Phase 8). One source so the staff hero
// and the member's anonymous card can never drift. Kept web-side (a plain map) so importing it does
// not drag any server code into a client bundle.

export const OCCUPANCY_LABEL: Record<OccupancyLevel, string> = {
  quiet: 'Sakin',
  moderate: 'Orta',
  busy: 'Yoğun',
  very_busy: 'Çok yoğun',
}

// Tone classes over the design-system tokens — calm→busy, never a raw hex (DS-1).
export const OCCUPANCY_TONE: Record<OccupancyLevel, string> = {
  quiet: 'bg-success/10 text-success',
  moderate: 'bg-primary-soft text-primary',
  busy: 'bg-warning/10 text-warning',
  very_busy: 'bg-danger/10 text-danger',
}

// 0 = Monday … 6 = Sunday, matching the fitness module's weekday convention.
export const WEEKDAY_SHORT: readonly string[] = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
export const WEEKDAY_LONG: readonly string[] = [
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
  'Pazar',
]

export const hhLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`
