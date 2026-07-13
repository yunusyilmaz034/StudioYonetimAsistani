import {
  newCorrelationId,
  newMemberId,
  ok,
  type BranchId,
  type DomainError,
  type EventSource,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideRegisterMember } from '../domain/decide'
import { emptyStats, type Email, type EmergencyContact, type Member } from '../domain/member'
import { normalizePhone } from '../domain/phone'
import type { MembersDeps } from './ports'

const SOURCE: EventSource = 'reception_web'

// Inputs are already zod-validated at the server-action boundary (Doc 6 §8);
// phone normalisation is domain-specific and happens here.
export interface RegisterMemberInput {
  readonly fullName: string
  readonly phone: string
  readonly homeBranchId: BranchId | null
  readonly email: string | null
  readonly birthDate: string | null // 'YYYY-MM-DD'
  readonly notes: string | null
  readonly emergencyContact: { readonly name: string; readonly phone: string } | null
}

export async function registerMember(
  deps: MembersDeps,
  ctx: TenantContext,
  input: RegisterMemberInput,
): Promise<Result<{ memberId: MemberId }, DomainError>> {
  const phone = normalizePhone(input.phone)
  if (!phone.ok) return phone

  let emergencyContact: EmergencyContact | null = null
  if (input.emergencyContact) {
    const ec = normalizePhone(input.emergencyContact.phone)
    if (!ec.ok) return ec
    emergencyContact = { name: input.emergencyContact.name, phone: ec.value.e164 }
  }

  const id = newMemberId()
  const now = deps.clock.now()
  const member: Member = {
    id,
    studioId: ctx.studioId,
    homeBranchId: input.homeBranchId,
    fullName: input.fullName,
    phone: phone.value.e164,
    phoneNormalized: phone.value.normalized,
    email: input.email as Email | null,
    birthDate: input.birthDate as Member['birthDate'],
    notes: input.notes,
    emergencyContact,
    status: 'active',
    joinedAt: now,
    stats: emptyStats(),
  }

  const events = decideRegisterMember(
    {
      studioId: ctx.studioId,
      actor: ctx.actor,
      now,
      correlationId: newCorrelationId(),
      // The migration stamps `migration` here. An imported member who claims she was registered
      // at reception is a small lie, and the log keeps small lies forever.
      source: deps.source ?? SOURCE,
    },
    member,
  )

  const res = await deps.repo.register(ctx, member, events)
  if (!res.ok) return res
  return ok({ memberId: id })
}
