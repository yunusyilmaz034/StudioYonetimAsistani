import {
  newCorrelationId,
  type DomainError,
  type EventSource,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideClearRestriction, decideSetRestriction } from '../domain/decide'
import type { MemberRestriction } from '../domain/member'
import type { MembersDeps } from './ports'

// "Kısıtlı Üyelik" (Plus Phase 3) — set or clear a member's override of the package rules. Load →
// decide → save state + event, atomically. The phone is unchanged, so `update` reindexes nothing.
const SOURCE: EventSource = 'reception_web'

export async function setMemberRestriction(
  deps: MembersDeps,
  ctx: TenantContext,
  input: { readonly memberId: MemberId; readonly restriction: MemberRestriction },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.findById(ctx, input.memberId)
  if (!current) throw new Error(`Member not found: ${input.memberId}`)
  const now = deps.clock.now()
  const res = decideSetRestriction(
    { studioId: ctx.studioId, actor: ctx.actor, now, correlationId: newCorrelationId(), source: SOURCE },
    current,
    input.restriction,
  )
  if (!res.ok) return res
  if (res.value.events.length === 0) return { ok: true, value: undefined }
  return deps.repo.update(ctx, res.value.next, res.value.events, current.phoneNormalized)
}

export async function clearMemberRestriction(
  deps: MembersDeps,
  ctx: TenantContext,
  input: { readonly memberId: MemberId; readonly reason: string },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.findById(ctx, input.memberId)
  if (!current) throw new Error(`Member not found: ${input.memberId}`)
  const now = deps.clock.now()
  const res = decideClearRestriction(
    { studioId: ctx.studioId, actor: ctx.actor, now, correlationId: newCorrelationId(), source: SOURCE },
    current,
    input.reason,
  )
  if (!res.ok) return res
  if (res.value.events.length === 0) return { ok: true, value: undefined }
  return deps.repo.update(ctx, res.value.next, res.value.events, current.phoneNormalized)
}
