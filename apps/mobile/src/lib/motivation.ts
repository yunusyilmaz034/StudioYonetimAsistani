import type { MemberReservation } from '@studio/core/client'

// ── The line under her name (owner, 2026-08-06) ──────────────────────────────────────────────
//
// "burada üyeye motivasyon bildirimi vs gönderebileceğimiz bir alan vardı o güzel" — this is that
// area, moved out of a card and into a sentence beneath her own name. A card says "this app has a
// module"; a sentence under her name says "we know you".
//
// TWO RULES, and the second is the load-bearing one.
//
// 1. It speaks only from HER OWN data. No slogans, no "Harika gidiyorsun 💪" — a compliment with
//    nothing behind it becomes wallpaper in a fortnight and teaches her to stop reading the line.
//
// 2. It says NOTHING rather than something it cannot stand behind. The portal returns at most 20
//    past reservations (PORTAL_LIMITS.pastReservations), so a member who trains often has a
//    TRUNCATED window — and "geçen ayın iki üstünde" computed over a truncated window is simply
//    false. When the window may be cut, the comparison is dropped and only the count survives; when
//    even the count is unsafe, the line does not render at all.
//
// The proper fix is a server-side attendance count, which is a small endpoint and is not this
// change. Until then, silence is the honest failure mode.

const PORTAL_PAST_LIMIT = 20

/** Statuses that mean she was actually there. A cancellation is not attendance. */
const ATTENDED = new Set(['attended', 'auto_resolved', 'presumed_attended'])

const monthKey = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}`
}

const ORDINAL_TR = ['', 'ilk', 'ikinci', 'üçüncü', 'dördüncü', 'beşinci', 'altıncı', 'yedinci', 'sekizinci', 'dokuzuncu', 'onuncu']

/**
 * The sentence, or null when there is nothing true to say.
 *
 * `now` is passed in rather than read from the clock so this is pure and testable.
 */
export function motivationLine(past: readonly MemberReservation[], now: number): string | null {
  const attended = past.filter((r) => ATTENDED.has(r.status))
  if (attended.length === 0) return null

  const thisMonth = monthKey(now)
  const prev = new Date(now)
  prev.setMonth(prev.getMonth() - 1)
  const lastMonth = monthKey(prev.getTime())

  const inThis = attended.filter((r) => monthKey(r.startsAt) === thisMonth).length
  const inLast = attended.filter((r) => monthKey(r.startsAt) === lastMonth).length

  if (inThis === 0) return null

  // The window is full, so anything older than the oldest row we hold is invisible to us. That makes
  // LAST month's count a floor, not a fact — so no comparison is offered.
  const windowMayBeTruncated = past.length >= PORTAL_PAST_LIMIT

  const ordinal = ORDINAL_TR[inThis]
  const head = ordinal ? `Bu ay ${ordinal} dersin.` : `Bu ay ${inThis} derse geldin.`

  if (windowMayBeTruncated || inLast === 0) return head

  const diff = inThis - inLast
  if (diff > 0) return `${head} Geçen ayın ${diff} üstünde.`
  if (diff === 0) return `${head} Geçen ayla aynı.`
  // Behind last month is left unsaid. The line exists to be read, not to keep score against her —
  // and a member who trained less this month usually knows why.
  return head
}
