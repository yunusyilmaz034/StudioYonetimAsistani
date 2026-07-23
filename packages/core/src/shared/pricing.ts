// KK/havale (card & bank-transfer) surcharge — the price difference added when a member does NOT pay
// cash. It is CATEGORY-scoped policy DATA, never a literal in code (AD-41's spirit): a category may add
// a PERCENT of the price (KK farkı = fiyat × %) or a FIXED kuruş amount, and a category with no rule of
// its own falls back to the flat `cardTransferSurchargeKurus`. The owner sets these in Settings, and
// reception may always override the charged amount per sale (kontrol admin'de) — this only supplies the
// default the AI quotes and the sale form pre-fills.
import type { Category } from './category'

export type CategorySurchargeRule = { readonly percent: number } | { readonly fixedKurus: number }

export interface CardSurchargeConfig {
  readonly cardTransferSurchargeKurus?: number
  readonly byCategory?: Partial<Record<Category, CategorySurchargeRule>>
}

// The card/transfer surcharge (integer kuruş) for a base price in a product category. Pure; the output
// is always an integer number of kuruş (a percent rule is rounded to the nearest kuruş).
export function cardSurchargeKurus(
  baseKurus: number,
  category: Category | string | undefined,
  cfg: CardSurchargeConfig | null | undefined,
): number {
  const rule = category ? cfg?.byCategory?.[category as Category] : undefined
  if (rule) return 'percent' in rule ? Math.round((baseKurus * rule.percent) / 100) : rule.fixedKurus
  return cfg?.cardTransferSurchargeKurus ?? 0
}
