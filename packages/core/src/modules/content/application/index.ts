// Load → decide → transact, for the content plan (IG-2a).
import { newContentPostId, newCorrelationId, type DomainError, type NewEvent, type Result, type TenantContext } from '../../../shared'
import {
  decideApprovePost,
  decideEditPost,
  decidePlanPost,
  decideRemovePost,
  istanbulWeekStart,
  type ContentDecideContext,
} from '../domain/decide'
import type { ContentPost, ContentPostFields } from '../domain/types'
import type { ContentOrigin } from '../events'
import {
  decideApprovePublish,
  decideAttachMedia,
  decidePublished,
  decidePublishFailed,
  decideStartPublishing,
  decideWithdrawPublish,
} from '../domain/publish'
import type { ContentPostEditFailedPayload, ContentPostPublishFailedPayload } from '../events'
import { decideAddRawClip, decideEditFailed, decideEditRendered, decideRequestEdit } from '../domain/edit'
import type { ContentEditOverrides } from '../domain/types'
import type { ContentDeps } from './ports'

function decideCtx(deps: ContentDeps, ctx: TenantContext): ContentDecideContext {
  return {
    studioId: ctx.studioId,
    actor: ctx.actor,
    role: String(ctx.role),
    now: deps.clock.now(),
    correlationId: newCorrelationId(),
    source: 'reception_web',
  }
}

/**
 * Plan several posts at once (the AI's weekly suggestion) — all or nothing: a week is offered as a
 * whole, and half a plan that silently dropped the post with a 31st hashtag is worse than a clear "no".
 */
export async function planContentPosts(
  deps: ContentDeps,
  ctx: TenantContext,
  input: { readonly origin: ContentOrigin; readonly posts: readonly ContentPostFields[] },
): Promise<Result<readonly ContentPost[], DomainError>> {
  const d = decideCtx(deps, ctx)
  const posts: ContentPost[] = []
  const events: NewEvent[] = []
  for (const fields of input.posts) {
    const r = decidePlanPost(d, { id: newContentPostId(), weekStart: istanbulWeekStart(fields.scheduledFor as number), origin: input.origin, fields })
    if (!r.ok) return r
    posts.push(r.value.next)
    events.push(...r.value.events)
  }
  await deps.repo.savePosts(ctx, posts, events)
  return { ok: true, value: posts }
}

async function withPost(
  deps: ContentDeps,
  ctx: TenantContext,
  id: string,
  decide: (d: ContentDecideContext, p: ContentPost) => Result<{ next: ContentPost; events: readonly NewEvent[] }, DomainError>,
): Promise<Result<ContentPost, DomainError>> {
  const current = await deps.repo.getPost(ctx, id)
  if (!current) return { ok: false, error: { code: 'operation_not_applicable' } }
  const r = decide(decideCtx(deps, ctx), current)
  if (!r.ok) return r
  await deps.repo.savePosts(ctx, r.value.events.length ? [r.value.next] : [], r.value.events)
  return { ok: true, value: r.value.next }
}

export const editContentPost = (deps: ContentDeps, ctx: TenantContext, id: string, fields: ContentPostFields) =>
  withPost(deps, ctx, id, (d, p) => decideEditPost(d, p, fields))

export const approveContentPost = (deps: ContentDeps, ctx: TenantContext, id: string, consentConfirmed: boolean) =>
  withPost(deps, ctx, id, (d, p) => decideApprovePost(d, p, consentConfirmed))

export const removeContentPost = (deps: ContentDeps, ctx: TenantContext, id: string) => withPost(deps, ctx, id, (d, p) => decideRemovePost(d, p))

// ── IG-2b: publishing ─────────────────────────────────────────────────────────────────────────────
// Every step is a transaction on the post, so the status the decision sees is the one it replaces.
const tx = (deps: ContentDeps, ctx: TenantContext, id: string, f: (d: ContentDecideContext, p: ContentPost) => Result<{ next: ContentPost; events: readonly NewEvent[] }, DomainError>) =>
  deps.repo.mutatePost(ctx, id, (p) => f(decideCtx(deps, ctx), p))

export const attachContentMedia = (
  deps: ContentDeps,
  ctx: TenantContext,
  id: string,
  media: Parameters<typeof decideAttachMedia>[2],
  aiCheck: Parameters<typeof decideAttachMedia>[3],
) => tx(deps, ctx, id, (d, p) => decideAttachMedia(d, p, media, aiCheck))

export const approveContentPublish = (deps: ContentDeps, ctx: TenantContext, id: string, consentConfirmed: boolean, opts: { now?: boolean } = {}) =>
  tx(deps, ctx, id, (d, p) => decideApprovePublish(d, p, consentConfirmed, opts))

export const withdrawContentPublish = (deps: ContentDeps, ctx: TenantContext, id: string) => tx(deps, ctx, id, (d, p) => decideWithdrawPublish(d, p))

/** The lock — only one run gets it. */
export const startContentPublishing = (deps: ContentDeps, ctx: TenantContext, id: string) => tx(deps, ctx, id, (d, p) => decideStartPublishing(d, p))

export const markContentPublished = (deps: ContentDeps, ctx: TenantContext, id: string, ig: { igMediaId: string; permalink: string | null }) =>
  tx(deps, ctx, id, (d, p) => decidePublished(d, p, ig))

export const markContentPublishFailed = (
  deps: ContentDeps,
  ctx: TenantContext,
  id: string,
  failure: { stage: ContentPostPublishFailedPayload['stage']; metaCode: string | null; message: string },
) => tx(deps, ctx, id, (d, p) => decidePublishFailed(d, p, failure))

// ── IG-2c: the AI edit ────────────────────────────────────────────────────────────────────────────
export const addContentRawClip = (deps: ContentDeps, ctx: TenantContext, id: string, clip: Parameters<typeof decideAddRawClip>[2]) =>
  tx(deps, ctx, id, (d, p) => decideAddRawClip(d, p, clip))

export const requestContentEdit = (deps: ContentDeps, ctx: TenantContext, id: string, overrides: ContentEditOverrides | null) =>
  tx(deps, ctx, id, (d, p) => decideRequestEdit(d, p, overrides))

export const completeContentEdit = (deps: ContentDeps, ctx: TenantContext, id: string, input: Parameters<typeof decideEditRendered>[2]) =>
  tx(deps, ctx, id, (d, p) => decideEditRendered(d, p, input))

export const failContentEdit = (
  deps: ContentDeps,
  ctx: TenantContext,
  id: string,
  input: { requestId: string; stage: ContentPostEditFailedPayload['stage']; message: string },
) => tx(deps, ctx, id, (d, p) => decideEditFailed(d, p, input))
