import { describe, expect, it } from 'vitest'

import { money } from '@studio/core'
import { tamiVerdict } from './tami-return'

// TAMI does not call us back — it redirects the buyer's browser and says nothing to us. So the
// grant hangs entirely on `provider.confirm()` plus this one decision. Every case below is a way
// money could be invented or lost, which is why they are tested without a Firestore in the way.

const PRICE = money(500_000) // ₺5.000

describe('tamiVerdict', () => {
  it('confirms when TAMI echoes exactly the amount we minted', () => {
    const v = tamiVerdict({ valid: true, paidAmount: PRICE }, PRICE)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.paidAmount).toEqual(PRICE)
  })

  it('confirms when TAMI echoes NO amount — the order was ours, and its price was fixed here', () => {
    // §16: the figure is set server-side when the token is minted and the hosted page cannot change
    // it. `money(0)` here would record a paid sale of nothing.
    const v = tamiVerdict({ valid: true }, PRICE)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.paidAmount).toEqual(PRICE)
  })

  it('REFUSES when TAMI reports a smaller amount — the package is not given away for ₺1', () => {
    const v = tamiVerdict({ valid: true, paidAmount: money(100) }, PRICE)
    expect(v).toEqual({ ok: false, providerRef: '', reason: 'tami_amount_mismatch' })
  })

  it('refuses a LARGER amount too — a disagreement is a defect, not a tip', () => {
    // Not "she paid extra, credit her": an orderId collision or a replayed query looks exactly like
    // this, and neither may grant a package.
    const v = tamiVerdict({ valid: true, paidAmount: money(900_000) }, PRICE)
    expect(v.ok).toBe(false)
  })

  it('passes TAMI’s own refusal through by name, so the log says why', () => {
    const v = tamiVerdict({ valid: false, failureCode: 'tami_not_paid_2013' }, PRICE)
    expect(v).toEqual({ ok: false, providerRef: '', reason: 'tami_not_paid_2013' })
  })

  it('a refusal with no code still refuses — an unexplained answer is not a payment', () => {
    const v = tamiVerdict({ valid: false }, PRICE)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('tami_not_paid')
  })

  it('an amount TAMI reports is never allowed to become the sale price', () => {
    // The guard exists so this can never happen; the assertion states it as a rule rather than
    // leaving it implied by the case above.
    const v = tamiVerdict({ valid: true, paidAmount: money(1) }, PRICE)
    expect(v.ok).toBe(false)
  })
})
