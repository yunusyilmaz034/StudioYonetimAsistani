'use server'

import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb, adminStorage, storageBucketName } from '../firebase-admin'

// The MOBILE settings the owner controls from the panel (Ayarlar → Mobil). Today: the home-screen
// campaign banner the member sees at the top of the app. Stored at studios/{sid}/settings/mobile.
const OWNER = ['owner', 'platform_admin'] as const
const OPS = ['owner', 'receptionist', 'platform_admin'] as const

export interface MobileBanner {
  readonly id?: string // stable key for the carousel; assigned when a banner is created in the panel
  readonly active: boolean
  readonly title: string
  readonly body: string // short line shown on the card
  readonly tone: 'accent' | 'gold' | 'good'
  readonly imageUrl?: string // optional background image (any public URL)
  readonly detail?: string // long text shown on the tap-through detail page
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
  readonly banner: MobileBanner | null // legacy single banner — kept so an old app build still reads one
  readonly banners: readonly MobileBanner[] // the carousel (what the panel edits and the app renders)
  readonly branding: MobileBranding | null
  readonly campaign: MobileCampaign | null
}

const DEFAULT: MobileSettings = { banner: null, banners: [], branding: null, campaign: null }

export async function getMobileSettingsAction(): Promise<MobileSettings> {
  const ctx = await requireTenantContext(OPS)
  const snap = await adminDb().doc(`studios/${ctx.studioId}/settings/mobile`).get()
  const raw = { ...DEFAULT, ...((snap.data() as Partial<MobileSettings> | undefined) ?? {}) }
  // Back-compat: a studio that only ever had the single `banner` gets it lifted into the array, so the
  // panel and app work off ONE model. Once `banners` is saved, the legacy field is ignored.
  const banners = raw.banners.length > 0 ? raw.banners : raw.banner ? [{ ...raw.banner, id: raw.banner.id ?? 'legacy' }] : []
  return { ...raw, banners }
}

const bannerSchema = z.object({
  id: z.string().trim().min(1).max(40),
  active: z.boolean(),
  title: z.string().trim().max(80),
  body: z.string().trim().max(240),
  tone: z.enum(['accent', 'gold', 'good']).default('accent'),
  imageUrl: z.string().trim().url().or(z.literal('')).optional(),
  detail: z.string().trim().max(2000).optional(),
})

// The whole carousel is saved at once (the panel owns the ordered list). Max 10 keeps the home payload
// small. Writing `banners` supersedes the legacy `banner` (which memberHomeExtras only falls back to).
export async function setMobileBannersAction(input: unknown) {
  const p = z.object({ banners: z.array(bannerSchema).max(10) }).parse(input)
  const ctx = await requireTenantContext(OWNER)
  await adminDb().doc(`studios/${ctx.studioId}/settings/mobile`).set({ banners: p.banners }, { merge: true })
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
