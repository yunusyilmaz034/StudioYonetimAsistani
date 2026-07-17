'use server'

import {
  addMemberDocument,
  DocumentKinds,
  FirestoreMemberRepository,
  listMemberDocuments,
  removeMemberDocument,
  systemClock,
  type MemberId,
} from '@studio/core'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb, adminStorage, storageBucketName } from '../firebase-admin'

// SIGNED-DOCUMENT ARCHIVE (v1.28) — the membership contract / KVKK notice / açık rıza, photographed by
// reception and archived against the member.
//
// ── Who may do this ─────────────────────────────────────────────────────────────────────────
// Reception's job, not a trainer's. `['owner','receptionist']` — the SAME gate as every other member
// write (members.ts), and the OPPOSITE of progress photos (trainer content). A trainer is refused.
//
// ── The privacy posture ─────────────────────────────────────────────────────────────────────
// The FILE was uploaded straight to a private Storage path by the client; this action only records
// metadata and, on read, mints a 5-minute signed URL per page. The image is never public, and the
// metadata lives in a server-only subcollection no client SDK can read.
const WRITERS = ['owner', 'receptionist'] as const

// A signed READ url lives 5 minutes, minted per read, never stored (same as progress photos).
const READ_URL_TTL_MS = 5 * 60_000

function deps() {
  return { repo: new FirestoreMemberRepository(adminDb()), clock: systemClock }
}

async function signedReadUrl(storagePath: string): Promise<string | null> {
  try {
    const [url] = await adminStorage()
      .bucket(storageBucketName())
      .file(storagePath)
      .getSignedUrl({ action: 'read', expires: systemClock.now() + READ_URL_TTL_MS })
    return url
  } catch {
    // No signing credentials (e.g. the emulator) — return no URL rather than a public one.
    return null
  }
}

export interface MemberDocumentPageView {
  readonly storagePath: string
  readonly url: string | null
}
export interface MemberDocumentView {
  readonly id: string
  readonly kind: (typeof DocumentKinds)[number]
  readonly uploadedAt: number
  readonly pages: readonly MemberDocumentPageView[]
}

export async function listMemberDocumentsAction(input: unknown): Promise<readonly MemberDocumentView[]> {
  const p = z.object({ memberId: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(WRITERS)
  const docs = await listMemberDocuments(deps(), ctx, p.memberId as MemberId)
  return Promise.all(
    docs.map(async (d) => ({
      id: d.id,
      kind: d.kind,
      uploadedAt: d.uploadedAt,
      pages: await Promise.all(
        d.pages.map(async (storagePath) => ({ storagePath, url: await signedReadUrl(storagePath) })),
      ),
    })),
  )
}

export async function addMemberDocumentAction(input: unknown) {
  const p = z
    .object({
      memberId: z.string().min(1),
      kind: z.enum(DocumentKinds),
      pages: z.array(z.string().min(1)).min(1),
    })
    .parse(input)
  const ctx = await requireTenantContext(WRITERS)

  // The load-bearing re-check: the client chose the Storage paths, so the server re-derives the only
  // prefix it will accept from the VERIFIED studio + member and refuses anything outside it. Without
  // this, a path could point at another member's (or another studio's) private files.
  const prefix = `studios/${ctx.studioId}/members/${p.memberId}/documents/`
  if (p.pages.some((path) => !path.startsWith(prefix))) {
    return { ok: false as const, error: { code: 'document_empty' as const } }
  }

  return addMemberDocument(deps(), ctx, { memberId: p.memberId as MemberId, kind: p.kind, pages: p.pages })
}

export async function removeMemberDocumentAction(input: unknown) {
  const p = z
    .object({
      memberId: z.string().min(1),
      documentId: z.string().min(1),
      reason: z.string().min(1),
    })
    .parse(input)
  const ctx = await requireTenantContext(WRITERS)

  const res = await removeMemberDocument(deps(), ctx, {
    memberId: p.memberId as MemberId,
    documentId: p.documentId,
    reason: p.reason,
  })

  // The event is the source of truth; the image objects go AFTER it commits (best-effort, like a
  // progress-photo removal). A leftover object without a record is invisible; a record without its
  // object would render a broken page — so we delete the object only once the record is gone.
  if (res.ok) {
    await Promise.all(
      res.value.pages.map((path) =>
        adminStorage()
          .bucket(storageBucketName())
          .file(path)
          .delete({ ignoreNotFound: true })
          .catch(() => undefined),
      ),
    )
  }
  return res
}
