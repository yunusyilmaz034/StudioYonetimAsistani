import { describe, expect, it } from 'vitest'

import { instant, money, type BranchId, type MemberId, type TenantContext } from '../../../shared'
import type { Sale } from '../domain/types'
import { collect } from './finance'
import type { FinanceDeps, FinanceRepository, FinanceWrite } from './ports'

// WHICH SALE DOES THE MONEY PAY? (OR-37)
//
// The incident these exist for: a member paid for a new package through reception's link, and the
// money cleared an orphan open sale left behind by a package that had been cancelled. Her new
// package still read as owed, and the studio's answer was "ödedi ama borçlu görünüyor".
//
// Oldest-debt-first is right when reception says "bakiyesine yaz" and means the balance. It is wrong
// when the payment and its sale were created together — then the payment already knows its answer
// and must not be allowed to guess a different one.

const clock = { now: () => instant(1_700_000_000_000) }
const ctx = { studioId: 'std_1', actor: { type: 'owner', id: 'usr_1' } } as unknown as TenantContext
const MEMBER = 'mbr_1' as MemberId
const BRANCH = 'brn_1' as BranchId

const sale = (id: string, soldAt: number, total: number, paid = 0, status: Sale['status'] = 'open'): Sale =>
  ({
    id,
    studioId: ctx.studioId,
    memberId: MEMBER,
    branchId: BRANCH,
    status,
    soldAt,
    lines: [{ productId: 'prd_1', description: 'Paket', quantity: 1, unitPrice: money(total), entitlementId: null, giftCardId: null }],
    gross: money(total),
    total: money(total),
    paid: money(paid),
    discounts: [],
    createdBy: ctx.actor,
    createdAt: instant(soldAt),
    updatedAt: instant(soldAt),
  }) as unknown as Sale

function fake(sales: readonly Sale[]) {
  const writes: FinanceWrite[] = []
  const repo = {
    listSalesByMember: async () => sales,
    getDrawer: async () => null,
    getGiftCardByCode: async () => null,
    commit: async (_c: TenantContext, w: FinanceWrite) => {
      writes.push(w)
    },
  } as unknown as FinanceRepository
  return { deps: { repo, clock } as unknown as FinanceDeps, writes }
}

const base = {
  memberId: MEMBER,
  branchId: BRANCH,
  method: 'online' as const,
  receivedAt: instant(1_700_000_000_000),
  drawerId: null,
  giftCardCode: null,
  note: null,
  allowNoDrawer: true,
}

