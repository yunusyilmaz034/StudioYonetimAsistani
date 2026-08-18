// The web tier's notification dependencies — a PLAIN server module, deliberately not `'use server'`.
//
// It used to live inside `actions/notifications.ts`, which meant only Server Actions could reach it.
// The PAYTR callback (a plain module, never an action — see payment-callback.ts) needs the same
// providers to send an online buyer her invite, so the builder moved here: ONE registry for the web
// tier, whether the sender is reception's manual resend or a verified callback.
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_PREFS,
  type NotificationSettings,
  FirestoreNotificationRepository,
  standardNotificationProviders,
  systemClock,
  type MetaWhatsAppConfig,
  type NotificationDeps,
  type NotificationPrefs,
  type NotificationProvidersConfig,
  type NotificationTemplate,
} from '@studio/core'

import { adminDb } from './firebase-admin'

// Same config the functions trigger reads, so a send from here uses the SAME real providers
// production does — not a console/mock that quietly succeeds while nothing leaves the building.
export function providerConfig(): NotificationProvidersConfig {
  const config: { email?: { apiKey: string; from: string }; whatsapp?: MetaWhatsAppConfig } = {}
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (apiKey && from) config.email = { apiKey, from }
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  if (phoneNumberId && accessToken)
    config.whatsapp = {
      phoneNumberId,
      accessToken,
      ...(process.env.WHATSAPP_API_VERSION ? { apiVersion: process.env.WHATSAPP_API_VERSION } : {}),
    }
  return config
}

/**
 * The studio's OWN notification settings — the ones the settings screen writes.
 *
 * The web tier used to hand `DEFAULT_NOTIFICATION_SETTINGS` to every send, so the screen wrote a
 * document nothing read. The studio had WhatsApp enabled and push disabled; the panel's own
 * broadcast did the opposite, because the defaults say `['in_app', 'email', 'push']`. A 158-member
 * announcement went out over push — which needs the app — to advertise the app.
 *
 * The functions tier has read this document correctly since DEBT-024. This is the same loader, on
 * the side that was still guessing.
 *
 * `in_app` is forced on whatever is stored: it is not a message, it is the member's record of what
 * happened to her account, and a settings document that lost it must not be able to erase her
 * history.
 */
export async function studioNotificationSettings(studioId: string): Promise<NotificationSettings> {
  const snap = await adminDb().doc(`studios/${studioId}/settings/studio`).get()
  const stored = snap.get('notifications') as NotificationSettings | undefined
  if (!stored) return DEFAULT_NOTIFICATION_SETTINGS

  const channels = new Set<string>(stored.enabledChannels ?? [])
  channels.add('in_app')
  return { ...stored, enabledChannels: [...channels] as NotificationSettings['enabledChannels'] }
}

/** The studio-aware builder. Prefer this; the sync one below cannot know whose studio it is. */
export const notificationDepsFor = async (studioId: string): Promise<NotificationDeps> => ({
  ...notificationDeps(),
  settings: await studioNotificationSettings(studioId),
})

export const notificationDeps = (): NotificationDeps => {
  const db = adminDb()
  return {
    repo: new FirestoreNotificationRepository(db),
    clock: systemClock,
    providers: standardNotificationProviders(db, providerConfig()),
    settings: DEFAULT_NOTIFICATION_SETTINGS,
    utcOffsetMinutes: 180,
    loadPrefs: async (ctx, memberId): Promise<NotificationPrefs> => {
      const snap = await db.doc(`studios/${ctx.studioId}/members/${memberId}`).get()
      return { ...DEFAULT_PREFS, ...((snap.get('notificationPrefs') as NotificationPrefs) ?? {}) }
    },
    loadTemplate: async (ctx, templateId): Promise<NotificationTemplate | null> => {
      const snap = await db.doc(`studios/${ctx.studioId}/notificationTemplates/${templateId}`).get()
      return snap.exists ? (snap.data() as NotificationTemplate) : null
    },
  }
}
