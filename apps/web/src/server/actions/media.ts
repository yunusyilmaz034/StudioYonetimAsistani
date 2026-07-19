'use server'

import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb, adminStorage, storageBucketName } from '../firebase-admin'

// ── MEDYA MERKEZİ (Media Center) — one place for every image the studio uploads. Files live in
//    Storage with a stable Firebase download URL (token in metadata: public-with-token, never expires,
//    UBLA-safe); a light metadata doc (studios/{sid}/media) makes them browsable, copyable and
//    deletable, and picker dialogs reuse the same library. Non-PII config. ──

const OWNER = ['owner', 'platform_admin'] as const
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

export interface MediaItem {
  readonly id: string
  readonly url: string
  readonly name: string
  readonly path: string // Storage path, for deletion
  readonly uploadedAt: number
}

const col = (studioId: string) => adminDb().collection('studios').doc(studioId).collection('media')

export async function listMediaAction(): Promise<readonly MediaItem[]> {
  const ctx = await requireTenantContext(OPS)
  const snap = await col(ctx.studioId).get()
  return snap.docs
    .map((d) => {
      const x = d.data()
      return {
        id: d.id,
        url: String(x.url ?? ''),
        name: String(x.name ?? 'Görsel'),
        path: String(x.path ?? ''),
        uploadedAt: Number(x.uploadedAt ?? 0),
      }
    })
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
}

export async function uploadMediaAction(input: unknown) {
  const p = z.object({ dataUrl: z.string().min(1), name: z.string().trim().max(80).optional() }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(p.dataUrl)
  const mime = m?.[1]
  const b64 = m?.[2]
  if (!mime || !b64) return { ok: false as const, error: { code: 'invalid_image' as const } }
  const buf = Buffer.from(b64, 'base64')
  if (buf.length > 6_000_000) return { ok: false as const, error: { code: 'image_too_large' as const } }

  const { randomUUID } = await import('node:crypto')
  const token = randomUUID()
  const ext = mime.split('/')[1] ?? 'jpg'
  const path = `studios/${ctx.studioId}/media/${Date.now()}.${ext}`
  const bucket = storageBucketName()
  await adminStorage()
    .bucket(bucket)
    .file(path)
    .save(buf, { contentType: mime, resumable: false, metadata: { metadata: { firebaseStorageDownloadTokens: token } } })
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`

  const ref = col(ctx.studioId).doc()
  await ref.set({ url, name: p.name?.trim() || 'Görsel', path, uploadedAt: Date.now() })
  return { ok: true as const, value: { id: ref.id, url } }
}

export async function deleteMediaAction(input: unknown) {
  const p = z.object({ id: z.string().min(1) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const doc = await col(ctx.studioId).doc(p.id).get()
  const path = doc.data()?.path as string | undefined
  if (path) await adminStorage().bucket(storageBucketName()).file(path).delete().catch(() => {})
  await col(ctx.studioId).doc(p.id).delete()
  return { ok: true as const }
}
