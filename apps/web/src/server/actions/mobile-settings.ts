'use server'

import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb, adminStorage, storageBucketName } from '../firebase-admin'

// The MOBILE settings the owner controls from the panel (Ayarlar → Mobil). Today: the home-screen
// campaign banner the member sees at the top of the app. Stored at studios/{sid}/settings/mobile.
const OWNER = ['owner', 'platform_admin'] as const
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

export interface MobileBanner {
  readonly active: boolean
  readonly title: string
  readonly body: string
  readonly tone: 'accent' | 'gold' | 'good'
  readonly imageUrl?: string // optional background image (any public URL)
}

export interface MobileBranding {
  readonly appName: string
  readonly logoUrl: string
}

// The full-creative campaign shown as a tasteful open-screen POPUP (e.g. the Instagram ad). Distinct
// from the inline banner. Frequency is capped on the device (once/day, silenced once dismissed).
export interface MobileCampaign {
  readonly active: boolean
  readonly imageUrl: string // the creative (square/portrait); the popup is image-first
  readonly title: string // optional overline shown under the image
  readonly ctaLabel: string // '' ⇒ no button
  readonly ctaUrl: string // link or wa.me/... opened on tap
}

export interface MobileSettings {
  readonly banner: MobileBanner | null
  readonly branding: MobileBranding | null
  readonly campaign: MobileCampaign | null
}

const DEFAULT: MobileSettings = { banner: null, branding: null, campaign: null }

export async function getMobileSettingsAction(): Promise<MobileSettings> {
  const ctx = await requireTenantContext(OPS)
  const snap = await adminDb().doc(`studios/${ctx.studioId}/settings/mobile`).get()
  return { ...DEFAULT, ...((snap.data() as MobileSettings | undefined) ?? {}) }
}

export async function setMobileBannerAction(input: unknown) {
  const p = z
    .object({
      active: z.boolean(),
      title: z.string().trim().max(80),
      body: z.string().trim().max(240),
      tone: z.enum(['accent', 'gold', 'good']).default('accent'),
      imageUrl: z.string().trim().url().or(z.literal('')).optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  await adminDb().doc(`studios/${ctx.studioId}/settings/mobile`).set({ banner: p }, { merge: true })
  return { ok: true as const }
}

export async function setMobileCampaignAction(input: unknown) {
  const p = z
    .object({
      active: z.boolean(),
      imageUrl: z.string().trim().url().or(z.literal('')),
      title: z.string().trim().max(80).default(''),
      ctaLabel: z.string().trim().max(30).default(''),
      ctaUrl: z.string().trim().max(500).default(''),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  await adminDb().doc(`studios/${ctx.studioId}/settings/mobile`).set({ campaign: p }, { merge: true })
  return { ok: true as const }
}

// The app's branding — the name + logo shown on the login screen and the home hero. A logo URL is any
// public image (e.g. the studio's website logo). Owner-only.
export async function setMobileBrandingAction(input: unknown) {
  const p = z
    .object({ appName: z.string().trim().max(60), logoUrl: z.string().trim().url().or(z.literal('')) })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  await adminDb().doc(`studios/${ctx.studioId}/settings/mobile`).set({ branding: p }, { merge: true })
  return { ok: true as const }
}

// Upload an image (banner / campaign / logo) instead of pasting a URL. Stored in Storage with a
// stable Firebase download URL (a token in the object metadata) — public-with-token, never expires,
// and works under uniform bucket-level access. Owner-only. Returns the URL to put in the field.
export async function uploadMobileImageAction(input: unknown) {
  const p = z.object({ dataUrl: z.string().min(1), kind: z.enum(['banner', 'campaign', 'logo']) }).parse(input)
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
  const path = `studios/${ctx.studioId}/mobile/${p.kind}/${Date.now()}.${ext}`
  const bucket = storageBucketName()
  await adminStorage()
    .bucket(bucket)
    .file(path)
    .save(buf, { contentType: mime, resumable: false, metadata: { metadata: { firebaseStorageDownloadTokens: token } } })
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
  return { ok: true as const, value: { url } }
}

// PUBLIC read for the app's login screen (pre-auth) — name + logo only, no secrets.
export async function getMobileBrandingPublic(studioId: string): Promise<MobileBranding | null> {
  const snap = await adminDb().doc(`studios/${studioId}/settings/mobile`).get()
  return ((snap.data() as MobileSettings | undefined)?.branding ?? null) as MobileBranding | null
}
