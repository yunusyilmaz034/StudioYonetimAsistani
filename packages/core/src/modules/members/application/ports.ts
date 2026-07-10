import type {
  Clock,
  DomainError,
  MemberId,
  NewEvent,
  Result,
  TenantContext,
} from '../../../shared'
import type { Member } from '../domain/member'

// The application depends on these; infrastructure implements them. All ids are
// domain MemberIds — the repository owns the MemberId <-> Firestore document-id
// mapping (decision #2), and enforces phone uniqueness atomically through the
// members_by_phone document (decision #1).
export interface MemberRepository {
  findById(ctx: TenantContext, id: MemberId): Promise<Member | null>

  // All members of the studio, ordered by name. Read server-side; the client
  // filters the cached list locally in Phase 1 (DEBT-001).
  list(ctx: TenantContext): Promise<readonly Member[]>

  // Create member + members_by_phone + events atomically. Returns
  // phone_already_registered (with the existing member's id) if the phone is taken.
  register(
    ctx: TenantContext,
    member: Member,
    events: readonly NewEvent[],
  ): Promise<Result<void, DomainError>>

  // Update member + events atomically. If the normalized phone changed, swap the
  // uniqueness document (create new, delete old) in the same transaction.
  update(
    ctx: TenantContext,
    member: Member,
    events: readonly NewEvent[],
    previousPhoneNormalized: string,
  ): Promise<Result<void, DomainError>>

  // Deactivate (status change) + events atomically. The uniqueness document is
  // kept, so the phone stays reserved until a future hard erasure.
  deactivate(ctx: TenantContext, member: Member, events: readonly NewEvent[]): Promise<void>
}

export interface MembersDeps {
  readonly repo: MemberRepository
  readonly clock: Clock
}
