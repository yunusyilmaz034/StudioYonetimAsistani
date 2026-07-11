import type { BranchId, DomainError, Result, TenantContext } from '../../../shared'
import { decideCloseBranch, decideOpenBranch } from '../domain/decide'
import { decideContext } from './context'
import type { CheckinDeps } from './ports'

// Reception opens/closes the branch (D3) — the occupancy window. Idempotent.
export async function openBranch(
  deps: CheckinDeps,
  ctx: TenantContext,
  input: { branchId: BranchId },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.getBranch(ctx, input.branchId)
  const outcome = decideOpenBranch(decideContext(deps, ctx), input.branchId, current)
  if (outcome.events.length === 0) return { ok: true, value: undefined }
  await deps.repo.saveBranch(ctx, outcome.branchNext, outcome.events)
  return { ok: true, value: undefined }
}

export async function closeBranch(
  deps: CheckinDeps,
  ctx: TenantContext,
  input: { branchId: BranchId },
): Promise<Result<void, DomainError>> {
  const [current, occupancy] = await Promise.all([
    deps.repo.getBranch(ctx, input.branchId),
    deps.repo.countPresence(ctx, input.branchId),
  ])
  const outcome = decideCloseBranch(decideContext(deps, ctx), input.branchId, current, occupancy)
  if (outcome.events.length === 0) return { ok: true, value: undefined }
  await deps.repo.saveBranch(ctx, outcome.branchNext, outcome.events)
  return { ok: true, value: undefined }
}
