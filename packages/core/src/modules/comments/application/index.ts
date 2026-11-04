// Load → decide → transact, for Instagram comments (IG-3).
import { newCorrelationId, type Clock, type DomainError, type NewEvent, type Result, type TenantContext } from '../../../shared'
import { checkHide, checkReply, decideDismiss, decideHidden, decideReceiveComment, decideReplied, type CommentDecideContext } from '../domain/decide'
import type { IgComment } from '../domain/types'

export interface CommentRepository {
  get(ctx: TenantContext, id: string): Promise<IgComment | null>
  existingIds(ctx: TenantContext, ids: readonly string[]): Promise<ReadonlySet<string>>
  listByStatus(ctx: TenantContext, status: IgComment['status'], limit: number): Promise<readonly IgComment[]>
  listRecent(ctx: TenantContext, limit: number): Promise<readonly IgComment[]>
  /** Create only if absent — a poll that overlaps another never records a comment twice. */
  createIfAbsent(ctx: TenantContext, c: IgComment, events: readonly NewEvent[]): Promise<boolean>
  mutate(ctx: TenantContext, id: string, decide: (c: IgComment) => Result<{ next: IgComment; events: readonly NewEvent[] }, DomainError>): Promise<Result<IgComment, DomainError>>
  saveFailure(ctx: TenantContext, c: IgComment): Promise<void>
}

export interface CommentDeps {
  readonly repo: CommentRepository
  readonly clock: Clock
}

const d = (deps: CommentDeps, ctx: TenantContext, source = 'reception_web'): CommentDecideContext => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  role: String(ctx.role),
  now: deps.clock.now(),
  correlationId: newCorrelationId(),
  source,
})

export async function receiveIgComment(deps: CommentDeps, ctx: TenantContext, input: Parameters<typeof decideReceiveComment>[1]): Promise<boolean> {
  const r = decideReceiveComment(d(deps, ctx, 'system'), input)
  if (!r.ok) return false
  return deps.repo.createIfAbsent(ctx, r.value.next, r.value.events)
}

/**
 * Reply: check → Instagram → record. The check runs first so a forbidden or priced reply never reaches
 * Meta; the record is written after Meta accepted (the reply is public at that point).
 */
export async function replyToIgComment(
  deps: CommentDeps,
  ctx: TenantContext,
  id: string,
  text: string,
  send: (commentId: string, text: string) => Promise<{ igReplyId: string }>,
): Promise<Result<IgComment, DomainError | { code: 'meta_refused'; message: string }>> {
  const c = await deps.repo.get(ctx, id)
  if (!c) return { ok: false, error: { code: 'operation_not_applicable' } }
  const checked = checkReply(d(deps, ctx), c, text)
  if (!checked.ok) return checked
  let sent: { igReplyId: string }
  try {
    sent = await send(c.id, checked.value)
  } catch (e) {
    const message = (e as Error)?.message ?? 'Instagram kabul etmedi'
    await deps.repo.saveFailure(ctx, { ...c, lastFailure: { message: message.slice(0, 300), at: deps.clock.now() } })
    return { ok: false, error: { code: 'meta_refused', message } }
  }
  return deps.repo.mutate(ctx, id, (cur) => decideReplied(d(deps, ctx), cur, { text: checked.value, igReplyId: sent.igReplyId }))
}

export async function hideIgComment(
  deps: CommentDeps,
  ctx: TenantContext,
  id: string,
  hide: (commentId: string) => Promise<void>,
): Promise<Result<IgComment, DomainError | { code: 'meta_refused'; message: string }>> {
  const c = await deps.repo.get(ctx, id)
  if (!c) return { ok: false, error: { code: 'operation_not_applicable' } }
  const checked = checkHide(d(deps, ctx), c)
  if (!checked.ok) return checked
  try {
    await hide(c.id)
  } catch (e) {
    const message = (e as Error)?.message ?? 'Instagram kabul etmedi'
    await deps.repo.saveFailure(ctx, { ...c, lastFailure: { message: message.slice(0, 300), at: deps.clock.now() } })
    return { ok: false, error: { code: 'meta_refused', message } }
  }
  return deps.repo.mutate(ctx, id, (cur) => decideHidden(d(deps, ctx), cur))
}

export const dismissIgComment = (deps: CommentDeps, ctx: TenantContext, id: string) => deps.repo.mutate(ctx, id, (cur) => decideDismiss(d(deps, ctx), cur))
