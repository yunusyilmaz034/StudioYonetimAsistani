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

// A product may instead carry its OWN cash price, and then the two figures are set independently:
// `priceInKurus` is what a card pays and `cashPriceInKurus` is what cash pays. It exists because a
// campaign's gap is not always expressible as a rule — August 2026 moved the three fitness packages
// by 1.000 / 1.250 / 2.500 ₺, which is neither a constant amount nor a constant percentage.
//
// `productPrices` is the ONE place that knows which of the two arrangements a product is under, so a
// call site never has to ask. Under the rule the base price is the cash price and the surcharge is
// derived; under an explicit cash price the difference IS the surcharge. Both end at the same shape:
//
//   cardKurus = cashKurus + cardExtraKurus
//
// and a product with one price returns them equal, so a screen can compare and stay silent.
export interface PricedProduct {
  readonly priceInKurus: number
  readonly cashPriceInKurus?: number | null
  readonly category?: Category | string
}

export function productPrices(
  product: PricedProduct,
  cfg: CardSurchargeConfig | null | undefined,
): { cashKurus: number; cardExtraKurus: number; cardKurus: number } {
  if (product.cashPriceInKurus != null) {
    return {
      cashKurus: product.cashPriceInKurus,
      cardExtraKurus: product.priceInKurus - product.cashPriceInKurus,
      cardKurus: product.priceInKurus,
    }
  }
  const extra = cardSurchargeKurus(product.priceInKurus, product.category, cfg)
  return { cashKurus: product.priceInKurus, cardExtraKurus: extra, cardKurus: product.priceInKurus + extra }
}
