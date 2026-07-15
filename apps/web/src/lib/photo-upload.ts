import { ref, uploadBytes } from 'firebase/storage'

import { clientStorage, storageConfigured } from '@/lib/firebase-client'

// PROGRESS-PHOTO UPLOAD (Plus Phase 7 · §2 privacy).
//
// The FILE never touches a Server Action — it is uploaded straight to a PRIVATE Storage path via the
// rules-guarded client SDK, and only the resulting `storagePath` is handed to `addProgressPhotoAction`
// (which then mints the ProgressPhoto record and, on read, a short-lived signed URL). Nothing here is
// ever public, and the object path is the member's private prefix the server re-checks.
//
// The Storage FILENAME is a fresh random id, independent of the server-minted ProgressPhoto id: the
// client cannot know that id before the record exists, and it does not need to — the record simply
// stores whichever path the file landed at. `crypto.randomUUID()` is a browser primitive (this is
// client-only UI code, not a pure domain function, so it is allowed here).
export class PhotoStorageUnconfiguredError extends Error {
  constructor() {
    super('Storage bucket is not configured')
    this.name = 'PhotoStorageUnconfiguredError'
  }
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

export function progressUploadConfigured(): boolean {
  return storageConfigured()
}

// Upload `file` to `studios/{studioId}/members/{memberId}/progress/{random}.{ext}` and return that
// path. Throws PhotoStorageUnconfiguredError when no bucket is configured, so the caller can show
// "yükleme yapılandırılmamış" instead of a fake success.
export async function uploadProgressPhoto(input: {
  studioId: string
  memberId: string
  file: File
}): Promise<string> {
  if (!storageConfigured()) throw new PhotoStorageUnconfiguredError()
  const ext = CONTENT_TYPES[input.file.type] ?? 'bin'
  const name = `${crypto.randomUUID()}.${ext}`
  const storagePath = `studios/${input.studioId}/members/${input.memberId}/progress/${name}`
  await uploadBytes(ref(clientStorage(), storagePath), input.file, { contentType: input.file.type })
  return storagePath
}
