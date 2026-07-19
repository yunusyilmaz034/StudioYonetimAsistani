import {
  newOperationId,
  ok,
  zeroMoney,
  type DomainError,
  type Instant,
  type MemberId,
  type Money,
  type OperationId,
  type Result,
  type TenantContext,
} from '../../../shared'
import {
  decideWalletAdjustment,
  decideWalletRefund,
  decideWalletTopup,
  decideWalletVoid,
} from '../domain/decide'
import type { WalletAdjustReason, WalletTopupSource } from '../events'
import { walletIdFor, type Wallet } from '../domain/types'
import { dctx } from './finance'
import type { DrawerDelta, FinanceDeps, WalletApply } from './ports'

// The wallet is born the first time money lands — until then it is an in-memory zero balance, and the
// document is written by the very commit that first tops it up (there is nothing to persist before).
const bornWallet = (studioId: TenantContext['studioId'], memberId: MemberId, now: Instant): Wallet => ({
  id: walletIdFor(memberId),
  studioId,
  memberId,
  balance: zeroMoney(),
  updatedAt: now,
})

async function loadOrBorn(deps: FinanceDeps, ctx: TenantContext, memberId: MemberId): Promise<Wallet> {
  return (await deps.repo.getWalletByMember(ctx, memberId)) ?? bornWallet(ctx.studioId, memberId, deps.clock.now())
}

export async function getWallet(deps: FinanceDeps, ctx: TenantContext, memberId: MemberId): Promise<Wallet> {
  return loadOrBorn(deps, ctx, memberId)
}

// ── TOP-UP — money in. A liability, exactly like a gift card sale: revenue is recognised when it is
//    SPENT, not when it is loaded. For cash/pos the money physically enters a till, so the drawer's
//    expected balance moves in the SAME transaction (#1) — a wallet load reception can't see in the
//    gün sonu is a wallet load that will be argued about.
export interface TopUpWalletInput {
  readonly memberId: MemberId
  readonly amount: Money
  readonly source: WalletTopupSource
  readonly paymentId?: string | null // the ledger/online payment this money became (PAYTR); null for cash/manual
  readonly providerRef?: string | null
  readonly drawerId?: string | null // for cash/pos — the till the money physically entered
  readonly operationId?: OperationId
}

export async function topUpWallet(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: TopUpWalletInput,
): Promise<Result<Wallet, DomainError>> {
  const wallet = await loadOrBorn(deps, ctx, input.memberId)
  const d = dctx(deps, ctx, input.operationId ?? newOperationId())
  const decided = decideWalletTopup(d, wallet, {
    amount: input.amount,
    source: input.source,
    paymentId: input.paymentId ?? null,
    providerRef: input.providerRef ?? null,
  })
  if (!decided.ok) return decided
  const apply: WalletApply = {
    walletId: wallet.id,
    memberId: input.memberId,
    deltaKurus: input.amount.amount,
    refuseBelowZero: false,
    event: decided.value.events[0]!,
  }
  const drawerDeltas: DrawerDelta[] =
    input.drawerId ? [{ drawerId: input.drawerId, deltaKurus: input.amount.amount }] : []
  await deps.repo.commit(ctx, { walletApplies: [apply], drawerDeltas, events: [] })
  return ok(decided.value.next)
}

// ── ADJUST — an owner/staff correction: a gift, a migration, a support gesture. A closed-enum reason
//    AND a mandatory note (AD-39 shape). A debit that would cross zero is refused, never clamped.
export interface AdjustWalletInput {
  readonly memberId: MemberId
  readonly direction: 'credit' | 'debit'
  readonly amount: Money
  readonly reason: WalletAdjustReason
  readonly note: string
  readonly operationId?: OperationId
}

export async function adjustWallet(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: AdjustWalletInput,
): Promise<Result<Wallet, DomainError>> {
  const wallet = await loadOrBorn(deps, ctx, input.memberId)
  const d = dctx(deps, ctx, input.operationId ?? newOperationId())
  const decided = decideWalletAdjustment(d, wallet, {
    direction: input.direction,
    amount: input.amount,
    reason: input.reason,
    note: input.note,
  })
  if (!decided.ok) return decided
  const apply: WalletApply = {
    walletId: wallet.id,
    memberId: input.memberId,
    deltaKurus: input.direction === 'credit' ? input.amount.amount : -input.amount.amount,
    refuseBelowZero: input.direction === 'debit',
    event: decided.value.events[0]!,
  }
  await deps.repo.commit(ctx, { walletApplies: [apply], events: [] })
  return ok(decided.value.next)
}

// ── REFUND — money back INTO the wallet (a returned purchase, a goodwill credit). Raises the balance.
export interface RefundToWalletInput {
  readonly memberId: MemberId
  readonly amount: Money
  readonly reason: string
  readonly originalSaleId?: string | null
  readonly operationId?: OperationId
}

export async function refundToWallet(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: RefundToWalletInput,
): Promise<Result<Wallet, DomainError>> {
  const wallet = await loadOrBorn(deps, ctx, input.memberId)
  const d = dctx(deps, ctx, input.operationId ?? newOperationId())
  const decided = decideWalletRefund(d, wallet, {
    amount: input.amount,
    reason: input.reason,
    originalSaleId: input.originalSaleId ?? null,
  })
  if (!decided.ok) return decided
  const apply: WalletApply = {
    walletId: wallet.id,
    memberId: input.memberId,
    deltaKurus: input.amount.amount,
    refuseBelowZero: false,
    event: decided.value.events[0]!,
  }
  await deps.repo.commit(ctx, { walletApplies: [apply], events: [] })
  return ok(decided.value.next)
}

// ── VOID — reverse a top-up that should not have happened (wrong member, wrong amount). Lowers the
//    balance; refused if the money is already spent.
export interface VoidTopupInput {
  readonly memberId: MemberId
  readonly amount: Money
  readonly topupId: string
  readonly reason: string
  readonly operationId?: OperationId
}

export async function voidWalletTopup(
  deps: FinanceDeps,
  ctx: TenantContext,
  input: VoidTopupInput,
): Promise<Result<Wallet, DomainError>> {
  const wallet = await loadOrBorn(deps, ctx, input.memberId)
  const d = dctx(deps, ctx, input.operationId ?? newOperationId())
  const decided = decideWalletVoid(d, wallet, {
    amount: input.amount,
    topupId: input.topupId,
    reason: input.reason,
  })
  if (!decided.ok) return decided
  const apply: WalletApply = {
    walletId: wallet.id,
    memberId: input.memberId,
    deltaKurus: -input.amount.amount,
    refuseBelowZero: true,
    event: decided.value.events[0]!,
  }
  await deps.repo.commit(ctx, { walletApplies: [apply], events: [] })
  return ok(decided.value.next)
}
