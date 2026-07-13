import {
  newCorrelationId,
  type DomainError,
  type EventSource,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideErase } from '../domain/decide'
import type { ErasureReason } from '../events'
import type { MembersDeps } from './ports'

const SOURCE: EventSource = 'break_glass'

// KVKK / GDPR erasure (v1.26 · AD-67, owner 2026-07-13).
//
// The tombstone and the event commit in ONE transaction (#1). This is not ceremony: an erasure that
// emptied her record but failed to write the event would be an unexplained deletion — and an
// unexplained deletion is indistinguishable, forever, from one somebody did to hide something. The
// whole reason this event exists is to make that distinction impossible to lose.
//
// The `source` is `break_glass`, not `reception_web`. It is the truth, and it is also the query the
// owner will one day want: *show me every act that bypassed the product.*
//
// **This use-case erases the AGGREGATE.** The PII that leaked outward — the `memberSnapshot` on her
// reservations (DEBT-003), her notification intents, her inbox, her Auth login — is purged by the
// break-glass script that calls this, because those are other aggregates and other systems. The
// script is the procedure; this is the decision.
export async function eraseMember(
  deps: MembersDeps,
  ctx: TenantContext,
  input: {
    readonly memberId: MemberId
    readonly reason: ErasureReason
    /** The human's explanation. It lives on the TOMBSTONE, never in the event: free text is the last
     *  place PII hides, and the log is permanent while the tombstone is not. */
    readonly note: string | null
  },
): Promise<Result<{ erased: boolean }, DomainError>> {
  const current = await deps.repo.findById(ctx, input.memberId)
  if (!current) throw new Error(`Member not found: ${input.memberId}`)

  const decided = decideErase(
    {
      studioId: ctx.studioId,
      actor: ctx.actor,
      now: deps.clock.now(),
      correlationId: newCorrelationId(),
      source: deps.source ?? SOURCE,
    },
    current,
    input.reason,
    input.note,
  )
  if (!decided.ok) return decided

  // Idempotent: she was already forgotten, so there is nothing to write and nothing to say.
  if (decided.value.events.length === 0) return { ok: true, value: { erased: false } }

  await deps.repo.deactivate(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: { erased: true } }
}
