// PURE decisions for paid ad campaigns (IG-5a, 2026-11-04). No I/O, no clock: `ctx.now` and `ctx.today`
// are given. This is MONEY — the rules here are the owner's (OR-131), and each one has a test.
//
//   · A draft lives only in the panel. Meta is written to ONLY after `ad_campaign.approved`.
//   · Daily budget ≤ the studio's daily cap; dailyBudget × days ≤ the campaign cap. Over the cap is
//     REFUSED — never clamped, never saved, never approved (an AI proposal included).
//   · An end date is mandatory (≤ 90 days): no campaign spends forever.
//   · Only the owner approves. The caps used are stamped on the approval (#4).
//   · approved → publishing → live | failed. `publishing` is the lock: a second press of the same
//     button finds the campaign already publishing and is refused, so one approval is one campaign.
import { addLocalDays, daysBetween, err, money, ok, type ActorRef, type DomainError, type Instant, type Money, type NewEvent, type Result, type StudioId } from '../../../shared'
import {
  AD_CAMPAIGN_APPROVED,
  AD_CAMPAIGN_EDITED,
  AD_CAMPAIGN_PROPOSED,
  AD_CAMPAIGN_PUBLISH_FAILED,
  AD_CAMPAIGN_PUBLISH_STARTED,
  AD_CAMPAIGN_PUBLISHED,
  AD_CAMPAIGN_REMOVED,
  type AdCaps,
  type AdCampaignPublishFailedPayload,
  type AdOrigin,
} from '../events'
import type { AdCampaign, AdCampaignFields } from './types'

export interface AdDecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly role: string
  readonly now: Instant
  readonly today: string // 'YYYY-MM-DD' in Europe/Istanbul — given, never computed here
  readonly correlationId: string
  readonly source: string
}

export interface Outcome {
  readonly next: AdCampaign
  readonly events: readonly NewEvent[]
}

export const AD_LIMITS = { name: 80, primaryText: 2200, maxDays: 90, radiusMin: 1, radiusMax: 80, ageMin: 18, ageMax: 65 } as const
const APPROVERS: readonly string[] = ['owner', 'platform_admin']
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Inclusive day count of a campaign: 5–18 Kasım is 14 days. */
export function campaignDays(startDate: string, endDate: string): number {
  return daysBetween(startDate, endDate) + 1
}

/** The most a campaign can spend: daily budget × days, integer kuruş. */
export function maxSpend(f: Pick<AdCampaignFields, 'dailyBudget' | 'startDate' | 'endDate'>): Money {
  return money((f.dailyBudget.amount as number) * campaignDays(f.startDate, f.endDate))
}

