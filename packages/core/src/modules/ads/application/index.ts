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
