import {
  newCorrelationId,
  type DomainError,
  type EventSource,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideRequestDeletion } from '../domain/decide'
import type { MemberDeletionRequestedPayload } from '../events'
import type { MembersDeps } from './ports'

// "Hesabımı sil", from the member's own phone (App Store guideline 5.1.1(v), 2026-07-27).
//
// The App Store requires that an app which has accounts lets the user delete hers from inside the
// app. Our members do not sign themselves up — the studio invites them — but a reviewer sees a login
// screen and expects a way out, and arguing that point costs a week of review time we do not have.
//
// What this does and, more importantly, what it does NOT do:
//
//   ✓ records the request, once, as an event
//   ✓ marks her record so the desk knows there is an erasure to complete
//   ✗ does NOT erase her — that is break-glass and platform-admin only (AD-67), because her payments
//     and invoices are the STUDIO's records under a statutory retention period. A member must not be
//     able to put the studio in breach of tax law from a phone, and Apple's guideline explicitly
//     allows keeping what law requires.
//
// The thing that makes this a real deletion from where she stands — destroying her login so she
// cannot get back in — is the CALLER's job: it is an Auth operation, not a domain decision, and it
// must happen whether or not this writes an event (she may be asking a second time).

export async function requestMemberDeletion(
  deps: MembersDeps,
  ctx: TenantContext,
  input: {
    readonly memberId: MemberId
    readonly source: MemberDeletionRequestedPayload['source']
  },
): Promise<Result<{ requested: boolean }, DomainError>> {
  const current = await deps.repo.findById(ctx, input.memberId)
  if (!current) throw new Error(`Member not found: ${input.memberId}`)

  const decided = decideRequestDeletion(
    {
      studioId: ctx.studioId,
      actor: ctx.actor,
      now: deps.clock.now(),
      correlationId: newCorrelationId(),
      source: (deps.source ?? 'member_app') as EventSource,
    },
    current,
    input.source,
  )
  if (!decided.ok) return decided

  // Idempotent: she already asked. Nothing to write, and no error — a second tap is the same request.
  if (decided.value.events.length === 0) return { ok: true, value: { requested: false } }

  // `deactivate` is the port that writes the member document + its events atomically WITHOUT
  // touching the phone-uniqueness document — which is exactly right here: her number stays reserved
  // until a real erasure, so nobody else can be registered onto it in the meantime.
  await deps.repo.deactivate(ctx, decided.value.next, decided.value.events)
  return { ok: true, value: { requested: true } }
}
