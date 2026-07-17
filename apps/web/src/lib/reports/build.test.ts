import { describe, expect, it } from 'vitest'

import type { CashDrawer, Member, Payment, Sale, StaffMember } from '@studio/core'

import { buildCash, buildCollections, buildSales } from './build'

// The report tests are the SPECIFICATION of what each column means. A report is only useful if it is
// right, and a number that is quietly wrong in a spreadsheet is worse than no report at all: it is
// believed.
//
// The three tested here are the three where being wrong costs money.

const TRY = (amount: number) => ({ amount, currency: 'TRY' as const })

const member = (id: string, fullName: string) =>
  ({
    id,
    fullName,
    phone: '+905321112233',
    status: 'active',
    joinedAt: 0,
    stats: { lastAttendanceAt: null, lastCheckInAt: null, lastBookingAt: null, totalAttended: 0, activeEntitlementCount: 0, balanceDue: 0 },
    restriction: null,
  }) as unknown as Member

const staff: StaffMember[] = [
  { id: 'stf_1', displayName: 'Reyhan', role: 'receptionist', active: true } as StaffMember,
]

const sale = (over: Partial<Sale>): Sale =>
  ({
    id: 'sal_1',
    memberId: 'mem_1',
    lines: [{ productId: 'p1', description: '8 Ders Reformer', quantity: 1, unitPrice: TRY(300_00), entitlementId: null, giftCardId: null }],
    discounts: [],
    gross: TRY(300_00),
    total: TRY(300_00),
    paid: TRY(0),
    status: 'open',
    soldBy: { type: 'staff', id: 'stf_1' },
    soldAt: 0,
    cancelledAt: null,
    cancelReason: null,
    ...over,
  }) as unknown as Sale

const payment = (over: Partial<Payment>): Payment =>
  ({
    id: 'pay_1',
    memberId: 'mem_1',
    amount: TRY(300_00),
    method: 'cash',
    receivedAt: 0,
    takenBy: { type: 'staff', id: 'stf_1' },
    drawerId: 'drw_1',
    providerRef: null,
    giftCardId: null,
    allocated: TRY(300_00),
    voided: false,
    voidReason: null,
    note: null,
    ...over,
  }) as unknown as Payment

describe('satış raporu', () => {
  const members = [member('mem_1', 'Ayşe Yılmaz')]

  it('money reaches the cell as a NUMBER in lira — a formatted string would break the owner’s SUM()', () => {
    const { table } = buildSales([sale({ paid: TRY(100_00) })], members, staff)
    const row = table.rows[0]!
    expect(row[3]).toBe(300) // brüt
    expect(row[5]).toBe(300) // net
    expect(row[6]).toBe(100) // tahsil edilen
    expect(row[7]).toBe(200) // kalan — selling without collecting is legal; it must never be invisible
    expect(typeof row[7]).toBe('number')
  })

  it('a cancelled sale is LISTED but is not in the totals', () => {
    const { table, summary } = buildSales(
      [sale({ id: 'a' }), sale({ id: 'b', status: 'cancelled' })],
      members,
      staff,
    )
    expect(table.rows).toHaveLength(2)
    expect(summary).toContain('1 satış')
    expect(summary).toContain('1 iptal')
    expect(summary).toContain('300 ₺')
  })

  it('names the person who sold it, never a raw uid', () => {
    const { table } = buildSales([sale({})], members, staff)
    expect(table.rows[0]![9]).toBe('Reyhan')
  })

  it('an erased member’s sale still appears — the money is a record the studio must keep', () => {
    const { table } = buildSales([sale({ memberId: 'gone' as never })], members, staff)
    expect(table.rows[0]![1]).toBe('(silinmiş üye)')
  })
})

describe('tahsilat raporu', () => {
  const members = [member('mem_1', 'Ayşe Yılmaz')]
  const drawers = [{ id: 'drw_1', name: 'Merkez Kasa' } as unknown as CashDrawer]

  it('a voided payment stays on the list and OUT of the total (I-31)', () => {
    const { table, summary } = buildCollections(
      [payment({ id: 'a' }), payment({ id: 'b', voided: true, voidReason: 'yanlış tutar' })],
      members,
      drawers,
      staff,
    )
    expect(table.rows).toHaveLength(2)
    expect(summary).toContain('1 tahsilat')
    expect(summary).toContain('300 ₺')
    expect(summary).toContain('1 iptal edilmiş tahsilat toplama girmedi')
    expect(table.rows.find((r) => String(r[6]).startsWith('İPTAL'))).toBeTruthy()
  })

  it('breaks the total down by method — the line the owner reconciles against the till', () => {
    const { summary } = buildCollections(
      [payment({ id: 'a', method: 'cash' }), payment({ id: 'b', method: 'credit_card', amount: TRY(150_00) })],
      members,
      drawers,
      staff,
    )
    expect(summary).toContain('Nakit 300 ₺')
    expect(summary).toContain('Kredi kartı 150 ₺')
  })
})

describe('kasa raporu', () => {
  const drawer = (over: Partial<CashDrawer>): CashDrawer =>
    ({
      id: 'drw_1',
      name: 'Merkez Kasa',
      kind: 'cash',
      status: 'closed',
      openingFloat: TRY(0),
      expected: TRY(300_00),
      openedAt: 0,
      openedBy: { type: 'staff', id: 'stf_1' },
      closedAt: 1,
      closedBy: { type: 'staff', id: 'stf_1' },
      countedAmount: TRY(300_00),
      discrepancy: TRY(0),
      closeNote: null,
      ...over,
    }) as unknown as CashDrawer

  it('a discrepancy is REPORTED, never absorbed', () => {
    const { summary } = buildCash(
      [drawer({ countedAmount: TRY(280_00), discrepancy: TRY(-20_00), closeNote: 'eksik' })],
      staff,
    )
    expect(summary).toContain('1 kasada fark var')
    expect(summary).toContain('-20 ₺')
  })

  it('says so plainly when every till balanced', () => {
    expect(buildCash([drawer({})], staff).summary).toContain('hiçbirinde fark yok')
  })
})
