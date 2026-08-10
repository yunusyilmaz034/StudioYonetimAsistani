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

/**
 * The name the STUDIO is known by, for the panel's own masthead.
 *
 * The sidebar used to read "Studio · Yönetim Asistanı" — the platform's name, printed inside the
 * customer's product. That is backwards, and it was decided so the day the platform got a brand of
 * its own (`PRODUCT-ROADMAP.md` §9): the person at the desk should see her studio, not her vendor.
 * A white-label product whose chrome advertises the supplier is not white-label.
 *
 * `displayName` before `legalName`, like the receipt does — the name a member knows, not the one on
 * the tax certificate. The fallback stays generic on purpose: a studio that has not filled in its
 * company card yet gets a neutral word, never some other studio's name.
 */
export async function getStudioName(studioId: string): Promise<string> {
  try {
    const snap = await adminDb().doc(`studios/${studioId}/settings/studio`).get()
    const company = snap.get('company') as { displayName?: string; legalName?: string } | undefined
    return company?.displayName?.trim() || company?.legalName?.trim() || 'Stüdyo'
  } catch {
    // Same rule as the theme: the masthead must never be why a page fails to render.
    return 'Stüdyo'
  }
}
