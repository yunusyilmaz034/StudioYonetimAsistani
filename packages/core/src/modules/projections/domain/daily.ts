import { localDateAt, type Instant } from '../../../shared'

// ── THE DAILY READ MODEL (v1.23, D29). ──────────────────────────────────────────────────────
//
// The first projection in the system, and it is built the way a projection must be built if it is
// to stay *disposable*:
//
//   • it is a fold over EVENTS ONLY — never a state document. A projector that reads `/members`
//     produces a number that can no longer be rebuilt from the log, and the projection stops being
//     a cache and becomes a database you cannot recover;
//   • it is a pure function, so `pnpm projections:rebuild` replays the log and lands on exactly the
//     same numbers — that is what makes it safe to delete and rebuild if it is ever wrong;
//   • the day is decided by `occurredAt` in STUDIO time (owner: "bugün" = 00:00:00–23:59:59, local).
//     An offline check-in that happened at 21:50 and arrived at 08:10 belongs to YESTERDAY. The two
//     timestamps exist precisely so this is a decision and not an accident (#3).
//
// What is NOT here, on purpose: occupancy, expiring memberships, low credits, the waiting list.
// Those are questions about the world RIGHT NOW — a membership expires because it is Thursday, with
// no event to fold. A counter cannot answer them, and a projection of them would be a cache with no
// invalidation, quietly stale at midnight. They stay bounded, indexed state queries.

export interface DailyCounters {
  readonly bookings: number
  readonly cancellations: number // cancelled + late_cancelled
  readonly moves: number
  readonly checkIns: number
  readonly attended: number
  readonly noShow: number
  readonly autoResolved: number
  readonly waitlistJoined: number
  readonly waitlistPromoted: number
  readonly newMembers: number
  // Money is an integer in kuruş (#10). Two DIFFERENT numbers, and the owner asked for both:
  //   salesKurus     — what was SOLD (the agreed price, even if nothing was paid)
  //   collectedKurus — what actually CAME IN
  // `balanceDue` on the dashboard is the difference. Selling without payment is legal here.
  readonly salesKurus: number
  readonly collectedKurus: number
  // Product mix, by id — never a name (#6-adjacent: the catalogue is data, and a name copied into
  // a read model is a stale name). The screen joins /products at render.
  readonly salesByProduct: Readonly<Record<string, number>>
}

export interface DailyReadModel extends DailyCounters {
  readonly date: string // 'YYYY-MM-DD', studio-local
  readonly lastEventAt: number // the newest event folded in — the staleness signal (§11)
}

export const EMPTY_COUNTERS: DailyCounters = {
  bookings: 0,
  cancellations: 0,
  moves: 0,
  checkIns: 0,
  attended: 0,
  noShow: 0,
  autoResolved: 0,
  waitlistJoined: 0,
  waitlistPromoted: 0,
  newMembers: 0,
  salesKurus: 0,
  collectedKurus: 0,
  salesByProduct: {},
}

export const emptyDaily = (date: string): DailyReadModel => ({
  ...EMPTY_COUNTERS,
  date,
  lastEventAt: 0,
})

// The minimum an event must expose to be folded. Deliberately structural: the projector never
// imports an event constant, so a new event type cannot break it — it simply contributes nothing
// until someone teaches it to.
export interface ProjectableEvent {
  readonly type: string
  readonly occurredAt: Instant
  readonly payload: Record<string, unknown>
}

export interface DailyIncrement {
  readonly date: string
  readonly counters: Partial<Record<keyof Omit<DailyCounters, 'salesByProduct'>, number>>
  readonly productSales?: { readonly productId: string; readonly amountKurus: number }
}

// Money is `{ amount, currency }` (#10 — an integer in kuruş, never a float, and never a bare
// number in the log). Reading it as a plain number silently yields ZERO, which is the worst kind of
// bug in a revenue figure: it does not crash, it just quietly says the studio sold nothing.
const kurus = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v // a payload that stored a raw integer
  if (v && typeof v === 'object' && 'amount' in v) {
    const amount = (v as { amount: unknown }).amount
    return typeof amount === 'number' && Number.isFinite(amount) ? amount : 0
  }
  return 0
}
const id = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

