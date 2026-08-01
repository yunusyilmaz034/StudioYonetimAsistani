// ÜYE LİSTESİ FİLTRELERİ (v1.27 S7).
//
// The members list has been a search box since v1.5, and search only answers a question you already
// know the answer to ("where is Ayşe?"). The questions reception actually has at 09:00 are the other
// kind — *"kimin paketi bitiyor?"*, *"kim donmuş?"*, *"kim borçlu?"* — and none of them can be typed
// into a search box.
//
// The classification is PURE and it is tested, because a filter that silently mislabels a member is
// worse than no filter: reception calls the wrong person, or worse, does not call the right one.

// ── THE THREE MEMBER STATES (owner, 2026-08-01) ──────────────────────────────────────────────
//
// The studio had two words for members — aktif and pasif — and they were doing three jobs. A member
// whose package simply ran out was being called "pasif", which is the same word used for a member the
// studio wants OUT of the system entirely. One of those two is someone to call this week; the other
// is someone to delete. Reception cannot act on a list that cannot tell them apart.
//
//   · **Aktif**          — she has a live package. She trains here.
//   · **Duraklatılmış**  — her package ended. Not gone, not sold to: the win-back list.
//   · **Pasif**          — the studio wants her out and her data gone. A DECISION, not a situation.
//
// TWO OF THESE ARE DERIVED AND ONE IS DECLARED, and that is why there is no `state` field on the
// member document. Aktif and duraklatılmış are facts about the credit ledger which change BY
// THEMSELVES — a package expires at midnight and nobody presses anything. Storing them would mean
// every expiry has to write to the member record: a nightly job that can fail, drift, and leave a
// member reading "aktif" with nothing to book. Pasif is the opposite: nothing can compute a human's
// intention to remove someone, so it stays where it has always been (`Member.status`, written by
// `member.deactivated` with a reason).
//
// So the stored vocabulary is untouched — `MemberStatus` is still `active | inactive | deleted`, the
// declaration — and the three states the studio speaks are derived here, in one place, exhaustively.
export type MemberState =
  | 'active' // a live package (frozen counts: it is paused, not finished — owner, 2026-08-01)
  | 'paused' // no live package, and nobody asked for her to go
  | 'passive' // the studio marked her for removal

export type MemberFilter =
  | 'all'
  | 'active' // ── the three states ──
  | 'paused'
  | 'passive'
  | 'pilates' // has an active Pilates (reformer group) package
  | 'fitness' // has an active Fitness package
  | 'pt' // has an active PT (private) package
  | 'hybrid' // has an active HYBRID (bundle) package — a demet, whatever its components
  | 'expiring' // its validity ends within two weeks
  | 'low_credits' // 2 or fewer classes left — the moment to sell the next package
  | 'frozen'
  | 'in_debt' // sold, not collected. It is legal here, and it must never be invisible.

// The catalogue category behind each type filter (D0 — the catalogue is data, but these enum values are
// the fixed category wall, safe to name). A member "has Pilates" if she has an ACTIVE package of it.
const CATEGORY_OF: Partial<Record<MemberFilter, string>> = {
  pilates: 'pilates_group',
  fitness: 'fitness',
  pt: 'private',
}

export interface MemberFacts {
  /** The member's own status, as the studio set it. */
  readonly status: string
  readonly balanceDueKurus: number
  /** Her live packages: active or frozen. Expired and cancelled ones are not a membership. */
  readonly packages: readonly {
    readonly status: string
    readonly validUntil: number
    /** `null` ⇔ a period package: it grants time, not a number of classes. */
    readonly creditsAvailable: number | null
    /** The catalogue category (`pilates_group` / `fitness` / `private`). Optional: older callers omit it. */
    readonly category?: string
    /** TRUE when this package is a component of a HYBRID (bundle) product. Optional: older callers omit it. */
    readonly isBundle?: boolean
  }[]
}

export const EXPIRING_WINDOW_MS = 14 * 86_400_000
export const LOW_CREDIT_THRESHOLD = 2

export interface MemberBadges {
  /** Aktif · Duraklatılmış · Pasif — exhaustive, mutually exclusive, derived (see MemberState). */
  readonly state: MemberState
  readonly expiring: boolean
  readonly lowCredits: boolean
  readonly frozen: boolean
  readonly inDebt: boolean
  /** Holds a live HYBRID (bundle) package — powers the "Hibrit" filter. */
  readonly hybrid: boolean
  /** Catalogue categories she holds a live (active or frozen) package in — powers the type filters. */
  readonly categories: readonly string[]
}

/**
 * The ONE line that decides what a member is to the studio. Exported because the members list and her
 * own card both show it, and a member who reads "Aktif" in one place and "Duraklatılmış" in the other
 * is a bug reported as "sistem yanlış".
 */
export function memberStateOf(status: string, livePackageCount: number): MemberState {
  return status !== 'active' ? 'passive' : livePackageCount > 0 ? 'active' : 'paused'
}

