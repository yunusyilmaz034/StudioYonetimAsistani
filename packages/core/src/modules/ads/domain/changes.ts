// PURE decisions for changing a campaign that is ON META (IG-5b, 2026-11-04). Owner's rules:
//
//   · The owner's own press IS the approval (one confirm on screen) → `decideChange` → Meta → `decideChangeApplied`.
//   · The AI only ASKS: `decideRequestChange` stores one pending request; nothing reaches Meta until the
//     owner approves it (same path as above, origin 'ai') or dismisses it.
//   · Money: new daily ≤ daily cap; new daily × ALL the campaign's days ≤ campaign cap (the strict rule —
//     not "spent so far + rest", which would lean on Meta's late spend figures); ≤ 90 days. Refused, never
//     clamped. Pause needs no cap check — it only stops spending.
//   · `change_applied` is written only after Meta accepted. Meta refused → `change_failed`; the campaign
//     keeps its previous state, the pending request (if any) is spent.
//
// No lock is persisted: every Meta write here sets an ABSOLUTE value (status, budget, end time), so
// repeating it is harmless. The commit re-decides against the campaign as it is at commit time.
import { err, money, ok, type DomainError, type Money, type Result } from '../../../shared'
import {
  AD_CAMPAIGN_CHANGE_APPLIED,
  AD_CAMPAIGN_CHANGE_DISMISSED,
  AD_CAMPAIGN_CHANGE_FAILED,
  AD_CAMPAIGN_CHANGE_REQUESTED,
  type AdCaps,
  type AdOrigin,
} from '../events'
import { AD_LIMITS, campaignDays, maxSpend, type AdDecideContext, type Outcome } from './decide'
import type { AdCampaign, AdChangeKind, AdChangeRequest } from './types'

const APPROVERS: readonly string[] = ['owner', 'platform_admin']
const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface AdChange {
  readonly id: string
  readonly kind: AdChangeKind
  readonly dailyBudget?: Money | null
  readonly endDate?: string | null
}

/** The campaign as it would be after the change — or the reason it may not happen. */
export function previewChange(current: AdCampaign, change: AdChange, today: string, caps: AdCaps): Result<AdCampaign, DomainError> {
  if (current.status !== 'live' && current.status !== 'paused') return err({ code: 'ad_not_editable' })
  if (!current.meta) return err({ code: 'ad_not_editable' })
  switch (change.kind) {
    case 'pause':
      return current.status === 'live' ? ok({ ...current, status: 'paused' }) : err({ code: 'operation_not_applicable' })
    case 'resume':
      if (current.status !== 'paused') return err({ code: 'operation_not_applicable' })
      if (current.endDate < today) return err({ code: 'ad_invalid', field: 'dates' }) // ended: extend first
      return ok({ ...current, status: 'live' })
    case 'budget': {
      const daily = change.dailyBudget?.amount as number | undefined
      if (daily === undefined || !Number.isInteger(daily) || daily < 100) return err({ code: 'ad_invalid', field: 'dailyBudget' })
      if (daily === (current.dailyBudget.amount as number)) return err({ code: 'operation_not_applicable' })
      return capped({ ...current, dailyBudget: money(daily) }, caps)
    }
    case 'end_date': {
      const end = change.endDate ?? ''
      if (!DATE.test(end) || end < today || end < current.startDate) return err({ code: 'ad_invalid', field: 'dates' })
      if (end === current.endDate) return err({ code: 'operation_not_applicable' })
      return capped({ ...current, endDate: end }, caps)
    }
  }
}

function capped(next: AdCampaign, caps: AdCaps): Result<AdCampaign, DomainError> {
  const daily = next.dailyBudget.amount as number
  const days = campaignDays(next.startDate, next.endDate)
  if (days > AD_LIMITS.maxDays) return err({ code: 'ad_invalid', field: 'duration' })
  if (daily > (caps.dailyCap.amount as number)) return err({ code: 'ad_over_cap', which: 'daily', cap: caps.dailyCap.amount as number })
  if (daily * days > (caps.campaignCap.amount as number)) return err({ code: 'ad_over_cap', which: 'campaign', cap: caps.campaignCap.amount as number })
  return ok(next)
}

const base = (ctx: AdDecideContext, id: string) => ({
  studioId: ctx.studioId,
  branchId: null,
  version: 1,
  occurredAt: ctx.now,
  actor: ctx.actor,
  source: ctx.source,
  subject: { kind: 'adCampaign' as const, id },
  related: {},
  policyRef: null,
  commandId: null,
  causationId: null,
  correlationId: ctx.correlationId as never,
})

