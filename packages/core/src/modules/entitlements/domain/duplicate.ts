import type { Instant, ProductId } from '../../../shared'

// SELLING THE SAME PACKAGE TWICE BY ACCIDENT (owner, 2026-07-29).
//
// ── What actually happens at the desk ────────────────────────────────────────────────────────
//
// The panel feels slow, or answers with an error that reception cannot act on, so she presses
// "Ata" again. And again. Every press that reaches the server is a complete, valid sale — the
// member ends up with two identical packages, two ledger entries, and a balance nobody can explain
// without reading the event log. The owner has had to unpick this by hand more than once, and his
// instruction was direct: *üst üste aynı işlem yapılması isteniyorsa çok az bir süre varsa kabul
// etmemeli, mükerrer şüphesi var.*
//
// ── Why a disabled button is not the fix ─────────────────────────────────────────────────────
//
// The client already disables the button while a sale is in flight, and it did not help: when the
// call FAILS (a stale tab, a dropped connection) the button comes back enabled and pressing it
// again is exactly what we ask her to do. The guard has to live on the server, where it sees every
// attempt regardless of which tab or which press produced it.
//
// ── What counts as suspicious ────────────────────────────────────────────────────────────────
//
// The same MEMBER receiving the same PRODUCT again within a short window. Not the price — a second
// press sends the same price, and comparing it would only let a typo through. Not the payment
// method either, for the same reason.
//
// ── Why this refuses instead of silently ignoring ────────────────────────────────────────────
//
// Swallowing the second sale would be idempotency, and idempotency needs a key the client generates
// and repeats — a real one, not a guess based on timing. We do not have that here, and inventing it
// from "looks similar" would eventually eat a sale that was genuinely meant. So the honest move is
// to REFUSE and say why: reception sees a sentence, checks the member's packages, and either stops
// (the sale already landed) or waits out the window (she really is selling two). Nothing is lost
// either way, and nothing is decided on her behalf.
//
// The window is deliberately short. It must cover a burst of frustrated presses and nothing else;
// a genuine second sale of the same package to the same person inside one minute does not happen at
// a reception desk, and if it ever does, waiting is the whole cost.

export const DUPLICATE_SALE_WINDOW_MS = 60_000

/** A sale already on the member's record, reduced to what the check needs. */
export type RecentSale = {
  readonly productId: ProductId
  readonly purchasedAt: Instant
}

/**
 * True when selling `productId` to this member now looks like a repeat of one that just landed.
 *
 * Pure: the caller supplies the member's existing sales and the clock. A sale in the FUTURE (a
 * queued renewal carries a later `validFrom`, but `purchasedAt` is always the moment of sale) is
 * treated as recent too — a clock that disagrees with itself should not open the gate.
 */
export function isSuspectedDuplicate(
  recent: readonly RecentSale[],
  productId: ProductId,
  now: Instant,
  windowMs: number = DUPLICATE_SALE_WINDOW_MS,
): boolean {
  return recent.some((s) => s.productId === productId && now - s.purchasedAt < windowMs)
}