/**
 * Does this package still make her a member TODAY?
 *
 * The date is checked, not just the status, and that is deliberate. `status` is flipped to `expired`
 * by the nightly sweep, so a package that ran out at midnight still reads `active` until the job runs
 * — and a job that is late would leave members reading "Aktif" with nothing to book. The owner asks
 * this number to mean *"gerçekten paketi olan üye"*; that must not depend on whether a cron fired.
 *
 * A FROZEN package skips the date check on purpose: freezing stops the clock, and its `validUntil` is
 * not extended until it is lifted. Judging it by a date it is deliberately outrunning would drop a
 * member out of "Aktif" in the middle of a freeze the studio granted her.
 */
const isLive = (p: MemberFacts['packages'][number], nowMs: number): boolean =>
  p.status === 'frozen' || (p.status === 'active' && p.validUntil >= nowMs)

export function badgesFor(m: MemberFacts, nowMs: number): MemberBadges {
  const live = m.packages.filter((p) => isLive(p, nowMs))
  const active = live.filter((p) => p.status === 'active')
  const frozen = live.some((p) => p.status === 'frozen')

  return {
    // The declaration wins: a member the studio has marked for removal is PASIF whatever her packages
    // say — she may well still hold a valid one, and that is precisely a reason to see her under
    // "Pasif" rather than have her hide among the customers.
    //
    // Otherwise the ledger answers. A FROZEN package counts as live (owner, 2026-08-01): she has
    // bought, she is coming back, and her membership is paused — not finished. "Donmuş" remains its
    // own filter, so nothing about her situation is lost by calling her active.
    state: memberStateOf(m.status, live.length),
    categories: [...new Set(live.map((p) => p.category).filter((c): c is string => Boolean(c)))],
    // A package still inside its window, ending soon. A frozen one is NOT expiring — that is the
    // whole point of freezing it, and telling reception to chase a frozen member would undo it.
    expiring: active.some((p) => p.validUntil > nowMs && p.validUntil - nowMs <= EXPIRING_WINDOW_MS),
    // Only a credit package can run low. A period membership has no number to run out of, and
    // counting it as "0 credits left" would put every unlimited member on the call list.
    lowCredits: active.some(
      (p) => p.creditsAvailable !== null && p.creditsAvailable <= LOW_CREDIT_THRESHOLD,
    ),
    frozen,
    inDebt: m.balanceDueKurus > 0,
    // A hybrid (demet) is any live package flagged as a bundle component — its content varies (pilates +
    // fitness, etc.), but the studio thinks of it as one thing: "hibrit". A member counts as hybrid if
    // ANY of her live packages is one.
    hybrid: live.some((p) => p.isBundle === true),
  }
}

export function matches(filter: MemberFilter, b: MemberBadges): boolean {
  switch (filter) {
    case 'all':
      // "Tümü" means every member the studio still HAS — passive ones are excluded (owner,
      // 2026-07-31). A member is made passive precisely so she stops appearing in the day's work;
      // leaving her in the default list undoes the only thing the button does. She is one tap away
      // under "Pasif", and nothing is hidden — the count on that chip says how many there are.
      //
      // Duraklatılmış members DO belong here: they are the studio's, they just have nothing to book
      // with. Hiding them would hide the win-back list.
      return b.state !== 'passive'
    case 'active':
      return b.state === 'active'
    case 'paused':
      return b.state === 'paused'
    case 'passive':
      return b.state === 'passive'
    case 'pilates':
    case 'fitness':
    case 'pt':
      return b.categories.includes(CATEGORY_OF[filter]!)
    case 'hybrid':
      return b.hybrid
    case 'expiring':
      return b.expiring
    case 'low_credits':
      return b.lowCredits
    case 'frozen':
      return b.frozen
    case 'in_debt':
      return b.inDebt
  }
}

/** The Turkish the studio speaks. One label per state, used by every screen that shows one. */
export const STATE_LABEL: Record<MemberState, string> = {
  active: 'Aktif',
  paused: 'Duraklatılmış',
  passive: 'Pasif',
}

// The three STATES come first and in order — they answer "who is this member to us?", which is the
// question reception opens the screen with. Everything after them is a different axis entirely: what
// she holds, and what needs doing about it. "Paketsiz" is gone: it was this list's old name for
// duraklatılmış, and two names for one group is how a list stops being trusted.
export const FILTERS: readonly { id: MemberFilter; label: string }[] = [
  { id: 'all', label: 'Tümü' },
  { id: 'active', label: 'Aktif' },
  { id: 'paused', label: 'Duraklatılmış' },
  { id: 'passive', label: 'Pasif' },
  { id: 'pilates', label: 'Pilates' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'pt', label: 'PT' },
  { id: 'hybrid', label: 'Hibrit' },
  { id: 'expiring', label: 'Bitecek' },
  { id: 'low_credits', label: 'Kredisi azalan' },
  { id: 'frozen', label: 'Donmuş' },
  { id: 'in_debt', label: 'Borçlu' },
]
