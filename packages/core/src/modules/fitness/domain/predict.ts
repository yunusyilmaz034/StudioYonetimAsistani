import type { BusyBucket, WeekdayHour } from './types'

// The historical busy-ness aggregation the "en yoğun saatler" card reads. PURE: it counts how often
// a check-in landed in each (weekday, hour) bucket over the observed window. It is a description of
// the past, not a promise about the future — the UI labels it "geçmişe göre", never a guarantee.
export function weekdayHourHistogram(samples: readonly WeekdayHour[]): readonly BusyBucket[] {
  const counts = new Map<string, number>()
  for (const s of samples) {
    if (s.weekday < 0 || s.weekday > 6 || s.hour < 0 || s.hour > 23) continue
    const key = `${s.weekday}:${s.hour}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const out: BusyBucket[] = []
  for (const [key, count] of counts) {
    const [weekday, hour] = key.split(':').map(Number)
    out.push({ weekday: weekday!, hour: hour!, count })
  }
  return out
}

// The top-N busiest (weekday, hour) buckets, most-visited first. Ties break deterministically by
// weekday then hour so the same history always yields the same list.
export function busiestBuckets(samples: readonly WeekdayHour[], topN: number): readonly BusyBucket[] {
  return [...weekdayHourHistogram(samples)]
    .sort((a, b) => b.count - a.count || a.weekday - b.weekday || a.hour - b.hour)
    .slice(0, Math.max(0, topN))
}
