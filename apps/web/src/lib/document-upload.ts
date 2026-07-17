import { ref, uploadBytes } from 'firebase/storage'

import { clientStorage, storageConfigured } from '@/lib/firebase-client'

// SIGNED-DOCUMENT UPLOAD (v1.28) — the same privacy posture as progress photos.
//
// The photographed contract / KVKK / consent page never touches a Server Action: it is uploaded
// straight to a PRIVATE Storage path under the member's `documents/` prefix via the client SDK, and
// only the resulting `storagePath` is handed to `addMemberDocumentAction` (which records metadata and,
// on read, mints a short-lived signed URL). Nothing is ever public. The image is dense PII (name, TC
// kimlik, signature) and lives ONLY in that private bucket.
export class DocumentStorageUnconfiguredError extends Error {
  constructor() {
    super('Storage bucket is not configured')
    this.name = 'DocumentStorageUnconfiguredError'
  }
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

export function documentUploadConfigured(): boolean {
  return storageConfigured()
}

// Upload `file` to `studios/{studioId}/members/{memberId}/documents/{random}.{ext}` and return that
// path. The filename is a fresh random id, independent of the server-minted document id. Throws
// DocumentStorageUnconfiguredError when no bucket is configured, so the caller shows a real error
// instead of a fake success.
export async function uploadMemberDocumentPage(input: {
  studioId: string
  memberId: string
  file: File
}): Promise<string> {
  if (!storageConfigured()) throw new DocumentStorageUnconfiguredError()
  const ext = CONTENT_TYPES[input.file.type] ?? 'bin'
  const name = `${crypto.randomUUID()}.${ext}`
  const storagePath = `studios/${input.studioId}/members/${input.memberId}/documents/${name}`
  await uploadBytes(ref(clientStorage(), storagePath), input.file, { contentType: input.file.type })
  return storagePath
}
