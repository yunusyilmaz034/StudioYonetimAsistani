// Çizelge ekranı ile basılan kâğıt aynı biçimi kullanıyor: ekranda "7:33" görünen şey kâğıtta
// "07:33" olmamalı.

/** Dakika → `S:DD`. */
export const ssdd = (dk: number) => `${Math.floor(Math.max(0, dk) / 60)}:${String(Math.max(0, dk) % 60).padStart(2, '0')}`

/** 'YYYY-MM-DD' → "Pzt 5 Eki". Öğlen UTC: hiçbir saat dilimi günü kaydıramaz. */
export const gunKisa = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

export const gunUzun = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Haftanın pazartesisi → "5 – 11 Ekim 2026". */
export const haftaEtiketi = (weekStart: string) => {
  const son = new Date(`${weekStart}T12:00:00Z`)
  son.setUTCDate(son.getUTCDate() + 6)
  const bas = new Date(`${weekStart}T12:00:00Z`)
  const ayniAy = bas.getUTCMonth() === son.getUTCMonth()
  const b = bas.toLocaleDateString('tr-TR', ayniAy ? { day: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'long', timeZone: 'UTC' })
  return `${b} – ${son.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`
}

export const anYazi = (ms: number) =>
  new Date(ms).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
