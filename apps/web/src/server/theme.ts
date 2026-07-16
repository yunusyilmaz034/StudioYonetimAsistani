import 'server-only'

import { DEFAULT_THEME, normalizeTheme, type StudioTheme } from '@/lib/theme/presets'

import { adminDb } from './firebase-admin'

// The studio's theme (PF-12) is CONFIG — a single settings doc, like the payment provider or the
// notification-template overrides. Read on the server in the layouts and injected as CSS variables.
// Never event-sourced: a palette choice is not a business event.
export async function getStudioTheme(studioId: string): Promise<StudioTheme> {
  try {
    const snap = await adminDb().doc(`studios/${studioId}/settings/theme`).get()
    return snap.exists ? normalizeTheme(snap.data() as Partial<StudioTheme>) : DEFAULT_THEME
  } catch {
    // The theme must never be the reason a page fails to render — fall back to the shipped palette.
    return DEFAULT_THEME
  }
}
