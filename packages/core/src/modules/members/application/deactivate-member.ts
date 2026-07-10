import {
  newCorrelationId,
  type DomainError,
  type EventSource,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideDeactivate } from '../domain/decide'
import type { Member } from '../domain/member'
import type { MembersDeps } from './ports'

const SOURCE: EventSource = 'reception_web'

export async function deactivateMember(
  deps: MembersDeps,
  ctx: TenantContext,
  input: { readonly memberId: MemberId; readonly reason: string },
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.findById(ctx, input.memberId)
  if (!current) {
    throw new Error(`Member not found: ${input.memberId}`)
  }

  const now = deps.clock.now()
  const decided = decideDeactivate(
    { studioId: ctx.studioId, actor: ctx.actor, now, correlationId: newCorrelationId(), source: SOURCE },
    current,
    input.reason,
  )
  if (!decided.ok) return decided
  if (decided.value.length === 0) return { ok: true, value: undefined } // already inactive

  const next: Member = { ...current, status: 'inactive' }
  await deps.repo.deactivate(ctx, next, decided.value)
  return { ok: true, value: undefined }
}
