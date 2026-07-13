import {
  collect,
  FirestoreFinanceRepository,
  instant,
  money,
  openDrawer,
  systemClock,
  type BranchId,
  type MemberId,
  type StudioId,
  type TenantContext,
} from '@studio/core'
import { describe, expect, it } from 'vitest'

import { db } from '../../src/shared/firebase'

// THE TILL, UNDER CONTENTION — the regression test for the worst bug the Alpha review found.
//
// The cash drawer used to be read OUTSIDE the transaction, its new total computed in memory, and the
// whole document written back. Firestore only serialises on documents read INSIDE a transaction — so
// twelve concurrent cash payments each read `expected = 0`, each wrote `expected = 3.000`, and
// **eleven payments' cash disappeared from the till.**
//
// Every receipt was right. Every payment was in the ledger. The day-end count simply came up 33.000 ₺
// short, with nothing anywhere to explain it — which is the shape of bug a studio never recovers
// from, because it does not look like an error. It looks like theft.
//
// The unit tests could not have caught it: the deciders were right. Only concurrency finds this, and
// only against a real database. So it is tested here, and it stays tested here.

const SID = 'std_drawer_test' as StudioId
const BRANCH = 'brn_1' as BranchId
const ctx: TenantContext = {
  studioId: SID,
  branchIds: [BRANCH],
  role: 'receptionist',
  actor: { type: 'receptionist', id: 'usr_1' as never },
}

const PAYERS = 12
const AMOUNT = 300_00 // 300,00 ₺ each

describe('kasa — eşzamanlı tahsilat', () => {
  it('twelve payments at once, and the till is right to the kuruş', async () => {
    const drawerId = `drw_${Date.now()}`
    const finance = new FirestoreFinanceRepository(db())
    const deps = { repo: finance, clock: systemClock }

    await db()
      .doc(`studios/${SID}/cashDrawers/${drawerId}`)
      .set({
        name: 'Merkez Kasa',
        kind: 'cash',
        status: 'closed',
        branchId: BRANCH,
        openingFloat: { amount: 0, currency: 'TRY' },
        expected: { amount: 0, currency: 'TRY' },
        openedAt: null,
        openedBy: null,
        closedAt: null,
        closedBy: null,
        countedAmount: null,
        discrepancy: null,
        closeNote: null,
      })
    const opened = await openDrawer(deps, ctx, { drawerId, openingFloat: money(0) })
    expect(opened.ok).toBe(true)

    // Twelve receptionists — or one receptionist and a jammed button — at the same instant.
    const results = await Promise.all(
      Array.from({ length: PAYERS }, (_, i) =>
        collect(deps, ctx, {
          paymentId: `pay_${drawerId}_${i}`,
          memberId: `mem_${i}` as MemberId,
          branchId: BRANCH,
          amount: money(AMOUNT),
          method: 'cash',
          receivedAt: instant(Date.now()),
          drawerId,
          giftCardCode: null,
          note: null,
        }),
      ),
    )
    expect(results.every((r) => r.ok)).toBe(true)

    const drawer = await finance.getDrawer(ctx, drawerId)
    expect(
      drawer?.expected.amount,
      'the till lost money: a concurrent payment overwrote another instead of adding to it',
    ).toBe(PAYERS * AMOUNT)
  })

  it('refuses to bank into a till that was closed underneath it', async () => {
    const drawerId = `drw_closed_${Date.now()}`
    const finance = new FirestoreFinanceRepository(db())
    const deps = { repo: finance, clock: systemClock }

    await db()
      .doc(`studios/${SID}/cashDrawers/${drawerId}`)
      .set({
        name: 'Kapalı Kasa',
        kind: 'cash',
        status: 'open', // the decision will be made against an OPEN drawer…
        branchId: BRANCH,
        openingFloat: { amount: 0, currency: 'TRY' },
        expected: { amount: 0, currency: 'TRY' },
        openedAt: null,
        openedBy: null,
        closedAt: null,
        closedBy: null,
        countedAmount: null,
        discrepancy: null,
        closeNote: null,
      })

    // …and then someone counts the till and closes it, in the moment between the decision and the
    // commit. The money must NOT quietly land in a closed drawer: the transaction re-reads it and
    // aborts. Reception is told, and she re-opens the till.
    const collecting = collect(deps, ctx, {
      paymentId: `pay_${drawerId}`,
      memberId: 'mem_x' as MemberId,
      branchId: BRANCH,
      amount: money(AMOUNT),
      method: 'cash',
      receivedAt: instant(Date.now()),
      drawerId,
      giftCardCode: null,
      note: null,
    })
    await db().doc(`studios/${SID}/cashDrawers/${drawerId}`).update({ status: 'closed' })

    // Either the payment won the race (and the till holds it) or it lost and threw. What must NEVER
    // happen is money banked into a closed till.
    const landed = await collecting.then(
      (r) => r.ok,
      () => false,
    )
    const drawer = await finance.getDrawer(ctx, drawerId)
    if (landed) {
      expect(drawer?.expected.amount).toBe(AMOUNT)
    } else {
      expect(drawer?.expected.amount, 'money landed in a closed till').toBe(0)
    }
  })
})
