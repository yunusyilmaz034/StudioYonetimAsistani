import {
  newCorrelationId,
  newMemberDocumentId,
  type DomainError,
  type EventSource,
  type MemberId,
  type Result,
  type TenantContext,
} from '../../../shared'
import { decideAddDocument, decideRemoveDocument } from '../domain/decide'
import type { MemberDocument } from '../domain/document'
import type { DocumentKind } from '../events'
import type { MembersDeps } from './ports'

// The signed-document archive (v1.28) — load → decide → save state + event, atomically. The images
// have already landed in private Storage (the client uploaded them); the paths arrive here and the
// use-case only mints the record, judges it, and records it. The phone is untouched, so nothing
// reindexes. `source` is `reception_web`: archiving is reception's job.
const SOURCE: EventSource = 'reception_web'

export async function addMemberDocument(
  deps: MembersDeps,
  ctx: TenantContext,
  input: { readonly memberId: MemberId; readonly kind: DocumentKind; readonly pages: readonly string[] },
): Promise<Result<{ documentId: string }, DomainError>> {
  const member = await deps.repo.findById(ctx, input.memberId)
  if (!member) throw new Error(`Member not found: ${input.memberId}`)

  const document: MemberDocument = {
    id: newMemberDocumentId(),
    memberId: input.memberId,
    kind: input.kind,
    pages: input.pages,
    uploadedBy: ctx.actor,
    uploadedAt: deps.clock.now(),
  }
  const res = decideAddDocument(
    { studioId: ctx.studioId, actor: ctx.actor, now: document.uploadedAt, correlationId: newCorrelationId(), source: SOURCE },
    member,
    document,
  )
  if (!res.ok) return res
  await deps.repo.saveDocument(ctx, document, res.value)
  return { ok: true, value: { documentId: document.id } }
}

export function listMemberDocuments(
  deps: MembersDeps,
  ctx: TenantContext,
  memberId: MemberId,
): Promise<readonly MemberDocument[]> {
  return deps.repo.listDocuments(ctx, memberId)
}

// Returns the Storage paths of the removed document so the caller (which owns the bucket) can delete
// the image objects — the domain has no I/O and never touches Storage.
export async function removeMemberDocument(
  deps: MembersDeps,
  ctx: TenantContext,
  input: { readonly memberId: MemberId; readonly documentId: string; readonly reason: string },
): Promise<Result<{ pages: readonly string[] }, DomainError>> {
  const member = await deps.repo.findById(ctx, input.memberId)
  if (!member) throw new Error(`Member not found: ${input.memberId}`)
  const document = await deps.repo.findDocument(ctx, input.memberId, input.documentId)
  if (!document) return { ok: false, error: { code: 'document_not_found' } }

  const res = decideRemoveDocument(
    { studioId: ctx.studioId, actor: ctx.actor, now: deps.clock.now(), correlationId: newCorrelationId(), source: SOURCE },
    member,
    document,
    input.reason,
  )
  if (!res.ok) return res
  await deps.repo.deleteDocument(ctx, input.memberId, input.documentId, res.value)
  return { ok: true, value: { pages: document.pages } }
}
