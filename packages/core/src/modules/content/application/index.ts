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
