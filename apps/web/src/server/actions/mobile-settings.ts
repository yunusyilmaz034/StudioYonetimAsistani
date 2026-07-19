'use server'

import { z } from 'zod'

import { requireTenantContext } from '../auth'
import { adminDb } from '../firebase-admin'

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

// PUBLIC read for the app's login screen (pre-auth) — name + logo only, no secrets.
export async function getMobileBrandingPublic(studioId: string): Promise<MobileBranding | null> {
  const snap = await adminDb().doc(`studios/${studioId}/settings/mobile`).get()
  return ((snap.data() as MobileSettings | undefined)?.branding ?? null) as MobileBranding | null
}
