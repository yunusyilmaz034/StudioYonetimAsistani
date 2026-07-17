import type {
  ActorType,
  Clock,
  DomainError,
  EventSource,
  Instant,
  MemberId,
  NewEvent,
  Result,
  TenantContext,
} from '../../../shared'
import type { MemberActivityField } from '../domain/activity'
import type { MemberDocument } from '../domain/document'
import type { Member } from '../domain/member'
import type { MemberInvite } from '../domain/invite'

// A row of the Member Workspace audit timeline (v1.18) — one of the member's events.
// PII-free by construction (non-negotiable #6): only type, time, and actor kind.
export interface MemberEventRecord {
  readonly type: string
  readonly occurredAt: Instant
  readonly actorType: ActorType
  readonly payload: Readonly<Record<string, unknown>>
}

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

  // Member Workspace audit timeline (v1.18): the member's events (any aggregate that
  // stamped `related.memberId`), newest first, capped at `limit`. Equality-only query
  // (auto-indexed); sorted and sliced in memory, like listEntitlementEvents.
  listMemberEvents(
    ctx: TenantContext,
    id: MemberId,
    limit: number,
  ): Promise<readonly MemberEventRecord[]>

  // ── The portal invite (v1.21) ──
  // Issue: write the new invite AND supersede every still-pending invite for that member, in
  // ONE transaction. Two live links for the same account is the failure mode this prevents.
  issueInvite(
    ctx: TenantContext,
    invite: MemberInvite,
    events: readonly NewEvent[],
  ): Promise<void>

  // Looked up by the HASH of the token; the raw token never reaches the database.
  findInviteByHash(ctx: TenantContext, tokenHash: string): Promise<MemberInvite | null>

  // Consume: mark used + append the activation event, atomically. A second attempt with the
  // same link finds `status !== 'pending'` and is refused.
  consumeInvite(
    ctx: TenantContext,
    invite: MemberInvite,
    consumedAt: Instant,
    events: readonly NewEvent[],
  ): Promise<void>

  // Append-only: an event with no state change (the member logged in).
  appendEvents(ctx: TenantContext, events: readonly NewEvent[]): Promise<void>

  // ── Activity stats (Phase 2 · churn) ──
  // Move a recency field (lastCheckInAt / lastAttendanceAt) FORWARD to `at`, transactionally. A MAX:
  // idempotent, and it never regresses on a redelivery or an out-of-order event. Denormalised state on
  // the member doc; no event (it is rebuildable from the log via member-stats:rebuild).
  touchActivity(ctx: TenantContext, memberId: MemberId, field: MemberActivityField, at: Instant): Promise<void>

  // ── The signed-document archive (v1.28) ──
  // Metadata lives in a server-only subcollection `members/{id}/documents`; the images are private
  // Storage objects the client uploaded before calling in. Each write commits state + event atomically.
  saveDocument(ctx: TenantContext, document: MemberDocument, events: readonly NewEvent[]): Promise<void>
  listDocuments(ctx: TenantContext, memberId: MemberId): Promise<readonly MemberDocument[]>
  findDocument(ctx: TenantContext, memberId: MemberId, documentId: string): Promise<MemberDocument | null>
  deleteDocument(
    ctx: TenantContext,
    memberId: MemberId,
    documentId: string,
    events: readonly NewEvent[],
  ): Promise<void>
}

export interface MembersDeps {
  readonly repo: MemberRepository
  readonly clock: Clock
  // See FinanceDeps.source — the migration stamps `migration`, never `reception_web`.
  readonly source?: EventSource
}
