'use server'

import { addContentRawClip, FirestoreContentRepository, requestContentEdit, systemClock, type MusicTrack } from '@studio/core'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb, adminStorage, storageBucketName } from '../firebase-admin'
import type { PublishResult } from './content-publish'

// IG-2c — raw clips, the AI edit request, and the owner's music library. The cut itself runs on the
// server (Cloud Run job `content-render`, started by onEventCreated); nothing here touches the video.
const TEAM = ['owner', 'receptionist', 'trainer', 'platform_admin'] as const
const OWNER = ['owner', 'platform_admin'] as const
const POST_ID = z.string().regex(/^cnt_[0-9A-Z]{26}$/)
const deps = () => ({ repo: new FirestoreContentRepository(adminDb()), clock: systemClock })
const bucket = () => adminStorage().bucket(storageBucketName())
const settingsRef = (sid: string) => adminDb().doc(`studios/${sid}/settings/content`)

/** The clip is already in `studios/{sid}/content/{postId}/raw/…`. Size and type are read from STORAGE. */
export async function addRawClipAction(input: unknown): Promise<PublishResult> {
  const p = z
    .object({
      id: POST_ID,
      slot: z.number().int().min(0).max(7),
      storagePath: z.string().max(300),
      seconds: z.number().positive().max(3600),
      width: z.number().int().positive().max(10000),
      height: z.number().int().positive().max(10000),
    })
    .parse(input)
  const ctx = await requireTenantContext(TEAM)
  const sid = String(ctx.studioId)
  if (!p.storagePath.startsWith(`studios/${sid}/content/${p.id}/raw/`)) return { ok: false, error: { code: 'upload_missing' } }
  const file = bucket().file(p.storagePath)
  const [exists] = await file.exists()
  if (!exists) return { ok: false, error: { code: 'upload_missing' } }
  const [meta] = await file.getMetadata()
  const before = await deps().repo.getPost(ctx, p.id)
  const r = await addContentRawClip(deps(), ctx, p.id, {
    slot: p.slot,
    storagePath: p.storagePath,
    contentType: String(meta.contentType ?? ''),
    bytes: Number(meta.size ?? 0),
    seconds: Math.round(p.seconds * 10) / 10,
    width: p.width,
    height: p.height,
  })
  if (!r.ok) {
    await file.delete({ ignoreNotFound: true }) // a refused clip is not kept
    return { ok: false, error: r.error }
  }
  const old = before?.rawClips?.find((c) => c.slot === p.slot)?.storagePath
  if (old && old !== p.storagePath) await bucket().file(old).delete({ ignoreNotFound: true })
  return { ok: true, value: undefined }
}

const overridesSchema = z.object({
  hook: z.string().max(200),
  lines: z.array(z.object({ id: z.string().max(20), text: z.string().max(300) })).max(400),
  musicTrackId: z.string().max(60).nullable(),
  subtitles: z.boolean(),
})

/** "AI kurgula" (no overrides) or "Yeniden kurgula" (a person's changes; the cuts stay). */
export async function requestContentEditAction(input: unknown): Promise<PublishResult> {
  const p = z.object({ id: POST_ID, overrides: overridesSchema.nullable() }).parse(input)
  const ctx = await requireTenantContext(TEAM)
  const r = await requestContentEdit(deps(), ctx, p.id, p.overrides)
  return r.ok ? { ok: true, value: undefined } : { ok: false, error: r.error }
}

// ── the music library (settings/content.music) — data, like the area names ────────────────────────
export interface MusicLibrary {
  readonly tracks: readonly MusicTrack[]
  readonly canEdit: boolean
}

export async function musicLibraryAction(): Promise<MusicLibrary> {
  const ctx = await requireTenantContext(TEAM)
  const tracks = ((await settingsRef(String(ctx.studioId)).get()).get('music') as MusicTrack[] | undefined) ?? []
  return { tracks, canEdit: (OWNER as readonly string[]).includes(String(ctx.role)) }
}

export async function addMusicTrackAction(input: unknown): Promise<{ ok: boolean }> {
  const p = z
    .object({ storagePath: z.string().max(200), name: z.string().trim().min(1).max(60), mood: z.string().trim().max(30), seconds: z.number().int().positive().max(1200), source: z.string().trim().max(60) })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  const sid = String(ctx.studioId)
  if (!p.storagePath.startsWith(`studios/${sid}/music/`)) return { ok: false }
  const [exists] = await bucket().file(p.storagePath).exists()
  if (!exists) return { ok: false }
  const ref = settingsRef(sid)
  await adminDb().runTransaction(async (tx) => {
    const tracks = ((await tx.get(ref)).get('music') as MusicTrack[] | undefined) ?? []
    const track: MusicTrack = { id: `trk_${randomUUID().slice(0, 8)}`, name: p.name, mood: p.mood || 'genel', seconds: p.seconds, storagePath: p.storagePath, source: p.source || 'stüdyo', active: true }
    tx.set(ref, { music: [...tracks, track] }, { merge: true })
  })
  return { ok: true }
}

/** On/off. A track is never deleted from the list: a post rendered with it still names it. */
export async function setMusicTrackActiveAction(input: unknown): Promise<{ ok: boolean }> {
  const p = z.object({ id: z.string().max(40), active: z.boolean() }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  const ref = settingsRef(String(ctx.studioId))
  await adminDb().runTransaction(async (tx) => {
    const tracks = ((await tx.get(ref)).get('music') as MusicTrack[] | undefined) ?? []
    tx.set(ref, { music: tracks.map((t) => (t.id === p.id ? { ...t, active: p.active } : t)) }, { merge: true })
  })
  return { ok: true }
}

/** A 10-minute link to listen to a track. */
export async function musicPreviewUrlAction(input: unknown): Promise<string | null> {
  const p = z.object({ id: z.string().max(40) }).parse(input)
  const ctx = await requireTenantContext(TEAM)
  const tracks = ((await settingsRef(String(ctx.studioId)).get()).get('music') as MusicTrack[] | undefined) ?? []
  const t = tracks.find((x) => x.id === p.id)
  if (!t) return null
  const [url] = await bucket().file(t.storagePath).getSignedUrl({ action: 'read', expires: systemClock.now() + 10 * 60_000 })
  return url
}