describe('collect — a payment that names its sale settles THAT sale', () => {
  it('pays the named sale even when an older debt exists', async () => {
    // The exact shape of the incident: an older orphan, and the new package the member actually paid.
    const orphan = sale('sal_orphan', 1_000, 500_00)
    const bought = sale('sal_new', 9_000, 500_00)
    const { deps, writes } = fake([orphan, bought])

    const r = await collect(deps, ctx, {
      ...base,
      paymentId: 'pay_1',
      amount: money(500_00),
      allocateTo: [{ saleId: 'sal_new', amount: money(500_00), allocationId: 'alc_1' }],
    })

    expect(r.ok).toBe(true)
    const allocations = writes[0]!.allocations ?? []
    expect(allocations).toHaveLength(1)
    expect(allocations[0]!.saleId).toBe('sal_new')
    // The older sale is untouched — no allocation, and it is not in the committed sales.
    expect((writes[0]!.sales ?? []).map((s) => s.id)).toEqual(['sal_new'])
  })

  it('refuses when the named sale is cancelled, rather than falling back to the oldest debt', async () => {
    const cancelled = sale('sal_dead', 1_000, 500_00, 0, 'cancelled')
    const other = sale('sal_other', 2_000, 500_00)
    const { deps, writes } = fake([cancelled, other])

    const r = await collect(deps, ctx, {
      ...base,
      paymentId: 'pay_2',
      amount: money(500_00),
      allocateTo: [{ saleId: 'sal_dead', amount: money(500_00), allocationId: 'alc_1' }],
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('allocation_target_invalid')
    expect(writes).toHaveLength(0) // nothing committed on a refusal
  })

  it("refuses a sale that is not the member's, so a stale id cannot reach another ledger", async () => {
    const { deps, writes } = fake([sale('sal_mine', 1_000, 500_00)])

    const r = await collect(deps, ctx, {
      ...base,
      paymentId: 'pay_3',
      amount: money(500_00),
      allocateTo: [{ saleId: 'sal_somebody_else', amount: money(500_00), allocationId: 'alc_1' }],
    })

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('allocation_target_invalid')
    expect(writes).toHaveLength(0)
  })

  it('leaves the surplus as member credit rather than spilling onto another sale', async () => {
    const older = sale('sal_old', 1_000, 900_00)
    const named = sale('sal_new', 9_000, 400_00)
    const { deps, writes } = fake([older, named])

    const r = await collect(deps, ctx, {
      ...base,
      paymentId: 'pay_4',
      amount: money(500_00), // 100 ₺ more than the named sale owes
      allocateTo: [{ saleId: 'sal_new', amount: money(500_00), allocationId: 'alc_1' }],
    })

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.unallocated).toBe(100_00) // I-33 — visible credit, not a silent transfer
    expect((writes[0]!.sales ?? []).map((s) => s.id)).toEqual(['sal_new'])
  })
})

describe('collect — with no named sale, reception still means "her balance"', () => {
  it('pays the oldest debt first', async () => {
    const older = sale('sal_old', 1_000, 300_00)
    const newer = sale('sal_new', 9_000, 300_00)
    const { deps, writes } = fake([newer, older]) // deliberately out of order

    const r = await collect(deps, ctx, { ...base, paymentId: 'pay_5', amount: money(400_00) })

    expect(r.ok).toBe(true)
    expect((writes[0]!.allocations ?? []).map((a) => a.saleId)).toEqual(['sal_old', 'sal_new'])
  })
})

// ── CÜZDANLA VAR OLAN BİR BORCU KAPATMAK (owner, 2026-09-04) ────────────────────────────────
//
// `sell` cüzdanı satış anında düşürüyordu; `collect` düşürmüyordu. Eksiklik SESSİZDİ: borç kapanır,
// bakiye olduğu gibi kalırdı — yoktan para. Kimse denemediği için ortaya çıkmamıştı; kafe hesabını
// cüzdandan ödetme ihtiyacı denetti.
//
// İkinci test birincisinden önemli: bakiye yetmiyorsa işlem REDDEDİLMELİ. Sıfırın altına inen bir
// cüzdan, stüdyonun hiç almadığı bir parayı almış gibi görünmesidir.
describe('collect — cüzdan bakiyeden DÜŞER', () => {
  function walletFake(sales: readonly Sale[], balance: number) {
    const writes: FinanceWrite[] = []
    const repo = {
      listSalesByMember: async () => sales,
      getDrawer: async () => null,
      getGiftCardByCode: async () => null,
      getWalletByMember: async () => ({
        id: 'wlt_1',
        studioId: ctx.studioId,
        memberId: MEMBER,
        balance: money(balance),
        updatedAt: instant(1_700_000_000_000),
      }),
      commit: async (_c: TenantContext, w: FinanceWrite) => {
        writes.push(w)
      },
    } as unknown as FinanceRepository
    return { deps: { repo, clock } as unknown as FinanceDeps, writes }
  }

  it('borcu kapatır VE cüzdandan aynı tutarı düşer', async () => {
    const { deps, writes } = walletFake([sale('sal_1', 1_699_000_000_000, 5_000)], 20_000)
    const r = await collect(deps, ctx, { ...base, method: 'wallet', paymentId: 'pay_1', amount: money(5_000) })
    expect(r.ok).toBe(true)
    const w = writes[0]!
    expect(w.walletApplies?.[0]?.deltaKurus).toBe(-5_000)
    expect(w.walletApplies?.[0]?.refuseBelowZero).toBe(true)
    expect(w.sales?.[0]?.paid.amount).toBe(5_000)
  })

  it('BAKİYE YETMİYORSA reddeder — kısmi ödeme yok, eksi bakiye yok', async () => {
    const { deps, writes } = walletFake([sale('sal_1', 1_699_000_000_000, 5_000)], 3_000)
    const r = await collect(deps, ctx, { ...base, method: 'wallet', paymentId: 'pay_1', amount: money(5_000) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('wallet_insufficient')
    // HİÇBİR ŞEY YAZILMADI: reddedilen bir ödeme yarım bir iz bırakmaz.
    expect(writes).toHaveLength(0)
  })

  it('cüzdan DIŞINDAKİ yöntemler bakiyeye dokunmaz', async () => {
    const { deps, writes } = walletFake([sale('sal_1', 1_699_000_000_000, 5_000)], 20_000)
    const r = await collect(deps, ctx, { ...base, method: 'cash', paymentId: 'pay_1', amount: money(5_000) })
    expect(r.ok).toBe(true)
    expect(writes[0]?.walletApplies).toBeUndefined()
  })
})
