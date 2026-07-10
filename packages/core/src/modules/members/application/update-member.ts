import {
  newCorrelationId,
  type BranchId,
  type DomainError,
  type EventSource,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideUpdateProfile } from '../domain/decide'
import type { Email, EmergencyContact, Member } from '../domain/member'
import { normalizePhone } from '../domain/phone'
import type { MembersDeps } from './ports'

const SOURCE: EventSource = 'reception_web'

export interface UpdateMemberInput {
  readonly memberId: MemberId
  readonly fullName: string
  readonly phone: string
  readonly homeBranchId: BranchId | null
  readonly email: string | null
  readonly birthDate: string | null
  readonly notes: string | null
  readonly emergencyContact: { readonly name: string; readonly phone: string } | null
}

export async function updateMember(
  deps: MembersDeps,
  ctx: TenantContext,
  input: UpdateMemberInput,
): Promise<Result<void, DomainError>> {
  const current = await deps.repo.findById(ctx, input.memberId)
  if (!current) {
    // Editing a member that no longer exists is exceptional (the UI targets an
    // existing one); surface it as a thrown infrastructure error.
    throw new Error(`Member not found: ${input.memberId}`)
  }

  const phone = normalizePhone(input.phone)
  if (!phone.ok) return phone

  let emergencyContact: EmergencyContact | null = null
  if (input.emergencyContact) {
    const ec = normalizePhone(input.emergencyContact.phone)
    if (!ec.ok) return ec
    emergencyContact = { name: input.emergencyContact.name, phone: ec.value.e164 }
  }

  const next: Member = {
    ...current,
    homeBranchId: input.homeBranchId,
    fullName: input.fullName,
    phone: phone.value.e164,
    phoneNormalized: phone.value.normalized,
    email: input.email as Email | null,
    birthDate: input.birthDate as Member['birthDate'],
    notes: input.notes,
    emergencyContact,
  }

  const now = deps.clock.now()
  const events = decideUpdateProfile(
    { studioId: ctx.studioId, actor: ctx.actor, now, correlationId: newCorrelationId(), source: SOURCE },
    current,
    next,
  )

  return deps.repo.update(ctx, next, events, current.phoneNormalized)
}
