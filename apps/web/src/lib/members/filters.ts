// ÜYE LİSTESİ FİLTRELERİ (v1.27 S7).
//
// The members list has been a search box since v1.5, and search only answers a question you already
// know the answer to ("where is Ayşe?"). The questions reception actually has at 09:00 are the other
// kind — *"kimin paketi bitiyor?"*, *"kim donmuş?"*, *"kim borçlu?"* — and none of them can be typed
// into a search box.
//
// The classification is PURE and it is tested, because a filter that silently mislabels a member is
// worse than no filter: reception calls the wrong person, or worse, does not call the right one.

export type MemberFilter =
  | 'all'
  | 'active' // has a live package
  | 'pilates' // has an active Pilates (reformer group) package
  | 'fitness' // has an active Fitness package
  | 'pt' // has an active PT (private) package
  | 'expiring' // its validity ends within two weeks
  | 'low_credits' // 2 or fewer classes left — the moment to sell the next package
  | 'frozen'
  | 'no_package' // a member with nothing to book with. She is not lost, she is un-sold.
  | 'inactive' // the STUDIO marked her passive
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
  }[]
}

export const EXPIRING_WINDOW_MS = 14 * 86_400_000
export const LOW_CREDIT_THRESHOLD = 2

export interface MemberBadges {
  readonly active: boolean
  readonly expiring: boolean
  readonly lowCredits: boolean
  readonly frozen: boolean
  readonly noPackage: boolean
  readonly inactive: boolean
  readonly inDebt: boolean
  /** Catalogue categories she holds a live (active or frozen) package in — powers the type filters. */
  readonly categories: readonly string[]
}

export function badgesFor(m: MemberFacts, nowMs: number): MemberBadges {
  const live = m.packages.filter((p) => p.status === 'active' || p.status === 'frozen')
  const active = live.filter((p) => p.status === 'active')
  const frozen = live.some((p) => p.status === 'frozen')

  return {
    active: active.length > 0,
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
    noPackage: live.length === 0,
    inactive: m.status !== 'active',
    inDebt: m.balanceDueKurus > 0,
  }
}

export function matches(filter: MemberFilter, b: MemberBadges): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'active':
      return b.active
    case 'pilates':
    case 'fitness':
    case 'pt':
      return b.categories.includes(CATEGORY_OF[filter]!)
    case 'expiring':
      return b.expiring
    case 'low_credits':
      return b.lowCredits
    case 'frozen':
      return b.frozen
    case 'no_package':
      return b.noPackage
    case 'inactive':
      return b.inactive
    case 'in_debt':
      return b.inDebt
  }
}

export const FILTERS: readonly { id: MemberFilter; label: string }[] = [
  { id: 'all', label: 'Tümü' },
  { id: 'active', label: 'Aktif paketi olan' },
  { id: 'pilates', label: 'Pilates' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'pt', label: 'PT' },
  { id: 'expiring', label: 'Bitecek' },
  { id: 'low_credits', label: 'Kredisi azalan' },
  { id: 'frozen', label: 'Donmuş' },
  { id: 'no_package', label: 'Paketsiz' },
  { id: 'in_debt', label: 'Borçlu' },
  { id: 'inactive', label: 'Pasif' },
]
