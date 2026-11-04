// Load → decide → transact for paid ad campaigns (IG-5a).
import { localDateAt, newAdCampaignId, newCorrelationId, type Clock, type DomainError, type Result, type TenantContext } from '../../../shared'
import {
  decideApproveCampaign,
  decideEditCampaign,
  decideProposeCampaign,
  decidePublished,
  decidePublishFailed,
  decideRemoveCampaign,
  decideStartPublishing,
  type AdDecideContext,
} from '../domain/decide'
import type { AdCampaign, AdCampaignFields } from '../domain/types'
import type { AdCampaignPublishFailedPayload, AdOrigin } from '../events'
import type { FirestoreAdsRepository } from '../infrastructure/repos'
import {
  decideChange,
  decideChangeApplied,
  decideChangeFailed,
  decideDismissChange,
  decideRequestChange,
  pendingAsChange,
  type AdChange,
} from '../domain/changes'

export interface AdsDeps {
  readonly repo: FirestoreAdsRepository
  readonly clock: Clock
}

const IST_MINUTES = 180

function ctxFor(deps: AdsDeps, ctx: TenantContext): AdDecideContext {
  const now = deps.clock.now()
  return {
    studioId: ctx.studioId,
    actor: ctx.actor,
    role: String(ctx.role),
    now,
    today: localDateAt(now, IST_MINUTES),
    correlationId: newCorrelationId(),
    source: 'reception_web',
  }
}

const noCaps = { ok: false as const, error: { code: 'ad_over_cap' as const, which: 'daily' as const, cap: 0 } }

export async function proposeAdCampaign(
  deps: AdsDeps,
  ctx: TenantContext,
  input: { origin: AdOrigin; rationale: string; fields: AdCampaignFields },
): Promise<Result<AdCampaign, DomainError>> {
  const caps = await deps.repo.caps(ctx)
  if (!caps) return noCaps // no caps configured = no spending at all
  const r = decideProposeCampaign(ctxFor(deps, ctx), { id: newAdCampaignId(), ...input }, caps)
  if (!r.ok) return r
  await deps.repo.create(ctx, r.value.next, r.value.events)
  return { ok: true, value: r.value.next }
}

export async function editAdCampaign(deps: AdsDeps, ctx: TenantContext, id: string, fields: AdCampaignFields) {
  const caps = await deps.repo.caps(ctx)
  if (!caps) return noCaps
  return deps.repo.mutate(ctx, id, (c) => decideEditCampaign(ctxFor(deps, ctx), c, fields, caps))
}

/** Approve AND take the publishing lock in one step — the caller then talks to Meta. */
export async function approveAndLockAdCampaign(deps: AdsDeps, ctx: TenantContext, id: string): Promise<Result<AdCampaign, DomainError>> {
  const caps = await deps.repo.caps(ctx)
  if (!caps) return noCaps
  return deps.repo.mutate(ctx, id, (c) => {
    const d = ctxFor(deps, ctx)
    const a = decideApproveCampaign(d, c, caps)
    if (!a.ok) return a
    const p = decideStartPublishing(d, a.value.next)
    if (!p.ok) return p
    return { ok: true, value: { next: p.value.next, events: [...a.value.events, ...p.value.events] } }
  })
}

export const markAdCampaignPublished = (deps: AdsDeps, ctx: TenantContext, id: string, meta: { campaignId: string; adSetId: string; adId: string }) =>
  deps.repo.mutate(ctx, id, (c) => decidePublished(ctxFor(deps, ctx), c, meta))

export const markAdCampaignFailed = (
  deps: AdsDeps,
  ctx: TenantContext,
  id: string,
  failure: { stage: AdCampaignPublishFailedPayload['stage']; metaCode: string | null; message: string },
) => deps.repo.mutate(ctx, id, (c) => decidePublishFailed(ctxFor(deps, ctx), c, failure))

export const removeAdCampaign = (deps: AdsDeps, ctx: TenantContext, id: string) => deps.repo.mutate(ctx, id, (c) => decideRemoveCampaign(ctxFor(deps, ctx), c))

// ── IG-5b: changes to a campaign that is on Meta ────────────────────────────────────────────────────

/** The AI (actor: system) asks for a change. Stored as pending; Meta untouched. */
export async function requestAdChange(deps: AdsDeps, ctx: TenantContext, id: string, change: Omit<AdChange, 'id'>, rationale: string) {
  const caps = await deps.repo.caps(ctx)
  if (!caps) return noCaps
  return deps.repo.mutate(ctx, id, (c) => decideRequestChange(ctxFor(deps, ctx), c, { ...change, id: newCorrelationId() }, rationale, caps))
}

export interface PreparedAdChange {
  readonly campaign: AdCampaign // as it is now
  readonly after: AdCampaign // as it will be
  readonly change: AdChange
  readonly origin: AdOrigin
}

/**
 * Step 1 of 3 — may this person make this change now? `'pending'` = approve the AI's request.
 * Nothing is written. The caller then sets the absolute value on Meta, then calls step 3.
 */
export async function prepareAdChange(
  deps: AdsDeps,
  ctx: TenantContext,
  id: string,
  change: Omit<AdChange, 'id'> | 'pending',
): Promise<Result<PreparedAdChange, DomainError>> {
  const caps = await deps.repo.caps(ctx)
  if (!caps) return noCaps
  const campaign = await deps.repo.get(ctx, id)
  if (!campaign) return { ok: false, error: { code: 'operation_not_applicable' } }
  const ch = change === 'pending' ? pendingAsChange(campaign) : { ...change, id: newCorrelationId() }
  if (!ch) return { ok: false, error: { code: 'operation_not_applicable' } }
  const d = decideChange(ctxFor(deps, ctx), campaign, ch, caps)
  if (!d.ok) return d
  return { ok: true, value: { campaign, after: d.value, change: ch, origin: change === 'pending' ? 'ai' : 'staff' } }
}

/** Step 3 — Meta accepted: record it, re-decided against the campaign as it is at commit time. */
export async function commitAdChangeApplied(deps: AdsDeps, ctx: TenantContext, p: PreparedAdChange) {
  const caps = await deps.repo.caps(ctx)
  if (!caps) return noCaps
  return deps.repo.mutate(ctx, p.campaign.id, (c) => decideChangeApplied(ctxFor(deps, ctx), c, p.change, p.origin, caps))
}

/** Step 3 — Meta refused: the campaign keeps its state, the reason is shown on the card. */
export const commitAdChangeFailed = (deps: AdsDeps, ctx: TenantContext, p: PreparedAdChange, failure: { metaCode: string | null; message: string }) =>
  deps.repo.mutate(ctx, p.campaign.id, (c) => decideChangeFailed(ctxFor(deps, ctx), c, p.change, p.origin, failure))

export const dismissAdChange = (deps: AdsDeps, ctx: TenantContext, id: string) => deps.repo.mutate(ctx, id, (c) => decideDismissChange(ctxFor(deps, ctx), c))