export function validateAdFields(f: AdCampaignFields, today: string, caps: AdCaps): Result<AdCampaignFields, DomainError> {
  const name = f.name.trim()
  if (!name || name.length > AD_LIMITS.name) return err({ code: 'ad_invalid', field: 'name' })
  const daily = f.dailyBudget.amount as number
  if (!Number.isInteger(daily) || daily < 100) return err({ code: 'ad_invalid', field: 'dailyBudget' })
  if (!DATE.test(f.startDate) || !DATE.test(f.endDate) || f.startDate < today || f.endDate < f.startDate) return err({ code: 'ad_invalid', field: 'dates' })
  const days = campaignDays(f.startDate, f.endDate)
  if (days > AD_LIMITS.maxDays) return err({ code: 'ad_invalid', field: 'duration' })
  if (daily > (caps.dailyCap.amount as number)) return err({ code: 'ad_over_cap', which: 'daily', cap: caps.dailyCap.amount as number })
  if (daily * days > (caps.campaignCap.amount as number)) return err({ code: 'ad_over_cap', which: 'campaign', cap: caps.campaignCap.amount as number })
  const t = f.targeting
  if (
    !(Math.abs(t.latitude) <= 90) ||
    !(Math.abs(t.longitude) <= 180) ||
    !Number.isInteger(t.radiusKm) ||
    t.radiusKm < AD_LIMITS.radiusMin ||
    t.radiusKm > AD_LIMITS.radiusMax ||
    !Number.isInteger(t.ageMin) ||
    !Number.isInteger(t.ageMax) ||
    t.ageMin < AD_LIMITS.ageMin ||
    t.ageMax > AD_LIMITS.ageMax ||
    t.ageMax < t.ageMin
  ) {
    return err({ code: 'ad_invalid', field: 'targeting' })
  }
  const text = f.creative.primaryText.trim()
  if (!/^\d{5,30}$/.test(f.creative.igMediaId) || !text || text.length > AD_LIMITS.primaryText) return err({ code: 'ad_invalid', field: 'creative' })
  return ok({ ...f, name, targeting: { ...t, label: t.label.trim() }, creative: { igMediaId: f.creative.igMediaId, primaryText: text } })
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

export function decideProposeCampaign(
  ctx: AdDecideContext,
  input: { readonly id: string; readonly origin: AdOrigin; readonly rationale: string; readonly fields: AdCampaignFields },
  caps: AdCaps,
): Result<Outcome, DomainError> {
  const v = validateAdFields(input.fields, ctx.today, caps)
  if (!v.ok) return v
  const next: AdCampaign = {
    id: input.id,
    studioId: ctx.studioId,
    ...v.value,
    status: 'draft',
    origin: input.origin,
    rationale: input.rationale.trim().slice(0, 1000),
    createdAt: ctx.now,
    createdBy: ctx.actor,
    approvedAt: null,
    approvedBy: null,
    approvedCaps: null,
    meta: null,
    failure: null,
  }
  return ok({
    next,
    events: [
      {
        ...base(ctx, next.id),
        type: AD_CAMPAIGN_PROPOSED,
        payload: {
          origin: next.origin,
          dailyBudget: next.dailyBudget,
          startDate: next.startDate,
          endDate: next.endDate,
          days: campaignDays(next.startDate, next.endDate),
          maxSpend: maxSpend(next),
        },
      },
    ],
  })
}

const EDITABLE = new Set(['draft', 'failed'])
const FIELDS = ['name', 'dailyBudget', 'startDate', 'endDate', 'targeting', 'creative'] as const

export function decideEditCampaign(ctx: AdDecideContext, current: AdCampaign, fields: AdCampaignFields, caps: AdCaps): Result<Outcome, DomainError> {
  if (!EDITABLE.has(current.status)) return err({ code: 'ad_not_editable' })
  const v = validateAdFields(fields, ctx.today, caps)
  if (!v.ok) return v
  const changed = FIELDS.filter((k) => JSON.stringify(current[k]) !== JSON.stringify(v.value[k]))
  if (changed.length === 0) return ok({ next: current, events: [] })
  // A failed campaign that is edited is a new draft: it goes back to the owner.
  const next: AdCampaign = { ...current, ...v.value, status: 'draft', failure: null }
  return ok({
    next,
    events: [{ ...base(ctx, current.id), type: AD_CAMPAIGN_EDITED, payload: { changedFields: [...changed], maxSpend: maxSpend(next) } }],
  })
}

export function decideApproveCampaign(ctx: AdDecideContext, current: AdCampaign, caps: AdCaps): Result<Outcome, DomainError> {
  if (!APPROVERS.includes(ctx.role)) return err({ code: 'ad_approve_forbidden' })
  if (current.status !== 'draft') return err({ code: 'ad_not_editable' })
  // Re-judged NOW, against today's caps and today's date: a draft written last week for "starting
  // yesterday", or under a cap the owner has since lowered, is not approvable as it stands.
  const v = validateAdFields(current, ctx.today, caps)
  if (!v.ok) return v
  const next: AdCampaign = { ...current, status: 'approved', approvedAt: ctx.now, approvedBy: ctx.actor, approvedCaps: caps }
  return ok({
    next,
    events: [
      {
        ...base(ctx, current.id),
        type: AD_CAMPAIGN_APPROVED,
        payload: {
          dailyBudget: current.dailyBudget,
          startDate: current.startDate,
          endDate: current.endDate,
          days: campaignDays(current.startDate, current.endDate),
          maxSpend: maxSpend(current),
          caps,
        },
      },
    ],
  })
}

/** The lock. Only an APPROVED campaign may start publishing — and only once. */
export function decideStartPublishing(ctx: AdDecideContext, current: AdCampaign): Result<Outcome, DomainError> {
  if (current.status !== 'approved' || !current.approvedAt) return err({ code: 'ad_not_approved' })
  return ok({ next: { ...current, status: 'publishing' }, events: [{ ...base(ctx, current.id), type: AD_CAMPAIGN_PUBLISH_STARTED, payload: {} }] })
}

export function decidePublished(ctx: AdDecideContext, current: AdCampaign, meta: { campaignId: string; adSetId: string; adId: string }): Result<Outcome, DomainError> {
  if (current.status !== 'publishing') return err({ code: 'operation_not_applicable' })
  return ok({
    next: { ...current, status: 'live', meta, failure: null },
    events: [
      { ...base(ctx, current.id), type: AD_CAMPAIGN_PUBLISHED, payload: { metaCampaignId: meta.campaignId, metaAdSetId: meta.adSetId, metaAdId: meta.adId } },
    ],
  })
}

export function decidePublishFailed(
  ctx: AdDecideContext,
  current: AdCampaign,
  failure: { stage: AdCampaignPublishFailedPayload['stage']; metaCode: string | null; message: string },
): Result<Outcome, DomainError> {
  if (current.status !== 'publishing') return err({ code: 'operation_not_applicable' })
  return ok({
    // The approval is spent: what failed must be looked at, edited if needed, and approved again.
    next: { ...current, status: 'failed', approvedAt: null, approvedBy: null, approvedCaps: null, failure: { ...failure, message: failure.message.slice(0, 300) } },
    events: [{ ...base(ctx, current.id), type: AD_CAMPAIGN_PUBLISH_FAILED, payload: { stage: failure.stage, metaCode: failure.metaCode } }],
  })
}

export function decideRemoveCampaign(ctx: AdDecideContext, current: AdCampaign): Result<Outcome, DomainError> {
  if (!EDITABLE.has(current.status)) return err({ code: 'ad_not_editable' })
  return ok({ next: { ...current, status: 'removed' }, events: [{ ...base(ctx, current.id), type: AD_CAMPAIGN_REMOVED, payload: { fromStatus: current.status } }] })
}

/** The day after which nothing more is spent — for the screen's "bitince kendiliğinden durur". */
export const dayAfterEnd = (c: Pick<AdCampaign, 'endDate'>): string => addLocalDays(c.endDate, 1)
