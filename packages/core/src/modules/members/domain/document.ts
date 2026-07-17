import type { ActorRef, Instant, MemberId } from '../../../shared'
import type { DocumentKind } from '../events'

// ── The signed-document archive (v1.28) ───────────────────────────────────────────────────────
// A member document is a scanned/photographed legal instrument — the signed membership contract, the
// KVKK notice, the açık rıza consent — kept against the member for compliance. One document is ONE
// kind and 1..N pages (the contract is two); each page is a private Storage object.
//
// PII discipline: the record holds the Storage PATHS, never the pixels, and it lives in a server-only
// subcollection (`members/{id}/documents`) — no client SDK ever reads it; the staff app receives a
// short-lived signed URL per page from a Server Action. On erasure the paths are what the purger uses
// to empty the Storage prefix, and the metadata subcollection goes with it.
export interface MemberDocument {
  readonly id: string
  readonly memberId: MemberId
  readonly kind: DocumentKind
  // Storage object paths, one per page, in reading order. A signed URL is minted on read, never stored.
  readonly pages: readonly string[]
  readonly uploadedBy: ActorRef
  readonly uploadedAt: Instant
}
