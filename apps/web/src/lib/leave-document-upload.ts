import { ref, uploadBytes } from 'firebase/storage'

import { DocumentStorageUnconfiguredError } from '@/lib/document-upload'
import { clientStorage, storageConfigured } from '@/lib/firebase-client'

// İZNE RAPOR DOSYASI (owner, 2026-09-14 · OR-77, karar 4) — üye belgeleriyle aynı mahremiyet duruşu.
//
// Dosya Server Action'a hiç uğramaz: istemci SDK ile ÖZEL Storage yoluna yüklenir, action'a yalnızca
// yol verilir. Action yolun önekini sunucuda yeniden türetir ve iznin sahibi (ya da owner) olup
// olmadığını sorar; kaydı olmayan bir nesne görünmezdir. Okuma istemciden hiçbir zaman yapılamaz.
//
// PDF DE KABUL, bilerek: e-Nabız'dan alınan rapor bir PDF'tir, fotoğrafını çekmek onu okunmaz yapar.

const TURLER: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
}

/** `storage.rules` ile aynı sınır. İstemcide önce söylenir ki kullanıcı yüklemenin bitmesini beklemesin. */
export const LEAVE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

export class LeaveDocumentFileError extends Error {
  constructor(readonly reason: 'type' | 'size') {
    super(reason === 'type' ? 'Unsupported file type' : 'File too large')
    this.name = 'LeaveDocumentFileError'
  }
}

export const LEAVE_DOCUMENT_ACCEPT = Object.keys(TURLER).join(',')

/** `prefix` sunucudan gelir (`studios/{sid}/staffLeaves/{leaveId}/documents/`). Yüklenen yolu döndürür. */
export async function uploadLeaveDocumentPage(input: { prefix: string; file: File }): Promise<string> {
  if (!storageConfigured()) throw new DocumentStorageUnconfiguredError()
  const ext = TURLER[input.file.type]
  if (!ext) throw new LeaveDocumentFileError('type')
  if (input.file.size > LEAVE_DOCUMENT_MAX_BYTES) throw new LeaveDocumentFileError('size')
  const storagePath = `${input.prefix}${crypto.randomUUID()}.${ext}`
  await uploadBytes(ref(clientStorage(), storagePath), input.file, { contentType: input.file.type })
  return storagePath
}
