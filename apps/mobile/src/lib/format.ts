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
