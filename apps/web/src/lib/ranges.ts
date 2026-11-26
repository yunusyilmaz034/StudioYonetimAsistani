// ONE range vocabulary for the whole product (owner, v1.23): the activity feed, the analytics
// screen and every report to come speak it. "Bugün" is the STUDIO's calendar day —
// 00:00:00–23:59:59 in Europe/Istanbul — never the browser's.

const OFFSET_MIN = 180
export const DAY_MS = 86_400_000

export const studioDayStart = (ms: number): number =>
  Math.floor((ms + OFFSET_MIN * 60_000) / DAY_MS) * DAY_MS - OFFSET_MIN * 60_000

export type RangeId = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'custom' | 'all'

export const RANGES: readonly { id: RangeId; label: string }[] = [
  { id: 'today', label: 'Bugün' },
  { id: 'yesterday', label: 'Dün' },
  { id: 'last7', label: 'Son 7 gün' },
  { id: 'last30', label: 'Son 30 gün' },
  // Takvim ayı (owner, 2026-11-26: "aylık diyince niye bulunduğumuz ayı almıyor"). Kasa ekranı ayı takvim
  // ayı olarak gösteriyor; raporda yalnız "Son 30 gün" vardı ve ikisi aynı soruya farklı cevap veriyordu.
  { id: 'thisMonth', label: 'Bu ay' },
  { id: 'lastMonth', label: 'Geçen ay' },
  { id: 'custom', label: 'Tarih aralığı' },
]

/** Start of the studio's calendar month containing `ms`, shifted by `delta` months. */
export function studioMonthStart(ms: number, delta = 0): number {
  const local = new Date(ms + OFFSET_MIN * 60_000)
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + delta, 1) - OFFSET_MIN * 60_000
}

export interface Range {
  readonly fromMs: number
  readonly toMs: number
}

// A custom range is inclusive on both ends: a date picker that quietly drops the last day is a
// report that quietly drops a day's revenue.
export function resolveRange(
  id: RangeId,
  nowMs: number,
  custom?: { from?: string; to?: string },
): Range {
  const start = studioDayStart(nowMs)
  switch (id) {
    case 'today':
      return { fromMs: start, toMs: start + DAY_MS - 1 }
    case 'yesterday':
      return { fromMs: start - DAY_MS, toMs: start - 1 }
    case 'last7':
      return { fromMs: start - 6 * DAY_MS, toMs: nowMs }
    case 'last30':
      return { fromMs: start - 29 * DAY_MS, toMs: nowMs }
    case 'thisMonth':
      return { fromMs: studioMonthStart(nowMs), toMs: nowMs }
    case 'lastMonth':
      return { fromMs: studioMonthStart(nowMs, -1), toMs: studioMonthStart(nowMs) - 1 }
    case 'custom': {
      const from = custom?.from ? studioDayStart(Date.parse(`${custom.from}T12:00:00Z`)) : start
      const to = custom?.to ? studioDayStart(Date.parse(`${custom.to}T12:00:00Z`)) + DAY_MS - 1 : nowMs
      return { fromMs: from, toMs: to }
    }
    case 'all':
      return { fromMs: 0, toMs: nowMs }
  }
}
