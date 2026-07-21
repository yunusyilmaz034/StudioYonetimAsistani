// The notifications module's only public door (v1.25, Doc 28).
//
//   DOMAIN EVENT → NOTIFICATION INTENT → DELIVERY ATTEMPT
//
// The domain NEVER calls a provider. Nothing in reservations, finance or scheduling imports this
// module: the coupling runs one way, downstream of the event, and a failed delivery can therefore
// never fail a booking.
//
// It owns I-38: a notification's rendered body — and the member's address — never enter the event
// log. Content and identity live on the intent (erased with the member); behaviour lives in /events
// (permanent, anonymous).
export type {
  // `Category` is taken by the class taxonomy (pilates_group | fitness | private). The KVKK
  // category is a different concept and says so in its name.
  Category as NotificationCategory,
  Channel,
  DeliveryAttempt,
  DeliveryStatus,
  NotificationIntent,
  NotificationPrefs,
  NotificationSettings,
  NotificationTemplate,
  Priority,
  RecipientRef,
  RetryPolicy,
  SuppressionReason,
} from './domain/types'
export {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_PREFS,
  DEFAULT_RETRY,
} from './domain/types'
export { TEMPLATES } from './domain/templates'
export { RULES, rulesFor, type IntentRule } from './domain/rules'
export * from './events'
export {
  decideAttemptResult,
  decideCreateIntent,
  isQuietHour,
  render,
  selectChannels,
  waitsForQuietHours,
} from './domain/decide'
export {
  collapsedIntentId,
  deliver,
  dispatch,
  intentIdFor,
  notify,
  sweepRetries,
  type NotifyInput,
} from './application/notify'
export type {
  InboxRow,
  NotificationDeps,
  NotificationProvider,
  NotificationRepository,
  ProviderResult,
  RenderedMessage,
} from './application/ports'
export { FirestoreNotificationRepository } from './infrastructure/repos'
export {
  ConsoleEmailProvider,
  InAppProvider,
  META_TEMPLATE,
  metaWhatsAppTransport,
  sendWhatsAppText,
  MockSmsProvider,
  ResendEmailProvider,
  standardNotificationProviders,
  WhatsAppProvider,
  type EmailBrand,
  type MetaTemplateRef,
  type MetaWhatsAppConfig,
  type NotificationProvidersConfig,
  type WhatsAppTransport,
} from './infrastructure/providers'
