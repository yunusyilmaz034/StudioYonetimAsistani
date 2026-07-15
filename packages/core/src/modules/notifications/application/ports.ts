import type { Clock, NewEvent, TenantContext } from '../../../shared'
import type {
  Channel,
  DeliveryAttempt,
  NotificationIntent,
  NotificationPrefs,
  NotificationSettings,
  NotificationTemplate,
} from '../domain/types'

// ── THE PROVIDER PORT (owner rule: a new channel must be a new PROVIDER, nothing else). ─────
//
// The intent does not know what a channel is; the dispatcher does not know what a provider is. Adding
// WhatsApp later is an adapter and a template — not a redesign. That is the entire reason this
// interface exists before there is a single real provider behind it.
export interface ProviderResult {
  readonly ok: boolean
  readonly providerRef: string | null
  // `delivered` is only ever true for a channel that can HONESTLY claim it — in-app, which is a write
  // to our own database. An SMS gateway saying "delivered" is evidence, and it arrives later, by
  // callback.
  readonly delivered: boolean
  readonly error?: { readonly code: string; readonly message: string; readonly permanent: boolean }
}

export interface RenderedMessage {
  readonly to: { readonly email: string | null; readonly phone: string | null; readonly memberId: string | null }
  readonly subject: string
  readonly body: string
  readonly intentId: string
  readonly channel: Channel
  // ── v1.26, and the reason it exists: WhatsApp. ─────────────────────────────────────────────
  // Meta will not carry arbitrary text to a member who has not written to us in the last 24 hours.
  // Outside that window only a **template Meta itself approved** may be sent — so the provider needs
  // to know WHICH template produced this message and WHAT went into its placeholders, not merely the
  // Turkish sentence that came out. `body` is what a human reads; these two are what an API needs.
  //
  // It lives on the port rather than inside the WhatsApp adapter because the mapping "our template →
  // their approved template" is a fact about our templates, and hiding it in one provider would mean
  // discovering, on the day we add a second one, that the information was thrown away.
  readonly templateId: string
  readonly params: Readonly<Record<string, string>>
}

export interface NotificationProvider {
  readonly channel: Channel
  send(ctx: TenantContext, message: RenderedMessage): Promise<ProviderResult>
}

export interface NotificationRepository {
  getIntent(ctx: TenantContext, id: string): Promise<NotificationIntent | null>
  listIntents(ctx: TenantContext, limit: number): Promise<readonly NotificationIntent[]>
  saveIntent(ctx: TenantContext, intent: NotificationIntent, events: readonly NewEvent[]): Promise<void>

  getAttempt(ctx: TenantContext, id: string): Promise<DeliveryAttempt | null>
  listAttempts(ctx: TenantContext, limit: number): Promise<readonly DeliveryAttempt[]>
  listAttemptsByIntent(ctx: TenantContext, intentId: string): Promise<readonly DeliveryAttempt[]>
  // The retry sweep's candidate set.
  listDue(ctx: TenantContext, nowMs: number): Promise<readonly DeliveryAttempt[]>
  saveAttempt(ctx: TenantContext, attempt: DeliveryAttempt, events: readonly NewEvent[]): Promise<void>

  // The daily ceiling is counted, not guessed.
  countIntentsSince(ctx: TenantContext, sinceMs: number): Promise<number>

  // The member's in-app inbox — the one channel that is a write to our own database.
  pushInbox(
    ctx: TenantContext,
    memberId: string,
    row: { intentId: string; subject: string; body: string; at: number },
  ): Promise<void>
  listInbox(ctx: TenantContext, memberId: string): Promise<readonly InboxRow[]>
  markInboxRead(ctx: TenantContext, memberId: string, intentId: string): Promise<void>
}

export interface InboxRow {
  readonly intentId: string
  readonly subject: string
  readonly body: string
  readonly at: number
  readonly read: boolean
}

export interface NotificationDeps {
  readonly repo: NotificationRepository
  readonly clock: Clock
  readonly providers: readonly NotificationProvider[]
  readonly settings: NotificationSettings
  readonly utcOffsetMinutes: number
  // Preferences and contact details are STATE — the event has neither (#6).
  readonly loadPrefs: (ctx: TenantContext, memberId: string) => Promise<NotificationPrefs>
  // Plus Phase 5 — the studio's per-template OVERRIDE, if it edited one. Absent ⇒ the code seed is
  // used. Returns null for a template the studio has not customised.
  readonly loadTemplate?: (ctx: TenantContext, templateId: string) => Promise<NotificationTemplate | null>
}
