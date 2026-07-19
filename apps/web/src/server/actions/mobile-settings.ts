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
}

export interface MobileSettings {
  readonly banner: MobileBanner | null
}

const DEFAULT: MobileSettings = { banner: null }

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
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  await adminDb().doc(`studios/${ctx.studioId}/settings/mobile`).set({ banner: p }, { merge: true })
  return { ok: true as const }
}
