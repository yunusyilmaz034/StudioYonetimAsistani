// PURE decisions for Instagram comments (IG-3, 2026-11-04). Owner's rules:
//
//   · The AI never sends. A person presses "Gönder" — on the AI's draft or their own words.
//   · Questions and praise: the owner or reception may reply. COMPLAINTS: the owner only. HIDING: the
//     owner only. A trainer does not answer in the studio's name.
//   · No price in a public reply — prices go to DM/WhatsApp (one price, said privately: OR-129).
//   · First run: comments older than 7 days arrive closed (history, not work).
import { err, ok, type ActorRef, type DomainError, type Instant, type NewEvent, type Result, type StudioId } from '../../../shared'
import { IG_COMMENT_DISMISSED, IG_COMMENT_HIDDEN, IG_COMMENT_RECEIVED, IG_COMMENT_REPLIED, type CommentCategory } from '../events'
import type { IgComment } from './types'

export interface CommentDecideContext {
  readonly studioId: StudioId
  readonly actor: ActorRef
  readonly role: string
  readonly now: Instant
  readonly correlationId: string
  readonly source: string
}

export interface CommentOutcome {
  readonly next: IgComment
  readonly events: readonly NewEvent[]
}

export const COMMENT_LIMITS = { reply: 2200, openWindowDays: 7 } as const

const OWNER: readonly string[] = ['owner', 'platform_admin']
const DESK: readonly string[] = ['owner', 'platform_admin', 'receptionist']
const CATEGORIES: readonly CommentCategory[] = ['question', 'praise', 'complaint', 'spam', 'other']

const base = (ctx: CommentDecideContext, id: string) => ({
  studioId: ctx.studioId,
  branchId: null,
  version: 1,
  occurredAt: ctx.now,
  actor: ctx.actor,
  source: ctx.source,
  subject: { kind: 'igComment' as const, id },
  related: {},
  policyRef: null,
  commandId: null,
  causationId: null,
  correlationId: ctx.correlationId as never,
})

/** A price written in a reply: "1.500 TL", "1500₺", "₺ 900", "900 lira". Turkish-folded. */
export function containsPrice(text: string): boolean {
  const t = text.toLocaleLowerCase('tr')
  return /\d[\d.,]*\s*(tl\b|₺|lira|try\b)/u.test(t) || /(₺|\btl)\s*\d/u.test(t)
}

export function decideReceiveComment(
  ctx: CommentDecideContext,
  input: Pick<IgComment, 'id' | 'mediaId' | 'mediaLabel' | 'mediaPermalink' | 'username' | 'text' | 'commentedAt' | 'category' | 'draft'>,
): Result<CommentOutcome, DomainError> {
  const category = CATEGORIES.includes(input.category) ? input.category : 'other'
  const open = (ctx.now as number) - (input.commentedAt as number) <= COMMENT_LIMITS.openWindowDays * 86_400_000
  const draft = category === 'spam' || !input.draft?.trim() ? null : input.draft.trim().slice(0, COMMENT_LIMITS.reply)
  const next: IgComment = {
    ...input,
    studioId: ctx.studioId,
    category,
    draft,
    status: open ? 'open' : 'closed',
    receivedAt: ctx.now,
    handledAt: null,
    handledBy: null,
    reply: null,
    lastFailure: null,
  }
  return ok({
    next,
    events: [{ ...base(ctx, input.id), type: IG_COMMENT_RECEIVED, payload: { mediaId: input.mediaId, category, commentedAt: input.commentedAt, open } }],
  })
}

/** Who may answer THIS comment. */
export function mayReply(role: string, c: Pick<IgComment, 'category'>): boolean {
  return c.category === 'complaint' ? OWNER.includes(role) : DESK.includes(role)
}

/** Checked BEFORE the reply goes to Instagram — so a refused reply never reaches Meta. */
export function checkReply(ctx: Pick<CommentDecideContext, 'role'>, c: IgComment, text: string): Result<string, DomainError> {
  if (c.status !== 'open') return err({ code: 'comment_not_open' })
  if (!mayReply(ctx.role, c)) return err({ code: 'comment_forbidden' })
  const t = text.trim()
  if (t.length === 0 || t.length > COMMENT_LIMITS.reply) return err({ code: 'comment_invalid', field: 'text' })
  if (containsPrice(t)) return err({ code: 'comment_invalid', field: 'price' })
  return ok(t)
}

/** Instagram accepted the reply. Recorded after the fact — the reply is public already. */
export function decideReplied(ctx: CommentDecideContext, c: IgComment, reply: { text: string; igReplyId: string }): Result<CommentOutcome, DomainError> {
  const checked = checkReply(ctx, c, reply.text)
  if (!checked.ok) return checked
  const edited = c.draft == null || c.draft.trim() !== checked.value
  return ok({
    next: { ...c, status: 'replied', handledAt: ctx.now, handledBy: ctx.actor, reply: { text: checked.value, igReplyId: reply.igReplyId, edited }, lastFailure: null },
    events: [{ ...base(ctx, c.id), type: IG_COMMENT_REPLIED, payload: { category: c.category, edited, hadDraft: c.draft != null } }],
  })
}

export function checkHide(ctx: Pick<CommentDecideContext, 'role'>, c: IgComment): Result<true, DomainError> {
  if (!OWNER.includes(ctx.role)) return err({ code: 'comment_forbidden' })
  if (c.status !== 'open' && c.status !== 'closed') return err({ code: 'comment_not_open' })
  return ok(true)
}

/** Instagram hid it (not deleted — it can be shown again from Instagram). */
export function decideHidden(ctx: CommentDecideContext, c: IgComment): Result<CommentOutcome, DomainError> {
  const checked = checkHide(ctx, c)
  if (!checked.ok) return checked
  return ok({
    next: { ...c, status: 'hidden', handledAt: ctx.now, handledBy: ctx.actor, lastFailure: null },
    events: [{ ...base(ctx, c.id), type: IG_COMMENT_HIDDEN, payload: { category: c.category } }],
  })
}

/** "Geç" — no answer needed. A complaint is passed over by the owner only. */
export function decideDismiss(ctx: CommentDecideContext, c: IgComment): Result<CommentOutcome, DomainError> {
  if (c.status !== 'open') return err({ code: 'comment_not_open' })
  if (!mayReply(ctx.role, c)) return err({ code: 'comment_forbidden' })
  return ok({
    next: { ...c, status: 'dismissed', handledAt: ctx.now, handledBy: ctx.actor },
    events: [{ ...base(ctx, c.id), type: IG_COMMENT_DISMISSED, payload: { category: c.category } }],
  })
}

/** Meta refused (deleted comment, rate limit): shown on the card; no event — nothing changed. */
export function withFailure(c: IgComment, message: string, at: Instant): IgComment {
  return { ...c, lastFailure: { message: message.slice(0, 300), at } }
}
