// D6 — the class colour language. Bound to the SERVICE CATEGORY (a closed enum the domain
// depends on), never to a package name — a package gets renamed and repriced; a category does
// not. Colour never carries meaning alone (Doc 09 §7): every chip is labelled too.
export const CATEGORY_LABEL: Record<string, string> = {
  pilates_group: 'Grup Pilates',
  fitness: 'Fitness',
  private: 'PT',
}

export const CATEGORY_CHIP: Record<string, string> = {
  pilates_group: 'bg-cat-pilates-soft text-cat-pilates',
  fitness: 'bg-cat-fitness-soft text-cat-fitness',
  private: 'bg-cat-private-soft text-cat-private',
}

export const CATEGORY_RAIL: Record<string, string> = {
  pilates_group: 'border-cat-pilates',
  fitness: 'border-cat-fitness',
  private: 'border-cat-private',
}