/** The AI asks. One pending request per campaign; validated now so a request over the cap never exists. */
export function decideRequestChange(ctx: AdDecideContext, current: AdCampaign, change: AdChange, rationale: string, caps: AdCaps): Result<Outcome, DomainError> {
  if (current.pendingChange) return err({ code: 'operation_not_applicable' })
  const p = previewChange(current, change, ctx.today, caps)
  if (!p.ok) return p
  const req: AdChangeRequest = {
    id: change.id,
    kind: change.kind,
    dailyBudget: change.kind === 'budget' ? p.value.dailyBudget : null,
    endDate: change.kind === 'end_date' ? p.value.endDate : null,
    rationale: rationale.trim().slice(0, 1000),
    requestedAt: ctx.now,
    requestedBy: ctx.actor,
  }
  return ok({
    next: { ...current, pendingChange: req },
    events: [
      {
        ...base(ctx, current.id),
        type: AD_CAMPAIGN_CHANGE_REQUESTED,
        payload: { changeId: req.id, kind: req.kind, origin: 'ai', dailyBudget: req.dailyBudget, endDate: req.endDate, maxSpend: maxSpend(p.value) },
      },
    ],
  })
}

/**
 * Before Meta is touched: may THIS person make THIS change now? Returns the campaign as it will be.
 * `origin: 'ai'` means the owner is approving the pending request — the change is the request itself.
 */
export function decideChange(ctx: AdDecideContext, current: AdCampaign, change: AdChange, caps: AdCaps): Result<AdCampaign, DomainError> {
  if (!APPROVERS.includes(ctx.role)) return err({ code: 'ad_approve_forbidden' })
  return previewChange(current, change, ctx.today, caps)
}

/** The pending AI request as a change, for approving it. */
export function pendingAsChange(current: AdCampaign): AdChange | null {
  const r = current.pendingChange
  return r ? { id: r.id, kind: r.kind, dailyBudget: r.dailyBudget, endDate: r.endDate } : null
}

/** Meta accepted. Re-decided against the campaign as it is NOW (the commit's view). */
export function decideChangeApplied(ctx: AdDecideContext, current: AdCampaign, change: AdChange, origin: AdOrigin, caps: AdCaps): Result<Outcome, DomainError> {
  const d = decideChange(ctx, current, change, caps)
  if (!d.ok) return d
  const after = d.value
  const next: AdCampaign = {
    ...after,
    pendingChange: origin === 'ai' || current.pendingChange?.id === change.id ? null : (current.pendingChange ?? null),
    lastChangeFailure: null,
    pausedAt: change.kind === 'pause' ? ctx.now : change.kind === 'resume' ? null : (current.pausedAt ?? null),
    pausedBy: change.kind === 'pause' ? ctx.actor : change.kind === 'resume' ? null : (current.pausedBy ?? null),
  }
  return ok({
    next,
    events: [
      {
        ...base(ctx, current.id),
        type: AD_CAMPAIGN_CHANGE_APPLIED,
        payload: {
          changeId: change.id,
          kind: change.kind,
          origin,
          from: { status: current.status, dailyBudget: current.dailyBudget, endDate: current.endDate },
          to: { status: next.status, dailyBudget: next.dailyBudget, endDate: next.endDate },
          maxSpend: maxSpend(next),
          caps,
        },
      },
    ],
  })
}

/** Meta refused. The campaign keeps its state; an AI request that was being approved is spent. */
export function decideChangeFailed(
  ctx: AdDecideContext,
  current: AdCampaign,
  change: AdChange,
  origin: AdOrigin,
  failure: { metaCode: string | null; message: string },
): Result<Outcome, DomainError> {
  return ok({
    next: {
      ...current,
      pendingChange: origin === 'ai' ? null : (current.pendingChange ?? null),
      lastChangeFailure: { kind: change.kind, metaCode: failure.metaCode, message: failure.message.slice(0, 300), at: ctx.now },
    },
    events: [{ ...base(ctx, current.id), type: AD_CAMPAIGN_CHANGE_FAILED, payload: { changeId: change.id, kind: change.kind, origin, metaCode: failure.metaCode } }],
  })
}

export function decideDismissChange(ctx: AdDecideContext, current: AdCampaign): Result<Outcome, DomainError> {
  if (!APPROVERS.includes(ctx.role)) return err({ code: 'ad_approve_forbidden' })
  const r = current.pendingChange
  if (!r) return err({ code: 'operation_not_applicable' })
  return ok({
    next: { ...current, pendingChange: null },
    events: [{ ...base(ctx, current.id), type: AD_CAMPAIGN_CHANGE_DISMISSED, payload: { changeId: r.id, kind: r.kind } }],
  })
}
