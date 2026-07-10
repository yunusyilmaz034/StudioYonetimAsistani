import { describe, expect, it } from 'vitest'

import {
  addMoney,
  compareMoney,
  isNegativeMoney,
  isZeroMoney,
  money,
  multiplyMoney,
  subtractMoney,
  zeroMoney,
  type Money,
} from './money'

describe('money', () => {
  it('constructs from an integer number of kuruş', () => {
    expect(money(420000)).toEqual({ amount: 420000, currency: 'TRY' })
  })

  it('rejects a float amount — no float in a money path (non-negotiable #10)', () => {
    expect(() => money(4200.5)).toThrow()
  })

  it('adds and subtracts within a currency', () => {
    expect(addMoney(money(100), money(50)).amount).toBe(150)
    expect(subtractMoney(money(100), money(50)).amount).toBe(50)
  })

  it('multiplies by an integer factor only', () => {
    expect(multiplyMoney(money(100), 3).amount).toBe(300)
    expect(() => multiplyMoney(money(100), 1.5)).toThrow()
  })

  it('refuses cross-currency arithmetic', () => {
    const foreign = { amount: 100, currency: 'USD' } as unknown as Money
    expect(() => addMoney(money(100), foreign)).toThrow()
  })

  it('reports zero, negative, and ordering', () => {
    expect(isZeroMoney(zeroMoney())).toBe(true)
    expect(isNegativeMoney(money(-1))).toBe(true)
    expect(compareMoney(money(100), money(50))).toBeGreaterThan(0)
    expect(compareMoney(money(50), money(50))).toBe(0)
  })
})
