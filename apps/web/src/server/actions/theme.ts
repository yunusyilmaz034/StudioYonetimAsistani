'use server'

import { z } from 'zod'

import { normalizeTheme, type StudioTheme } from '@/lib/theme/presets'
import { requireTenantContext } from '@/server/auth'
import { adminDb } from '@/server/firebase-admin'
import { getStudioTheme } from '@/server/theme'

// Theme is owner configuration (branding). Reception reads the app in it but does not choose it.
const OWNER = ['owner', 'platform_admin'] as const

export async function getStudioThemeAction(): Promise<StudioTheme> {
  const ctx = await requireTenantContext(OWNER)
  return getStudioTheme(ctx.studioId)
}

export async function updateStudioThemeAction(input: unknown): Promise<{ ok: true }> {
  const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable()
  const p = z
    .object({
      presetId: z.string().min(1),
      fontScale: z.enum(['sm', 'md', 'lg']),
      fontFamily: z.enum(['default', 'system', 'rounded']),
      categories: z.object({ pilates: hex, fitness: hex, private: hex }).optional(),
      surfaces: z.object({ sidebar: hex, agenda: hex }).optional(),
    })
    .parse(input)
  const ctx = await requireTenantContext(OWNER)
  // normalize on the way in too: an unknown preset id can never be persisted.
  const theme = normalizeTheme(p)
  await adminDb().doc(`studios/${ctx.studioId}/settings/theme`).set(theme, { merge: true })
  return { ok: true as const }
}
