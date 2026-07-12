import {
  newOperationId,
  type CorrelationId,
  type DomainError,
  type EventSource,
  type Instant,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideAdjust, decideExtend, type Entitlement, type EntitlementsDeps } from '../../entitlements'
import { decideBulkApplicable, decideBulkApplied, decideBulkPlanned } from '../domain/decide'
import { computeBulkPlan } from '../domain/plan'
import type { BulkAction, BulkOperation, BulkPlan, BulkSummary, OperationScope } from '../domain/types'
import type { OperationsDeps } from './ports'

const SOURCE: EventSource = 'reception_web'
const dctx = (deps: OperationsDeps, ctx: TenantContext, correlationId: CorrelationId) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  correlationId,
  source: SOURCE,
})

export interface BulkDeps extends OperationsDeps {
  readonly entitlements: EntitlementsDeps
  readonly loadWorld: (
    ctx: TenantContext,
  ) => Promise<{ entitlements: readonly Entitlement[]; memberNames: ReadonlyMap<string, string> }>
}

export interface PlanBulkInput {
  readonly action: BulkAction
  readonly scope: OperationScope
  readonly reason: BulkOperation['reason']
  readonly note: string
}

const bulkId = (kind: string, now: Instant): string => `blk_${kind}_${now}`

// ── PREVIEW — writes nothing ───────────────────────────────────────────────────────────────
export async function previewBulk(
  deps: BulkDeps,
  ctx: TenantContext,
  input: { scope: OperationScope },
): Promise<BulkPlan> {
  const world = await deps.loadWorld(ctx)
  return computeBulkPlan(world.entitlements, world.memberNames, input.scope)
}

export async function planBulk(
  deps: BulkDeps,
  ctx: TenantContext,
  input: PlanBulkInput,
): Promise<Result<{ bulkId: string }, DomainError>> {
  const now = deps.clock.now()
  const operationId = newOperationId()
  const op: BulkOperation = {
    id: bulkId(input.action.kind, now),
    operationId,
    studioId: ctx.studioId,
    action: input.action,
    scope: input.scope,
    reason: input.reason,
    note: input.note,
    status: 'planned',
    summary: null,
    appliedAt: null,
    createdAt: now,
  }
  const events = decideBulkPlanned(dctx(deps, ctx, operationId), op)
  if (!events.ok) return events
  await deps.repo.saveBulk(ctx, op, events.value)
  return { ok: true, value: { bulkId: op.id } }
}

// ── APPLY ──────────────────────────────────────────────────────────────────────────────────
//
// The same three properties as the closure (I-28 · re-derive, never replay · per-object
// transactions), and one that belongs to the ledger:
//
//   **Nothing new in the arithmetic.** `decideAdjust` already enforces AD-39 — a closed-enum
//   reason AND a non-empty note, and a decrease that would go below zero is REFUSED, never
//   clamped. A bulk operation is a hundred of those, not a new kind of credit movement. The
//   reason and note are given once, for the batch, and stamped on every single one.
export async function applyBulk(
  deps: BulkDeps,
  ctx: TenantContext,
  id: string,
): Promise<Result<BulkSummary, DomainError>> {
  const op = await deps.repo.getBulk(ctx, id)
  if (!op) return { ok: false, error: { code: 'operation_not_applicable' } }

  const applicable = decideBulkApplicable(op)
  if (!applicable.ok) return applicable

  await deps.repo.setBulkStatus(ctx, id, 'applying')

  // Re-derive: an entitlement may have expired or been frozen since the preview.
  const world = await deps.loadWorld(ctx)
  const plan = computeBulkPlan(world.entitlements, world.memberNames, op.scope)

  // OP-2 — every ledger move below carries the operation's id, so 120 extensions read as ONE act.
  const operationId = op.operationId

  const members = new Set<MemberId>()
  let entitlementsAffected = 0
  let creditsAdded = 0
  let daysAdded = 0

  for (const row of plan.toApply) {
    const ent = await deps.entitlements.repo.getEntitlement(ctx, row.entitlementId)
    if (!ent) continue

    const outcome =
      op.action.kind === 'extend_days'
        ? decideExtend(
            dctx(deps, ctx, operationId),
            ent,
            op.action.days,
            `${op.reason}: ${op.note}`,
            op.id,
          )
        : decideAdjust(
            dctx(deps, ctx, operationId),
            ent,
            op.action.credits,
            op.reason,
            op.note,
          )

    if (!outcome.ok) continue // frozen / not active / refused — already named in the plan

    await deps.entitlements.repo.saveEntitlement(ctx, outcome.value.next, outcome.value.events)
    entitlementsAffected++
    members.add(row.memberId)
    if (op.action.kind === 'extend_days') daysAdded += op.action.days
    else creditsAdded += op.action.credits
  }

  const summary: BulkSummary = {
    membersAffected: members.size,
    entitlementsAffected,
    creditsAdded,
    daysAdded,
    skippedFrozen: plan.skipped.filter((s) => s.reason === 'frozen').length,
    skippedInactive: plan.skipped.filter((s) => s.reason === 'not_active').length,
  }

  const applied: BulkOperation = { ...op, status: 'applied', summary, appliedAt: deps.clock.now() }
  await deps.repo.saveBulk(
    ctx,
    applied,
    decideBulkApplied(dctx(deps, ctx, operationId), applied, summary),
  )
  return { ok: true, value: summary }
}
