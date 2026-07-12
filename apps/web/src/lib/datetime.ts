// OP-1 (owner, 2026-07-13) — every operation and movement is shown with a FULL timestamp:
// `GG.AA.YYYY HH:mm:ss`. Seconds are not decoration: two credit moves in the same minute are two
// different acts, and the Activity Center exists so the owner can tell them apart.
//
// One formatter, so every screen agrees. Studio time (Europe/Istanbul) — the studio's day is what
// the owner is reasoning about, never the browser's.

const TZ = 'Europe/Istanbul'

export function formatDateTime(ms: number): string {
  const d = new Date(ms)
  const date = d.toLocaleDateString('tr-TR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const time = d.toLocaleTimeString('tr-TR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return `${date} ${time}`
}

// The short form, for places where the date is already established by the row above it.
export function formatTimeWithSeconds(ms: number): string {
  return new Date(ms).toLocaleTimeString('tr-TR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