// PURE. (event, studio offset) → the day it belongs to and what it adds. `null` when the event
// contributes nothing to the dashboard's numbers — most of the catalogue does not, and that is
// fine: this is a dashboard, not an archive. The archive is /events.
export function projectDaily(
  event: ProjectableEvent,
  utcOffsetMinutes: number,
): DailyIncrement | null {
  const date = localDateAt(event.occurredAt, utcOffsetMinutes) as string
  const one = (counters: DailyIncrement['counters']): DailyIncrement => ({ date, counters })

  switch (event.type) {
    case 'reservation.booked':
      return one({ bookings: 1 })
    case 'reservation.cancelled':
    case 'reservation.late_cancelled':
      return one({ cancellations: 1 })
    case 'reservation.moved':
      // A move is NOT a cancellation (D19), and it must not appear as one in the numbers either —
      // otherwise the cancellation rate the owner reads is inflated by members who simply changed
      // their day. It gets its own counter.
      return one({ moves: 1 })
    case 'reservation.attended':
      return one({ attended: 1 })
    case 'reservation.no_show':
      return one({ noShow: 1 })
    case 'reservation.auto_resolved':
      // A presumption is not an observation (#11). It is counted apart from `attended` so the
      // owner can see how much of her attendance data is actually *observed*.
      return one({ autoResolved: 1 })
    case 'member.checked_in':
      return one({ checkIns: 1 })
    case 'member.registered':
      return one({ newMembers: 1 })
    case 'waitlist.joined':
      return one({ waitlistJoined: 1 })
    case 'waitlist.promoted':
      return one({ waitlistPromoted: 1 })

    // ── v1.24: the finance ledger is now the money's authority. ────────────────────────────
    case 'sale.created':
      // SATIŞ = the agreed total, paid or not (owner D-1).
      return {
        date,
        counters: { salesKurus: kurus(event.payload.total) },
        ...(id(event.payload.productId)
          ? { productSales: { productId: id(event.payload.productId)!, amountKurus: kurus(event.payload.total) } }
          : {}),
      }
    case 'sale.cancelled': {
      // NET revenue: subtracted on the day it is cancelled, never rewriting a past day's total —
      // a dashboard that edits history disagrees with a report someone already printed.
      const reversed = kurus(event.payload.total)
      return one({ salesKurus: reversed === 0 ? 0 : -reversed })
    }
    case 'payment.received':
      // TAHSİLAT = what actually arrived (cash basis, owner OQ-2).
      return one({ collectedKurus: kurus(event.payload.amount) })
    case 'payment.voided':
    case 'payment.refunded': {
      // Money that came back out. A void is not an edit (I-31) — it is a movement, and the day's
      // collected figure must feel it.
      const back = kurus(event.payload.amount)
      return one({ collectedKurus: back === 0 ? 0 : -back })
    }

    // ── The legacy money family (v1.14–v1.23) — DEAD TO THE PROJECTION as of v1.26. ────────────
    //
    // These events still carry money in their payloads, and until v1.26 the projector folded them:
    // there was exactly one family per sale, so nothing was counted twice.
    //
    // **DEBT-021 changed that.** The migration generates a real `sale.created` (and
    // `payment.received`) for every one of these, from the same money, with the original
    // `occurredAt`. Both families now describe the SAME sale — and a projector that folds both
    // reports **exactly double the revenue**, silently, on a dashboard the owner trusts.
    //
    // The owner's decision (Doc 26 §5, option (a)) was: *migrate once — do not carry a read-side
    // `if (legacy)` forever.* This is the read side honouring it. The ledger is now the only place
    // money is counted from, because after the migration it is the only place money IS.
    //
    // The events are NOT deleted and their history is NOT lost: they remain in the log, they remain
    // the record of what v1.14 did, and the sale that replaced each one carries the same amount on
    // the same day. What changed is only where the number is READ from.
    //
    // ⚠️ **Ordering matters, and it is in the runbook:** the projection must be REBUILT after the
    // migration runs (`pnpm projections:rebuild`). Until it is, the daily read model still holds the
    // doubled figures it folded before the change.
    case 'entitlement.purchased':
    case 'entitlement.payment_recorded':
    case 'entitlement.cancelled':
      return null

    default:
      return null
  }
}

// Apply an increment to a day. Pure, so the trigger and the rebuild script fold identically.
export function applyIncrement(
  current: DailyReadModel,
  inc: DailyIncrement,
  eventAt: number,
): DailyReadModel {
  const next: Record<string, unknown> = { ...current }
  for (const [key, delta] of Object.entries(inc.counters)) {
    next[key] = (current[key as keyof DailyCounters] as number) + (delta ?? 0)
  }
  const salesByProduct = { ...current.salesByProduct }
  if (inc.productSales) {
    const { productId, amountKurus } = inc.productSales
    salesByProduct[productId] = (salesByProduct[productId] ?? 0) + amountKurus
  }
  return {
    ...(next as unknown as DailyReadModel),
    salesByProduct,
    lastEventAt: Math.max(current.lastEventAt, eventAt),
  }
}
