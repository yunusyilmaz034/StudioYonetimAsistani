// Money is an integer number of kuruş with a currency. Never a float, ever
// (Doc 2 §12, non-negotiable #10). Construct via `money()`, which rejects a
// non-integer amount — a float in a money path is a bug, not a rounding choice.

export type Currency = 'TRY'

export interface Money {
  readonly amount: number // integer kuruş
  readonly currency: Currency
}

export function money(amount: number, currency: Currency = 'TRY'): Money {
  if (!Number.isInteger(amount)) {
    throw new Error(`Money amount must be an integer number of kuruş, got ${amount}`)
  }
  return { amount, currency }
}

export const zeroMoney = (currency: Currency = 'TRY'): Money => money(0, currency)

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`)
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.amount + b.amount, a.currency)
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.amount - b.amount, a.currency)
}

export function multiplyMoney(m: Money, factor: number): Money {
  if (!Number.isInteger(factor)) {
    throw new Error(`Money can only be multiplied by an integer, got ${factor}`)
  }
  return money(m.amount * factor, m.currency)
}

export const isZeroMoney = (m: Money): boolean => m.amount === 0
export const isNegativeMoney = (m: Money): boolean => m.amount < 0

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b)
  return a.amount - b.amount
}
