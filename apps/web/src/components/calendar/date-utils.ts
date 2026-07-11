// Studio-local calendar date helpers, shared by every calendar surface (Class
// Calendar, Reservation Calendar). Studio timezone is Europe/Istanbul (Doc 1). These
// are pure string/number helpers over 'YYYY-MM-DD' day keys and epoch-ms instants.

const TZ = 'Europe/Istanbul'

export const WEEKDAYS_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
export const WEEKDAYS_TR_LONG = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']

// A studio-local 'YYYY-MM-DD' key for grouping items by day (en-CA formats ISO).
export function dayKey(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ })
}

export function studioToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
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

// Monday-based weekday index (0=Mon) for a 'YYYY-MM-DD'.
export function mondayIndex(dateStr: string): number {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay() // 0=Sun
  return (dow + 6) % 7
}

export type CalendarView = 'month' | 'week' | 'day' | 'agenda'

// Navigate a focus date by one step in the current view's unit (month → a month,
// week → 7 days, day/agenda → 1 day).
export function shiftByView(dateStr: string, dir: number, view: CalendarView): string {
  if (view === 'month') {
    const parts = dateStr.split('-')
    const y = Number(parts[0])
    const m = Number(parts[1])
    const total = y * 12 + (m - 1) + dir
    const ny = Math.floor(total / 12)
    const nm = (total % 12) + 1
    return `${ny}-${String(nm).padStart(2, '0')}-01`
  }
  return shiftDate(dateStr, dir * (view === 'week' ? 7 : 1))
}

// The 42 days (6 weeks) of a month grid, Monday-first, spilling into adjacent months.
export function monthGridDays(dateStr: string): { days: string[]; year: number; month: number } {
  const parts = dateStr.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1])
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const gridStart = shiftDate(first, -mondayIndex(first))
  return { days: Array.from({ length: 42 }, (_, i) => shiftDate(gridStart, i)), year, month }
}

// The days a non-month view spans: day → [date]; week → 7 from Monday; agenda → 14.
export function viewDays(dateStr: string, view: CalendarView): string[] {
  const start = view === 'week' ? shiftDate(dateStr, -mondayIndex(dateStr)) : dateStr
  const span = view === 'day' ? 1 : view === 'week' ? 7 : 14
  return Array.from({ length: span }, (_, i) => shiftDate(start, i))
}

export function isInMonth(dateStr: string, year: number, month: number): boolean {
  return dateStr.slice(0, 7) === `${year}-${String(month).padStart(2, '0')}`
}
