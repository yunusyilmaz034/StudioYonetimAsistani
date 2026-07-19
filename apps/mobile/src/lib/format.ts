// Turkish date/time formatting for the app. All timestamps on the wire are epoch-ms.
export { formatKurus } from '@studio/core/client'

const TZ = 'Europe/Istanbul'

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString('tr-TR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

export function timeRange(startMs: number, endMs: number): string {
  const opt = { timeZone: TZ, hour: '2-digit', minute: '2-digit' } as const
  return `${new Date(startMs).toLocaleTimeString('tr-TR', opt)} – ${new Date(endMs).toLocaleTimeString('tr-TR', opt)}`
}

export function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString('tr-TR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
}

// A LocalDate ("YYYY-MM-DD") as gg/aa/yyyy — the numeric format Turkish users expect. Falls back to the
// raw string if it isn't a plain date.
export function localDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}
