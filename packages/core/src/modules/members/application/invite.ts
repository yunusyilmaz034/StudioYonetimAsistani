import {
  instant,
  newCorrelationId,
  type DomainError,
  type Instant,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import {
  decideIssueInvite,
  decidePortalActivated,
  decidePortalLogin,
} from '../domain/decide'
import { checkInviteUsable, INVITE_TTL_HOURS, type MemberInvite } from '../domain/invite'
import type { MembersDeps } from './ports'

// Same shape the other member use-cases build inline (there is no shared helper in this
// module). `reception_web` is the source for a staff-issued invite; the member's own actions
// carry the member actor via ctx.
const SOURCE = 'reception_web' as const
const dctx = (deps: MembersDeps, ctx: TenantContext) => ({
  studioId: ctx.studioId,
  actor: ctx.actor,
  now: deps.clock.now(),
  correlationId: newCorrelationId(),
  source: SOURCE,
})

const HOUR_MS = 3_600_000

// D1/D2 — issue a portal invite for a member. The caller supplies the token HASH: the raw token
// is minted at the edge (it needs a CSPRNG, which the domain may not have — non-negotiable #7)
// and is handed to reception to send over WhatsApp. It is never stored and never logged.
//
// Issuing supersedes any still-pending invite for the member, atomically (see the repository):
// exactly one live link per account, which is also what makes D17's reset flow a revocation.
export async function issueMemberInvite(
  deps: MembersDeps,
  ctx: TenantContext,
  input: { memberId: MemberId; tokenHash: string },
): Promise<Result<{ expiresAt: Instant }, DomainError>> {
  const member = await deps.repo.findById(ctx, input.memberId)
  if (!member) throw new Error(`Member not found: ${input.memberId}`)

  const now = deps.clock.now()
  const expiresAt = instant(now + INVITE_TTL_HOURS * HOUR_MS)

  const events = decideIssueInvite(dctx(deps, ctx), member, expiresAt)
  if (!events.ok) return events

  const invite: MemberInvite = {
    tokenHash: input.tokenHash,
    studioId: ctx.studioId,
    memberId: member.id,
    status: 'pending',
    issuedAt: now,
    expiresAt,
    consumedAt: null,
  }
  await deps.repo.issueInvite(ctx, invite, events.value)
  return { ok: true, value: { expiresAt } }
}

// Resolve an invite token hash to the member it opens — used BEFORE the account exists, so it
// runs under a studio-scoped context, not a member one. Every failure collapses to
// `invite_invalid`: a prober must not learn whether a token was wrong, expired, or spent.
export async function resolveInvite(
  deps: MembersDeps,
  ctx: TenantContext,
  tokenHash: string,
): Promise<Result<MemberInvite, DomainError>> {
  const invite = await deps.repo.findInviteByHash(ctx, tokenHash)
  return checkInviteUsable(invite, deps.clock.now())
}

// The member has set her password; the account is alive. The invite is consumed in the same
// transaction as the event — a link cannot be spent twice, and an activation cannot happen
// without leaving a record.
//
// `ctx` here is the MEMBER's context (actor: member): she activated her own account.
export async function completeActivation(
  deps: MembersDeps,
  ctx: TenantContext,
  invite: MemberInvite,
): Promise<Result<void, DomainError>> {
  const member = await deps.repo.findById(ctx, invite.memberId)
  if (!member) throw new Error(`Member not found: ${invite.memberId}`)
  const usable = checkInviteUsable(invite, deps.clock.now())
  if (!usable.ok) return usable

  const events = decidePortalActivated(dctx(deps, ctx), member)
  await deps.repo.consumeInvite(ctx, invite, deps.clock.now(), events)
  return { ok: true, value: undefined }
}

// A member signed in to the portal. No state changes — just the fact, attributed to her.
export async function recordPortalLogin(
  deps: MembersDeps,
  ctx: TenantContext,
  memberId: MemberId,
): Promise<Result<void, DomainError>> {
  const member = await deps.repo.findById(ctx, memberId)
  if (!member) throw new Error(`Member not found: ${memberId}`)
  await deps.repo.appendEvents(ctx, decidePortalLogin(dctx(deps, ctx), member))
  return { ok: true, value: undefined }
}
