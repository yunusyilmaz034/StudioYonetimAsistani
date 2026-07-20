'use server'

import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb, adminStorage, storageBucketName } from '../firebase-admin'

// ── GERİ BİLDİRİM (in-app bug report) ────────────────────────────────────────────────────────
// A "Bildir" button sits on every staff screen. Reception no longer phones the owner about a bug —
// she captures the page, writes a line, and it lands here for the owner to review in one place. The
// screenshot is a rendering of the panel (no member is the subject; any PII on screen is the studio's
// own operational data the reporter already sees), stored in Storage; the note + page + role live in
// Firestore. Owner-only to read.

const OWNER = ['owner', 'platform_admin'] as const
const STAFF = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const

const col = (studioId: string) => adminDb().collection('studios').doc(studioId).collection('feedback')

export interface BugReport {
  readonly id: string
  readonly note: string
  readonly page: string
  readonly imageUrl: string
  readonly role: string
  readonly userAgent: string
  readonly createdAt: number
  readonly resolved: boolean
}

// Any staff member can file a report. The screenshot is optional — a note alone is still a report.
export async function submitBugReportAction(input: unknown) {
  const p = z
    .object({
      note: z.string().trim().max(2000),
      page: z.string().trim().max(300),
      dataUrl: z.string().optional(),
      userAgent: z.string().trim().max(300).optional(),
    })
    .parse(input)
  if (!p.note && !p.dataUrl) return { ok: false as const, error: { code: 'empty_report' as const } }

  const ctx = await requireTenantContext(STAFF)

  let imageUrl = ''
  if (p.dataUrl) {
    const m = /^data:(image\/\w+);base64,(.+)$/s.exec(p.dataUrl)
    const mime = m?.[1]
    const b64 = m?.[2]
    if (mime && b64) {
      const buf = Buffer.from(b64, 'base64')
      if (buf.length <= 10_000_000) {
        const { randomUUID } = await import('node:crypto')
        const token = randomUUID()
        const ext = mime.split('/')[1] ?? 'png'
        const path = `studios/${ctx.studioId}/feedback/${Date.now()}.${ext}`
        const bucket = storageBucketName()
        await adminStorage()
          .bucket(bucket)
          .file(path)
          .save(buf, {
            contentType: mime,
            resumable: false,
            metadata: { metadata: { firebaseStorageDownloadTokens: token } },
          })
        imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
      }
    }
  }

  const ref = col(ctx.studioId).doc()
  await ref.set({
    note: p.note,
    page: p.page,
    imageUrl,
    role: ctx.role,
    userAgent: p.userAgent ?? '',
    createdAt: Date.now(),
    resolved: false,
  })
  return { ok: true as const, value: { id: ref.id } }
}

export async function listBugReportsAction(): Promise<readonly BugReport[]> {
  const ctx = await requireTenantContext(OWNER)
  const snap = await col(ctx.studioId).get()
  return snap.docs
    .map((d) => {
      const x = d.data()
      return {
        id: d.id,
        note: String(x.note ?? ''),
        page: String(x.page ?? ''),
        imageUrl: String(x.imageUrl ?? ''),
        role: String(x.role ?? ''),
        userAgent: String(x.userAgent ?? ''),
        createdAt: Number(x.createdAt ?? 0),
        resolved: Boolean(x.resolved),
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function resolveBugReportAction(input: unknown) {
  const p = z.object({ id: z.string().min(1), resolved: z.boolean() }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  await col(ctx.studioId).doc(p.id).set({ resolved: p.resolved }, { merge: true })
  return { ok: true as const }
}
